import { sql, type Kysely } from 'kysely';
import { AppError } from '@/core/contracts';
const requiredMigrations = ["202610170001_initial", "202610170002_payments", "202610170003_runtime"];
export async function assertSchemaReady(db: Kysely<any>, authTables: string[]) {
  const rows = await sql<{ name: string }>`select "name" from "commerce_migrations"`.execute(db);
  if (!requiredMigrations.every(name => rows.rows.some(row => row.name === name))) throw new AppError('SCHEMA_NOT_READY', 'Database migration required.', 503);
  for (const table of authTables) await sql`select 1 from ${sql.table(table)} limit 0`.execute(db);
}
