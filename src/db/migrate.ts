import { sql, type Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import type { Database } from './schema';
import { getDatabaseProvider, type DatabaseProvider } from './index';
import { paymentsMigration } from './migrations/002-payments';
import { runtimeMigration } from './migrations/003-runtime';
import { catalogListIndexMigration } from './migrations/004-catalog-list-index';

/** Immutable, portable migration. Avoid importing current domain validation. */
const initial: Migration = {
  async up(db) {
    await db.schema.createTable('commerce_products')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('sku', 'text', c => c.notNull())
      .addColumn('name', 'text', c => c.notNull())
      .addColumn('description', 'text', c => c.notNull())
      .addColumn('category', 'text', c => c.notNull())
      .addColumn('price_minor', 'bigint', c => c.notNull())
      .addColumn('currency', 'text', c => c.notNull())
      .addColumn('stock', 'integer', c => c.notNull())
      .addColumn('image_url', 'text')
      .addColumn('active', 'integer', c => c.notNull())
      .addColumn('version', 'integer', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull())
      .addColumn('updated_at', 'text', c => c.notNull())
      .addUniqueConstraint('commerce_products_tenant_id_unique', ['tenant_id', 'id'])
      .addUniqueConstraint('commerce_products_tenant_sku_unique', ['tenant_id', 'sku'])
      .addCheckConstraint('commerce_products_stock_check', sql`stock >= 0 AND stock <= 1000000000`)
      .addCheckConstraint('commerce_products_price_check', sql`price_minor >= 0 AND price_minor <= 9007199254740991`)
      .addCheckConstraint('commerce_products_active_check', sql`active IN (0, 1)`)
      .addCheckConstraint('commerce_products_version_check', sql`version >= 1`)
      .execute();
    await db.schema.createTable('commerce_orders')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('actor_id', 'text', c => c.notNull())
      .addColumn('idempotency_key', 'text', c => c.notNull())
      .addColumn('request_hash', 'text', c => c.notNull())
      .addColumn('total_minor', 'bigint', c => c.notNull())
      .addColumn('currency', 'text', c => c.notNull())
      .addColumn('status', 'text', c => c.notNull())
      .addColumn('channel', 'text', c => c.notNull())
      .addColumn('payment_method', 'text', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull())
      .addColumn('customer_json', 'text')
      .addUniqueConstraint('commerce_orders_tenant_id_unique', ['tenant_id', 'id'])
      .addUniqueConstraint('commerce_orders_idempotency_unique', ['tenant_id', 'idempotency_key'])
      .addCheckConstraint('commerce_orders_total_check', sql`total_minor >= 0 AND total_minor <= 9007199254740991`)
      .addCheckConstraint('commerce_orders_status_check', sql`status IN ('pending', 'completed', 'cancelled')`)
      .addCheckConstraint('commerce_orders_channel_check', sql`channel IN ('web', 'pos')`)
      .addCheckConstraint('commerce_orders_payment_check', sql`payment_method IN ('cash', 'manual')`)
      .execute();
    await db.schema.createTable('commerce_order_items')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('order_id', 'text', c => c.notNull())
      .addColumn('product_id', 'text', c => c.notNull())
      .addColumn('sku', 'text', c => c.notNull())
      .addColumn('name', 'text', c => c.notNull())
      .addColumn('quantity', 'integer', c => c.notNull())
      .addColumn('unit_price_minor', 'bigint', c => c.notNull())
      .addColumn('total_minor', 'bigint', c => c.notNull())
      .addForeignKeyConstraint('commerce_items_order_fk', ['tenant_id', 'order_id'], 'commerce_orders', ['tenant_id', 'id'])
      .addForeignKeyConstraint('commerce_items_product_fk', ['tenant_id', 'product_id'], 'commerce_products', ['tenant_id', 'id'])
      .addCheckConstraint('commerce_items_quantity_check', sql`quantity > 0 AND quantity <= 1000000`)
      .addCheckConstraint('commerce_items_total_check', sql`total_minor >= 0 AND total_minor <= 9007199254740991`)
      .addCheckConstraint('commerce_items_price_check', sql`unit_price_minor >= 0 AND unit_price_minor <= 9007199254740991`)
      .execute();
    await db.schema.createTable('commerce_audit')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('actor_id', 'text', c => c.notNull())
      .addColumn('action', 'text', c => c.notNull())
      .addColumn('resource_id', 'text', c => c.notNull())
      .addColumn('details_json', 'text', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull()).execute();
    await db.schema.createTable('commerce_stock_operations')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('product_id', 'text', c => c.notNull())
      .addColumn('idempotency_key', 'text', c => c.notNull())
      .addColumn('request_hash', 'text', c => c.notNull())
      .addColumn('result_json', 'text', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull())
      .addUniqueConstraint('commerce_stock_idempotency_unique', ['tenant_id', 'idempotency_key'])
      .addForeignKeyConstraint('commerce_stock_product_fk', ['tenant_id', 'product_id'], 'commerce_products', ['tenant_id', 'id'])
      .execute();
    await db.schema.createIndex('commerce_orders_tenant_created').on('commerce_orders').columns(['tenant_id', 'created_at']).execute();
    await db.schema.createIndex('commerce_audit_tenant_created').on('commerce_audit').columns(['tenant_id', 'created_at']).execute();
    await db.schema.createIndex('commerce_items_tenant_order').on('commerce_order_items').columns(['tenant_id', 'order_id']).execute();
    await db.schema.createTable('commerce_rate_limits')
      .addColumn('key', 'text', c => c.primaryKey())
      .addColumn('count', 'integer', c => c.notNull())
      .addColumn('expires_at', 'text', c => c.notNull())
      .addCheckConstraint('commerce_rate_limits_count_check', sql`count >= 0`)
      .execute();
    await db.schema.createIndex('commerce_rate_limits_expiry').on('commerce_rate_limits').column('expires_at').execute();
  },
};

export async function migrateDatabase(db: Kysely<Database>, options: { provider?: DatabaseProvider } = {}): Promise<void> {
  const migrator = new Migrator({
    db,
    migrationTableName: 'commerce_migrations',
    migrationLockTableName: 'commerce_migration_lock',
    provider: { async getMigrations() { return { '202610170001_initial': initial, '202610170002_payments': paymentsMigration, '202610170003_runtime': runtimeMigration, '202610170004_catalog_list_index': catalogListIndexMigration }; } },
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
  const provider = options.provider ?? getDatabaseProvider(db);
  if (provider && ['postgres', 'supabase', 'neon'].includes(provider)) {
    // Default-deny PostgREST/client roles. Backend connects as the migration owner.
    // Application tenant checks remain mandatory for that trusted role.
    for (const table of ['commerce_products', 'commerce_orders', 'commerce_order_items', 'commerce_audit', 'commerce_stock_operations', 'commerce_rate_limits', 'commerce_payment_attempts', 'commerce_payment_events', 'commerce_runtime_settings', 'commerce_migrations', 'commerce_migration_lock']) {
      await sql`ALTER TABLE ${sql.ref(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    }
  }
}
