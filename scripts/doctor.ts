import nextEnv from '@next/env';
import { sql } from 'kysely';
import { getSchema } from 'better-auth/db';
import { templateConfig } from '../src/template.config';
import { checkSettings } from './lib/configure';
import { assertSchemaReady } from '../src/lib/readiness';
nextEnv.loadEnvConfig(process.cwd());
const checks: { check: string; ok: boolean }[] = [];
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); checks.push({ check: name, ok: true }); }
  catch { checks.push({ check: name, ok: false }); }
}
const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
checks.push({ check: 'database.provider', ok: ['postgres','supabase','neon','turso','sqlite'].includes(provider) });
checks.push({ check: 'auth.secret.length', ok: (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32 });
checks.push({ check: 'modules.dependencies', ok: !templateConfig.modules.orders || (templateConfig.modules.catalog && templateConfig.modules.inventory) });
checks.push({ check: 'production.demo.disabled', ok: process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE !== 'true' });
for (const result of checkSettings(templateConfig)) {
  checks.push({ check: result.check, ok: result.ok });
  if (result.message) console.error(`${result.check}: ${result.message}`);
}
const { authOrigin, getAuth } = await import('../src/lib/auth');
await check('auth.origin', () => { const origin=authOrigin(); if (process.env.APP_URL && new URL(process.env.APP_URL).origin !== origin) throw new Error(); });
const { getPaymentProvider } = await import('../src/payments/registry');
await check('payments.configuration', () => { getPaymentProvider(); });
const { getDatabase } = await import('../src/db');
let db: ReturnType<typeof getDatabase> | undefined;
await check('database.connection', async () => { db=getDatabase(); await sql`select 1`.execute(db); });
if (db) {
  await check('database.business.schema', async () => { await db!.selectFrom('commerce_products').select('id').limit(1).execute(); });
  await check('database.auth.schema', async () => { await sql`select id from "user" limit 1`.execute(db!); });
  await check('database.release.ready', () => assertSchemaReady(db!, Object.keys(getSchema(getAuth().options))));
  await db.destroy().catch(() => { checks.push({ check: 'database.close', ok: false }); });
}
console.info(JSON.stringify({ status: checks.every(c => c.ok) ? 'pass' : 'fail', checks }, null, 2));
if (checks.some(c => !c.ok)) process.exitCode=1;
