import type { Migration } from 'kysely/migration';

/** Additive index for tenant-scoped catalog pages ordered by name then ID. */
export const catalogListIndexMigration: Migration = {
  async up(db) {
    await db.schema.createIndex('commerce_products_tenant_name_id')
      .on('commerce_products').columns(['tenant_id', 'name', 'id']).execute();
  },
};
