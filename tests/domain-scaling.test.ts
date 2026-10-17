import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { createCommerceService } from '../src/core/service';
import type { Actor, Order } from '../src/core/contracts';

describe.each(['libsql', 'postgres-wasm'] as const)('bounded order queries: %s', engine => {
  let db: Kysely<Database>;
  let directory: string | undefined;
  const owner: Actor = { userId: 'batch-owner', tenantId: 'batch-tenant', role: 'owner' };
  const other: Actor = { userId: 'foreign-owner', tenantId: 'foreign-tenant', role: 'owner' };
  const expected = new Map<string, Order>();
  let foreign: Order;
  beforeAll(async () => {
    if (engine === 'libsql') directory = await mkdtemp(join(tmpdir(), 'domain-batch-'));
    db = engine === 'libsql'
      ? createDatabase({ provider: 'sqlite', url: 'file:' + join(directory!, 'batch.db') })
      : new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
    await migrateDatabase(db, { provider: engine === 'libsql' ? 'sqlite' : 'postgres' });
    const service = createCommerceService(db);
    const product = await service.createProduct(owner, { sku: 'BATCH', name: 'Original snapshot', priceMinor: 1250, currency: 'USD', stock: 100 });
    const extra = await service.createProduct(owner, { sku: 'EXTRA', name: 'Second item', priceMinor: 299, currency: 'USD', stock: 100 });
    for (let index = 0; index < 8; index++) {
      const order = await service.createOrder(owner, { items: [{ productId: product.id, quantity: index + 1 }, { productId: extra.id, quantity: 1 }], idempotencyKey: `batch-${index}`, channel: 'pos', paymentMethod: 'cash' });
      expected.set(order.id, order);
    }
    const current = await service.getProduct(owner, product.id);
    await service.updateProduct(owner, product.id, { version: current.version, priceMinor: 9999, name: 'Current catalog name' });
    const foreignProduct = await service.createProduct(other, { sku: 'BATCH', name: 'Foreign tenant item', priceMinor: 1, currency: 'EUR', stock: 2 });
    foreign = await service.createOrder(other, { items: [{ productId: foreignProduct.id, quantity: 1 }], idempotencyKey: 'foreign', channel: 'pos', paymentMethod: 'cash' });
  }, 30_000);
  afterAll(async () => { await db.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it('loads any bounded nonempty order page in two executed queries and preserves stored snapshots', async () => {
    const service = createCommerceService(db);
    const executed = vi.spyOn(db.getExecutor(), 'executeQuery');
    try {
      const orders = await service.listOrders(owner, { limit: 100 });
      expect(executed).toHaveBeenCalledTimes(2);
      expect(orders).toHaveLength(8);
      for (const order of orders) expect(order).toEqual(expected.get(order.id));
      expect(JSON.stringify(orders)).not.toContain(foreign.id);
      expect(JSON.stringify(orders)).not.toContain('Foreign tenant item');
      executed.mockClear();
      const page = await service.listOrders(owner, { limit: 3, offset: 2 });
      expect(executed).toHaveBeenCalledTimes(2);
      expect(page).toEqual(orders.slice(2, 5));
      executed.mockClear();
      expect(await service.listOrders(owner, { limit: 3, offset: 100 })).toEqual([]);
      expect(executed).toHaveBeenCalledTimes(1);
      executed.mockClear();
      expect(await service.listOrders(other)).toEqual([foreign]);
      expect(executed).toHaveBeenCalledTimes(2);
    } finally { executed.mockRestore(); }
  });

  it('loads dashboard and five recent snapshots in five queries without cross-tenant totals', async () => {
    const executed = vi.spyOn(db.getExecutor(), 'executeQuery');
    try {
      const dashboard = await createCommerceService(db).getDashboard(owner);
      expect(executed).toHaveBeenCalledTimes(5);
      expect(dashboard.orderCount).toBe(8);
      expect(dashboard.recentOrders).toHaveLength(5);
      expect(dashboard.revenueByCurrency).toEqual([{ currency: 'USD', totalMinor: [...expected.values()].reduce((total, order) => total + order.totalMinor, 0) }]);
      for (const order of dashboard.recentOrders) expect(order).toEqual(expected.get(order.id));
      expect(JSON.stringify(dashboard)).not.toContain('Foreign tenant item');
    } finally { executed.mockRestore(); }
  });

  it('applies the additive catalog ordering index idempotently on each SQL family', async () => {
    await migrateDatabase(db, { provider: engine === 'libsql' ? 'sqlite' : 'postgres' });
    if (engine === 'libsql') {
      const result = await sql<{ name: string }>`PRAGMA index_info('commerce_products_tenant_name_id')`.execute(db);
      expect(result.rows.map(row => row.name)).toEqual(['tenant_id', 'name', 'id']);
    } else {
      const result = await sql<{ indexdef: string }>`SELECT indexdef FROM pg_indexes WHERE indexname = 'commerce_products_tenant_name_id'`.execute(db);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.indexdef).toContain('(tenant_id, name, id)');
    }
  });
});
