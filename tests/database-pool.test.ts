import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Pool, PoolConfig } from 'pg';
import type { Kysely } from 'kysely';
import type { Database, DatabaseConfig } from '../src/db';

const observed = vi.hoisted(() => ({ pools: [] as Pool[] }));
vi.mock('pg', async importOriginal => {
  const actual = await importOriginal<typeof import('pg')>();
  return { ...actual, Pool: class ObservedPool extends actual.Pool {
    constructor(config?: PoolConfig) {
      super(config);
      // Use the installed real pool; any attempt to acquire a network connection
      // fails locally, making this test independent of credentials/infrastructure.
      vi.spyOn(this as Pool, 'connect').mockImplementation(() => { throw new Error('Unexpected connection in pool configuration test'); });
      observed.pools.push(this);
    }
  } };
});
let factory: typeof import('../src/db');
let telemetry: typeof import('../src/lib/telemetry');
const databases: Kysely<Database>[] = [];
const url = 'postgresql://fixture-user:private-fixture-password@db.example.test/app';
const settings = [
  ['PG_POOL_MAX', 'maxConnections', 1, 100],
  ['PG_CONNECTION_TIMEOUT_MS', 'connectionTimeoutMillis', 100, 60_000],
  ['PG_IDLE_TIMEOUT_MS', 'idleTimeoutMillis', 1_000, 600_000],
] as const;
beforeEach(async () => {
  vi.resetModules(); observed.pools.length = 0;
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_PROVIDER', 'postgres'); vi.stubEnv('DATABASE_URL', url);
  for (const [name] of settings) vi.stubEnv(name, undefined);
  [factory, telemetry] = await Promise.all([import('../src/db'), import('../src/lib/telemetry')]);
});
afterEach(async () => {
  for (const db of databases.splice(0)) await db.destroy();
  for (const pool of observed.pools) { expect(pool.connect).not.toHaveBeenCalled(); if (!pool.ended) await pool.end(); }
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});
function create(config: Partial<DatabaseConfig> = {}) {
  const db = factory.createDatabase({ provider: 'postgres', url, ...config });
  databases.push(db); return db;
}

test.each(['postgres', 'supabase', 'neon'])('constructs one lazy %s pool with existing bounded defaults', provider => {
  vi.stubEnv('DATABASE_PROVIDER', provider);
  const db = factory.getDatabase(); databases.push(db);
  expect(factory.getDatabase()).toBe(db); expect(observed.pools).toHaveLength(1);
  expect(factory.getDatabaseProvider(db)).toBe(provider);
  expect(observed.pools[0].options).toMatchObject({ max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  expect(observed.pools[0].totalCount).toBe(0);
  expect(observed.pools[0].options).not.toHaveProperty('statement_timeout');
  expect(observed.pools[0].options).not.toHaveProperty('onConnect');
});
test('passes configured environment values to the official pg pool and preserves singleton behavior', () => {
  vi.stubEnv('PG_POOL_MAX', '12'); vi.stubEnv('PG_CONNECTION_TIMEOUT_MS', '4500'); vi.stubEnv('PG_IDLE_TIMEOUT_MS', '90000');
  const db = factory.getDatabase(); databases.push(db);
  expect(observed.pools[0].options).toMatchObject({ max: 12, connectionTimeoutMillis: 4500, idleTimeoutMillis: 90000 });
  vi.stubEnv('PG_POOL_MAX', '30');
  expect(factory.getDatabase()).toBe(db); expect(observed.pools).toHaveLength(1);
  expect(observed.pools[0].options.max).toBe(12);
});
test.each(['min', 'max'] as const)('accepts the documented inclusive %s bounds', boundary => {
  for (const [name, , min, max] of settings) vi.stubEnv(name, String(boundary === 'min' ? min : max));
  databases.push(factory.getDatabase());
  expect(observed.pools[0].options).toMatchObject(boundary === 'min'
    ? { max: 1, connectionTimeoutMillis: 100, idleTimeoutMillis: 1000 }
    : { max: 100, connectionTimeoutMillis: 60000, idleTimeoutMillis: 600000 });
});
test.each(settings)('strictly rejects malformed/out-of-range %s before constructing a pool', (name, _property, min, max) => {
  for (const value of ['', ' ', ' 5', '5 ', '+5', '-5', '5.0', '1e3', '0x10', 'NaN', 'Infinity', String(min - 1), String(max + 1), '9'.repeat(400)]) {
    vi.stubEnv(name, value);
    expect(() => factory.getDatabase()).toThrow(expect.objectContaining({ code: 'DATABASE_POOL_CONFIG_INVALID', message: `${name} must be an integer between ${min} and ${max}.` }));
    expect(observed.pools).toHaveLength(0);
  }
});
test('explicit factory options ignore ambient pool overrides and preserve verified TLS', () => {
  vi.stubEnv('PG_POOL_MAX', 'invalid-env');
  create({ maxConnections: 7, connectionTimeoutMillis: 2000, idleTimeoutMillis: 15000, ssl: { ca: 'fixture-ca' } });
  expect(observed.pools[0].options).toMatchObject({ max: 7, connectionTimeoutMillis: 2000, idleTimeoutMillis: 15000, ssl: { ca: 'fixture-ca', rejectUnauthorized: true } });
  create();
  expect(observed.pools[1].options).toMatchObject({ max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
});
test.each(settings)('rejects invalid explicit numeric option %s without accepting coercion', (_name, property, min, max) => {
  for (const value of [null, '5', NaN, Infinity, -Infinity, 5.5, min - 1, max + 1]) {
    expect(() => create({ [property]: value } as Partial<DatabaseConfig>)).toThrow(expect.objectContaining({ code: 'DATABASE_POOL_CONFIG_INVALID' }));
    expect(observed.pools).toHaveLength(0);
  }
});
test('ignores PostgreSQL-only configuration when constructing local SQLite', () => {
  vi.stubEnv('DATABASE_PROVIDER', 'sqlite'); vi.stubEnv('DATABASE_URL', 'file::memory:');
  for (const [name] of settings) vi.stubEnv(name, 'not-applicable');
  const db = factory.getDatabase(); databases.push(db);
  expect(factory.getDatabaseProvider(db)).toBe('sqlite'); expect(observed.pools).toHaveLength(0);
});
test('operation boundary correlates success and configuration failure without exposing supplied secrets', async () => {
  const events: Record<string, unknown>[] = [];
  const requestId = 'pool-config-test';
  await telemetry.withTelemetrySink(event => events.push(event), () => telemetry.withOperation('db.pool.configure', { requestId }, async () => create()));
  const secret = 'private-pool-value@example.test\npassword=private-config-secret';
  vi.stubEnv('PG_POOL_MAX', secret);
  let failure: unknown;
  await telemetry.withTelemetrySink(event => events.push(event), async () => {
    try { await telemetry.withOperation('db.pool.configure', { requestId }, async () => factory.getDatabase()); }
    catch (error) { failure = error; }
  });
  expect(failure).toMatchObject({ code: 'DATABASE_POOL_CONFIG_INVALID' });
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ 'event.name': 'db.pool.configure.completed', 'event.schema_version': 1, 'event.outcome': 'success', 'request.id': requestId });
  expect(events[1]).toMatchObject({ 'event.outcome': 'failure', 'error.code': 'DATABASE_POOL_CONFIG_INVALID', 'request.id': requestId });
  expect(events[1]['duration_ms']).toEqual(expect.any(Number));
  expect(JSON.stringify(events) + String(failure)).not.toMatch(/private-|fixture-user|db\.example\.test/);
});
test('an idle pool error is handled once with redacted diagnostics, without acquiring a client', () => {
  create();
  const events: Record<string, unknown>[] = [];
  const error = new Error(`private-customer@example.test ${url}`);
  expect(() => telemetry.withTelemetrySink(event => events.push(event), () => observed.pools[0].emit('error', error))).not.toThrow();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ 'event.name': 'db.pool.connection.failed', 'event.schema_version': 1, 'event.outcome': 'failure', 'error.code': 'DB_POOL_IDLE_ERROR', 'dependency.name': 'postgres' });
  expect(events[0]).not.toHaveProperty('request.id');
  expect(JSON.stringify(events)).not.toMatch(/private-|fixture-user|db\.example\.test/);
  expect(observed.pools[0].totalCount).toBe(0);
});
test('a broken diagnostic sink cannot turn an idle pool event into an unhandled exception', () => {
  create();
  expect(() => telemetry.withTelemetrySink(() => { throw new Error('Exporter unavailable'); }, () => observed.pools[0].emit('error', new Error('private-provider-detail')))).not.toThrow();
});
