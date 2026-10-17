import { Kysely, PostgresDialect } from 'kysely';
import { LibsqlDialect, LibsqlDriver } from '@libsql/kysely-libsql';
import { createClient } from '@libsql/client';
import { Pool } from 'pg';
import { emitEvent } from '../lib/telemetry';
import type { Database } from './schema';

export type DatabaseProvider = 'postgres' | 'supabase' | 'neon' | 'turso' | 'sqlite';
export interface DatabaseConfig {
  provider: DatabaseProvider;
  url: string;
  authToken?: string;
  /** Supply a CA for self-hosted Postgres; certificate validation is never disabled. */
  ssl?: boolean | { ca: string };
  maxConnections?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}
const poolSettings = {
  maxConnections: { env: 'PG_POOL_MAX', defaultValue: 5, min: 1, max: 100 },
  connectionTimeoutMillis: { env: 'PG_CONNECTION_TIMEOUT_MS', defaultValue: 10_000, min: 100, max: 60_000 },
  idleTimeoutMillis: { env: 'PG_IDLE_TIMEOUT_MS', defaultValue: 30_000, min: 1_000, max: 600_000 },
} as const;
type PoolSetting = keyof typeof poolSettings;
class PoolConfigurationError extends Error {
  readonly code = 'DATABASE_POOL_CONFIG_INVALID';
  constructor(setting: PoolSetting) {
    const { env, min, max } = poolSettings[setting];
    // Only a static setting name/range, never the supplied value or connection URL.
    super(`${env} must be an integer between ${min} and ${max}.`);
    this.name = 'PoolConfigurationError';
  }
}
function poolInteger(value: number | undefined, setting: PoolSetting): number {
  const rule = poolSettings[setting];
  if (value === undefined) return rule.defaultValue;
  if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) throw new PoolConfigurationError(setting);
  return value;
}
function poolEnvironmentInteger(setting: PoolSetting): number {
  const value = process.env[poolSettings[setting].env];
  if (value === undefined) return poolInteger(undefined, setting);
  // Reject whitespace, signs, fractions, exponent notation and empty values.
  if (!/^[0-9]+$/.test(value)) throw new PoolConfigurationError(setting);
  return poolInteger(Number(value), setting);
}
const databaseProviders = new WeakMap<Kysely<Database>, DatabaseProvider>();
export function getDatabaseProvider(db: Kysely<Database>): DatabaseProvider | undefined {
  return databaseProviders.get(db);
}

export function createDatabase(config: DatabaseConfig): Kysely<Database> {
  if (!config.url) throw new Error('DATABASE_URL is required.');
  if (config.provider === 'turso' || config.provider === 'sqlite') {
    // Pin the application-owned client rather than using the dialect's older transitive
    // @libsql/client. Its modern pool releases failed concurrent transactions correctly.
    const client = createClient({ url: config.url, authToken: config.authToken });
    // The old declared Client.sync() return type differs; this dialect only calls
    // execute(), transaction(), and close(), whose current contracts are unchanged.
    const dialectClient = client as unknown as ConstructorParameters<typeof LibsqlDriver>[0];
    class OwnedLibsqlDriver extends LibsqlDriver {
      override async init() {
        if (config.url.startsWith('file:') && !config.url.includes(':memory:')) {
          await client.execute('PRAGMA journal_mode = WAL');
        }
      }
    }
    class OwnedLibsqlDialect extends LibsqlDialect {
      override createDriver() { return new OwnedLibsqlDriver(dialectClient, true); }
    }
    const db = new Kysely<Database>({
      dialect: new OwnedLibsqlDialect({ client: dialectClient }),
    });
    databaseProviders.set(db, config.provider);
    return db;
  }
  if (!['postgres', 'supabase', 'neon'].includes(config.provider)) {
    throw new Error('Unsupported DATABASE_PROVIDER.');
  }
  const pool = new Pool({
    connectionString: config.url,
    max: poolInteger(config.maxConnections, 'maxConnections'),
    connectionTimeoutMillis: poolInteger(config.connectionTimeoutMillis, 'connectionTimeoutMillis'),
    idleTimeoutMillis: poolInteger(config.idleTimeoutMillis, 'idleTimeoutMillis'),
    ssl: typeof config.ssl === 'object' ? { ...config.ssl, rejectUnauthorized: true } : config.ssl,
  });
  // pg removes a failed idle client itself. Handle its background error event so
  // it cannot become an unhandled EventEmitter error that terminates the process.
  pool.on('error', () => emitEvent('db.pool.connection.failed', {
    'event.outcome': 'failure', 'error.code': 'DB_POOL_IDLE_ERROR', 'dependency.name': 'postgres',
  }));
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  databaseProviders.set(db, config.provider);
  return db;
}

let database: Kysely<Database> | undefined;
export function getDatabase(): Kysely<Database> {
  if (!database) {
    const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
    if (!['postgres', 'supabase', 'neon', 'turso', 'sqlite'].includes(provider)) {
      throw new Error('Unsupported DATABASE_PROVIDER.');
    }
    const url = process.env.DATABASE_URL ?? (provider === 'sqlite' ? 'file:./commerce.db' : '');
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
      throw new Error('An explicit DATABASE_URL is required in production.');
    }
    database = createDatabase({
      provider: provider as DatabaseProvider,
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
      ...(['postgres', 'supabase', 'neon'].includes(provider) ? {
        maxConnections: poolEnvironmentInteger('maxConnections'),
        connectionTimeoutMillis: poolEnvironmentInteger('connectionTimeoutMillis'),
        idleTimeoutMillis: poolEnvironmentInteger('idleTimeoutMillis'),
      } : {}),
    });
  }
  return database;
}

export { migrateDatabase } from './migrate';
export type { Database } from './schema';
