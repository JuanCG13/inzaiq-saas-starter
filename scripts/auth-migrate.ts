import nextEnv from '@next/env';
import { getMigrations } from 'better-auth/db/migration';
import { getSchema } from 'better-auth/db';
import { sql } from 'kysely';
import { getAuth } from '../src/lib/auth';
import { getDatabase } from '../src/db';
nextEnv.loadEnvConfig(process.cwd());
const auth = getAuth();
// Complete provider initialization before changing schema or closing its connection.
await auth.$context;
const plan = await getMigrations(auth.options);
const postgres = !['sqlite', 'turso'].includes(process.env.DATABASE_PROVIDER ?? 'sqlite');
if (process.argv.includes('--apply')) {
  await plan.runMigrations();
  if (postgres) {
    // Auth tables contain credentials and must never be exposed by Supabase's public Data API.
    // The trusted server connection owns these tables. Never use anon/authenticated here.
    const db = getDatabase();
    const roles = await sql<{ rolname: string }>`select rolname from pg_roles where rolname in ('anon', 'authenticated')`.execute(db);
    for (const table of Object.keys(getSchema(auth.options))) {
      await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
      await sql`revoke all on table ${sql.table(table)} from public`.execute(db);
      for (const { rolname } of roles.rows) await sql`revoke all on table ${sql.table(table)} from ${sql.id(rolname)}`.execute(db);
    }
  }
  console.log('Authentication schema migrated and server-only access applied.');
} else {
  console.log(await plan.compileMigrations());
  if (postgres) for (const table of Object.keys(getSchema(auth.options))) console.log(`-- Server-only access: enable RLS and revoke PUBLIC/anon/authenticated on ${table}`);
  console.log('Review the SQL; run with --apply to execute.');
}
await getDatabase().destroy();
