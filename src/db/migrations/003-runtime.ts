import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const runtimeMigration: Migration = {
  async up(db) {
    await db.schema.createTable('commerce_runtime_settings')
      .addColumn('tenant_id', 'text', c => c.primaryKey())
      .addColumn('version', 'integer', c => c.notNull())
      .addColumn('accepting_orders', 'integer', c => c.notNull())
      .addColumn('notice', 'text', c => c.notNull())
      .addColumn('updated_at', 'text', c => c.notNull())
      .addCheckConstraint('commerce_runtime_settings_version_check', sql`version >= 1 AND version <= 2147483647`)
      .addCheckConstraint('commerce_runtime_settings_accepting_check', sql`accepting_orders IN (0, 1)`)
      .addCheckConstraint('commerce_runtime_settings_notice_check', sql`length(notice) <= 200`)
      .execute();
  },
};
