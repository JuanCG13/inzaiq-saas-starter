import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

/** Additive upgrade: previously recorded manual orders remain manual. */
export const paymentsMigration: Migration = {
  async up(db) {
    await db.schema.alterTable('commerce_orders').addColumn('payment_provider', 'text').execute();
    await db.schema.createTable('commerce_payment_attempts')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('order_id', 'text', c => c.notNull())
      .addColumn('provider', 'text', c => c.notNull())
      .addColumn('request_hash', 'text', c => c.notNull())
      .addColumn('provider_key', 'text', c => c.notNull())
      .addColumn('retry_until', 'text', c => c.notNull())
      .addColumn('session_id', 'text')
      .addColumn('checkout_url', 'text')
      .addColumn('expires_at', 'text')
      .addColumn('state', 'text', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull())
      .addColumn('updated_at', 'text', c => c.notNull())
      .addUniqueConstraint('commerce_payment_attempts_order_unique', ['tenant_id', 'order_id'])
      .addUniqueConstraint('commerce_payment_attempts_session_unique', ['provider', 'session_id'])
      .addUniqueConstraint('commerce_payment_attempts_key_unique', ['provider', 'provider_key'])
      .addForeignKeyConstraint('commerce_payment_attempts_order_fk', ['tenant_id', 'order_id'], 'commerce_orders', ['tenant_id', 'id'])
      .addCheckConstraint('commerce_payment_attempts_state_check', sql`state IN ('creating', 'ready', 'completed', 'cancelled', 'reconciliation_required')`)
      .execute();
    await db.schema.createTable('commerce_payment_events')
      .addColumn('id', 'text', c => c.primaryKey())
      .addColumn('provider', 'text', c => c.notNull())
      .addColumn('event_id', 'text', c => c.notNull())
      .addColumn('event_hash', 'text', c => c.notNull())
      .addColumn('tenant_id', 'text', c => c.notNull())
      .addColumn('order_id', 'text', c => c.notNull())
      .addColumn('session_id', 'text', c => c.notNull())
      .addColumn('type', 'text', c => c.notNull())
      .addColumn('outcome', 'text', c => c.notNull())
      .addColumn('created_at', 'text', c => c.notNull())
      .addUniqueConstraint('commerce_payment_events_provider_unique', ['provider', 'event_id'])
      .addForeignKeyConstraint('commerce_payment_events_order_fk', ['tenant_id', 'order_id'], 'commerce_orders', ['tenant_id', 'id'])
      .addCheckConstraint('commerce_payment_events_type_check', sql`type IN ('paid', 'failed', 'expired')`)
      .addCheckConstraint('commerce_payment_events_outcome_check', sql`outcome IN ('applied', 'ignored', 'reconciliation_required')`)
      .execute();
    await db.schema.createIndex('commerce_payment_attempts_reconcile').on('commerce_payment_attempts').columns(['state', 'updated_at']).execute();
  },
};
