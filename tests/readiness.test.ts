import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { getSchema } from 'better-auth/db';
import type { Database } from '../src/db/schema';

const dependencies = vi.hoisted(() => ({ database: vi.fn(), auth: vi.fn() }));
vi.mock('@/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/db')>(),
  getDatabase: dependencies.database,
}));
vi.mock('@/lib/auth', () => ({ getAuth: dependencies.auth }));

import { createDatabase, migrateDatabase } from '../src/db';
import { assertSchemaReady } from '../src/lib/readiness';
import { GET as readiness } from '../src/app/api/readiness/route';
import { GET as health } from '../src/app/api/health/route';
import { withTelemetrySink } from '../src/lib/telemetry';

const migrationNames = ['202610170001_initial', '202610170002_payments', '202610170003_runtime'];
// The probe checks existence, not authentication behavior. Use actual SQL tables
// with the names from Better Auth's core schema; full auth flows have their own suite.
const authOptions = {};
const authTables = Object.keys(getSchema(authOptions));
const requestId = '10000000-0000-4000-8000-000000000001';
let db: Kysely<Database>;
let directory: string;
let closed: boolean;
let records: Record<string, unknown>[];

function request() {
  return new Request('https://shop.example.test/api/readiness', { headers: { 'x-request-id': requestId } });
}
async function probe() {
  return withTelemetrySink(record => records.push(record), () => readiness(request()));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commerce-readiness-'));
  db = createDatabase({ provider: 'sqlite', url: `file:${join(directory, 'readiness.db')}` });
  closed = false;
  records = [];
  await migrateDatabase(db);
  for (const table of authTables) {
    await db.schema.createTable(table).addColumn('id', 'text', column => column.primaryKey()).execute();
  }
  dependencies.database.mockReset().mockReturnValue(db);
  dependencies.auth.mockReset().mockReturnValue({ options: authOptions });
});

afterEach(async () => {
  if (!closed) await db.destroy();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('schema-aware production readiness with real SQLite migrations', () => {
  it('accepts the migration registry actually applied by this release and existing auth tables', async () => {
    const applied = await sql<{ name: string }>`select name from commerce_migrations order by name`.execute(db);
    expect(applied.rows.map(row => row.name)).toEqual([...migrationNames, '202610170004_catalog_list_index']);
    expect(authTables).toContain('session');
    await expect(assertSchemaReady(db, authTables)).resolves.toBeUndefined();
    const response = await probe();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(requestId);
    expect(await response.json()).toMatchObject({ data: { status: 'ready' }, requestId });
    expect(records).toContainEqual(expect.objectContaining({
      'event.name': 'api.readiness.check.completed', 'event.outcome': 'success', 'request.id': requestId,
    }));
  });

  it.each(migrationNames)('refuses traffic when required migration %s is absent, even if all tables exist', async (name) => {
    await sql`delete from commerce_migrations where name = ${name}`.execute(db);
    await expect(assertSchemaReady(db, authTables)).rejects.toMatchObject({ code: 'SCHEMA_NOT_READY', status: 503 });
    expect((await probe()).status).toBe(503);
  });

  it('keeps the older application ready after an unknown additive future migration', async () => {
    const future = '209901010001_future_additive';
    await db.schema.createTable('commerce_future_probe').addColumn('id', 'text').execute();
    await sql`insert into commerce_migrations (name, timestamp) values (${future}, ${new Date().toISOString()})`.execute(db);
    await expect(assertSchemaReady(db, authTables)).resolves.toBeUndefined();
    expect((await probe()).status).toBe(200);
    const retained = await sql<{ name: string }>`select name from commerce_migrations where name = ${future}`.execute(db);
    expect(retained.rows).toEqual([{ name: future }]);
    await expect(sql`select id from commerce_future_probe limit 0`.execute(db)).resolves.toBeDefined();
  });

  it('refuses a missing auth table without exposing its name or raw SQL to the public probe', async () => {
    await db.schema.dropTable('session').execute();
    await expect(assertSchemaReady(db, authTables)).rejects.toThrow();
    const response = await probe();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'DEPENDENCY_NOT_READY' }, requestId });
    expect(body).not.toMatch(/no such table|select 1|session|SQLITE/i);
  });

  it('rejects a missing migration table instead of treating connectivity as readiness', async () => {
    await db.schema.dropTable('commerce_migrations').execute();
    await expect(sql`select 1`.execute(db)).resolves.toBeDefined();
    const response = await probe();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('commerce_migrations');
  });

  it('normalizes unexpected dependency errors and redacts their credentials, SQL and customer details', async () => {
    const privateDetails = 'postgres://private-user:private-password@db.invalid SELECT customer_email private@example.test';
    dependencies.database.mockImplementation(() => { throw new Error(privateDetails); });
    const response = await probe();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'DEPENDENCY_NOT_READY', message: 'Service is not ready to receive traffic.' }, requestId,
    });
    const diagnostic = JSON.stringify(records);
    expect(diagnostic).not.toMatch(/private-user|private-password|private@example|SELECT|db.invalid/);
    expect(records).toContainEqual(expect.objectContaining({
      'event.name': 'api.readiness.check.completed', 'event.outcome': 'failure',
      'error.code': 'DEPENDENCY_NOT_READY', 'request.id': requestId,
    }));
  });

  it('refuses invalid auth configuration with a safe 503', async () => {
    dependencies.auth.mockImplementation(() => { throw new Error('BETTER_AUTH_SECRET private-auth-secret'); });
    const response = await probe();
    expect(response.status).toBe(503);
    const serialized = `${await response.text()}${JSON.stringify(records)}`;
    expect(serialized).not.toContain('private-auth-secret');
    expect(serialized).not.toContain('BETTER_AUTH_SECRET');
  });

  it('keeps process liveness healthy when the actual database connection has been destroyed', async () => {
    await db.destroy(); closed = true;
    expect((await probe()).status).toBe(503);
    dependencies.database.mockClear(); dependencies.auth.mockClear();
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'ok' });
    expect(dependencies.database).not.toHaveBeenCalled();
    expect(dependencies.auth).not.toHaveBeenCalled();
  });
});
