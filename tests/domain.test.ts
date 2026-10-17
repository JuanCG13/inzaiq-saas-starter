import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { createCommerceService, type Actor, type DomainEvent } from '../src/core';
import type { Kysely } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner: Actor = { userId: 'user-a', tenantId: 'tenant-a', role: 'owner' };
const other: Actor = { userId: 'user-b', tenantId: 'tenant-b', role: 'owner' };
let db: Kysely<Database>;
let service: ReturnType<typeof createCommerceService>;
let events: DomainEvent[];
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commerce-domain-'));
  db = createDatabase({ provider: 'sqlite', url: `file:${join(directory, 'test.db')}` });
  await migrateDatabase(db);
  events = [];
  service = createCommerceService(db, { telemetry: event => events.push(event) });
});
afterEach(async () => { await db.destroy(); await rm(directory, { recursive: true, force: true }); });
const item = (overrides = {}) => ({ sku: 'TEE-01', name: 'Linen tee', priceMinor: 1299, currency: 'USD', stock: 10, ...overrides });

describe('commerce domain integration with real libSQL', () => {
  it('migrates idempotently and isolates products, orders, and audit by tenant', async () => {
    await migrateDatabase(db);
    const a = await service.createProduct(owner, item());
    await service.createProduct(other, item());
    expect(await service.listProducts(owner)).toHaveLength(1);
    await expect(service.getProduct(other, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateProduct(other, a.id, { name: 'stolen', version: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.createOrder(other, { items: [{ productId: a.id, quantity: 1 }], channel: 'pos', paymentMethod: 'cash', idempotencyKey: 'foreign' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await service.listOrders(other)).toHaveLength(0);
    expect((await service.listAudit(other)).every(entry => entry.tenantId === other.tenantId)).toBe(true);
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
  });

  it('enforces roles and scopes independently, including explicit empty scope list', async () => {
    const a = await service.createProduct(owner, item());
    await expect(service.createProduct({ ...owner, role: 'cashier' }, item({ sku: 'NO' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.adjustStock({ ...owner, role: 'viewer' }, a.id, { delta: 1, reason: 'received', idempotencyKey: 'stock-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listProducts({ ...owner, scopes: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.createProduct({ ...owner, scopes: ['products:read'] }, item({ sku: 'NO' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.listProducts({ ...owner, role: 'viewer', scopes: ['products:read'] })).toHaveLength(1);
    await expect(service.listAudit({ ...owner, role: 'cashier' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects unsafe, fractional and negative monetary amounts', async () => {
    for (const amount of [-1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service.createProduct(owner, item({ priceMinor: amount }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(await service.listProducts(owner)).toHaveLength(0);
  });

  it('normalizes malformed mutation objects instead of leaking TypeErrors', async () => {
    for (const bad of [null, undefined, [], 'not-an-object']) {
      await expect(service.createProduct(owner, bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.updateProduct(owner, 'id', bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.adjustStock(owner, 'id', bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.createOrder(owner, bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.updateOrderStatus(owner, 'id', bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('uses current server prices, persists snapshots and rejects client prices', async () => {
    const a = await service.createProduct(owner, item());
    const input = { items: [{ productId: a.id, quantity: 2 }], channel: 'pos' as const, paymentMethod: 'cash' as const, idempotencyKey: 'sale-1' };
    const sale = await service.createOrder(owner, input);
    expect(sale.totalMinor).toBe(2598);
    expect(sale.items[0]?.unitPriceMinor).toBe(1299);
    expect(sale.status).toBe('completed');
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
    const latest = await service.getProduct(owner, a.id);
    await service.updateProduct(owner, a.id, { version: latest.version, priceMinor: 9999 });
    expect((await service.listOrders(owner))[0]?.totalMinor).toBe(2598);
    await expect(service.createOrder(owner, { ...input, idempotencyKey: 'invalid-price', items: [{ productId: a.id, quantity: 1, priceMinor: 1 } as never] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('deduplicates order retries across service instances and rejects changed payloads', async () => {
    const a = await service.createProduct(owner, item());
    const input = { items: [{ productId: a.id, quantity: 2 }], channel: 'pos' as const, paymentMethod: 'cash' as const, idempotencyKey: 'retry-1' };
    const first = await service.createOrder(owner, input);
    expect(await createCommerceService(db).createOrder(owner, input)).toEqual(first);
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
    expect(await service.listOrders(owner)).toHaveLength(1);
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(1);
    await expect(service.createOrder(owner, { ...input, items: [{ productId: a.id, quantity: 3 }] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rolls back a price change before acceptance and allows a corrected retry', async () => {
    const a = await service.createProduct(owner, item());
    const input = { items: [{ productId: a.id, quantity: 2 }], channel: 'web' as const, paymentMethod: 'manual' as const, idempotencyKey: 'price-change' };
    await expect(service.createOrder(owner, { ...input, expectedTotalMinor: 1 })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    expect(await service.listOrders(owner)).toHaveLength(0);
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(0);
    const order = await service.createOrder(owner, { ...input, expectedTotalMinor: 2598 });
    expect(order.totalMinor).toBe(2598);
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
  });

  it('rejects stale currency even when the integer total is unchanged and binds currency to retries', async () => {
    const a = await service.createProduct(owner, item());
    await service.updateProduct(owner, a.id, { version: a.version, currency: 'EUR' });
    const input = { items: [{ productId: a.id, quantity: 2 }], channel: 'pos' as const, paymentMethod: 'cash' as const, idempotencyKey: 'currency-change', expectedTotalMinor: 2598 };
    await expect(service.createOrder(owner, { ...input, expectedCurrency: 'USD' })).rejects.toMatchObject({ code: 'CURRENCY_CHANGED' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    expect(await service.listOrders(owner)).toHaveLength(0);
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(0);
    const order = await service.createOrder(owner, { ...input, expectedCurrency: 'EUR' });
    expect(order.totalMinor).toBe(2598);
    expect(order.currency).toBe('EUR');
    await expect(service.createOrder(owner, { ...input, expectedCurrency: 'USD' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
  });

  it('rolls back an entire multi-item checkout on insufficient stock', async () => {
    const a = await service.createProduct(owner, item());
    const b = await service.createProduct(owner, item({ sku: 'TEE-02', stock: 0 }));
    await expect(service.createOrder(owner, { items: [{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 1 }], channel: 'web', paymentMethod: 'manual', idempotencyKey: 'rollback' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    expect(await service.listOrders(owner)).toHaveLength(0);
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(0);
  });

  it('rolls back mixed currencies and total overflow', async () => {
    const a = await service.createProduct(owner, item({ priceMinor: Number.MAX_SAFE_INTEGER }));
    const b = await service.createProduct(owner, item({ sku: 'EUR', currency: 'EUR' }));
    await expect(service.createOrder(owner, { items: [{ productId: a.id, quantity: 2 }], channel: 'pos', paymentMethod: 'cash', idempotencyKey: 'overflow' })).rejects.toMatchObject({ code: 'MONEY_OVERFLOW' });
    await expect(service.createOrder(owner, { items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }], channel: 'pos', paymentMethod: 'cash', idempotencyKey: 'mixed' })).rejects.toMatchObject({ code: 'MIXED_CURRENCY' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    expect(await service.listOrders(owner)).toHaveLength(0);
  });

  it('enforces optimistic product updates and reports unique SKU conflict safely', async () => {
    const a = await service.createProduct(owner, item());
    await service.updateProduct(owner, a.id, { version: 1, name: 'Updated' });
    await expect(service.updateProduct(owner, a.id, { version: 1, name: 'Stale' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(service.createProduct(owner, item())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.getProduct(owner, a.id)).name).toBe('Updated');
  });

  it('applies stock adjustment exactly once and rejects changed retries', async () => {
    const a = await service.createProduct(owner, item());
    const input = { delta: -2, reason: 'Damaged goods', version: a.version, idempotencyKey: 'stock-1' };
    const first = await service.adjustStock(owner, a.id, input);
    expect(first.stock).toBe(8);
    expect(await service.adjustStock(owner, a.id, input)).toEqual(first);
    await expect(service.adjustStock(owner, a.id, { ...input, delta: -3 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.adjustStock(owner, a.id, { delta: -9, reason: 'Count', idempotencyKey: 'stock-2' })).rejects.toMatchObject({ code: 'STOCK_LIMIT' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
    expect((await service.listAudit(owner)).filter(e => e.action === 'stock.adjusted')).toHaveLength(1);
  });

  it('reserves pending stock, cancels once, and never restocks twice', async () => {
    const a = await service.createProduct(owner, item());
    const sale = await service.createOrder(owner, { items: [{ productId: a.id, quantity: 3 }], channel: 'web', paymentMethod: 'manual', idempotencyKey: 'pending-1', customer: { name: 'Sensitive Buyer', email: 'buyer-private@example.com', address: 'Private Address 123' } });
    expect(sale.status).toBe('pending');
    expect(sale.customer?.email).toBe('buyer-private@example.com');
    expect((await service.getProduct(owner, a.id)).stock).toBe(7);
    await expect(service.updateOrderStatus({ ...owner, role: 'cashier' }, sale.id, { status: 'completed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await service.updateOrderStatus(owner, sale.id, { status: 'cancelled' })).status).toBe('cancelled');
    await service.updateOrderStatus(owner, sale.id, { status: 'cancelled' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    await expect(service.updateOrderStatus(owner, sale.id, { status: 'completed' })).rejects.toMatchObject({ code: 'ORDER_STATUS_CONFLICT' });
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.status.updated')).toHaveLength(1);
    const diagnostics = JSON.stringify(events) + JSON.stringify(await service.listAudit(owner));
    for (const sensitive of ['Sensitive Buyer', 'buyer-private', 'Private Address']) expect(diagnostics).not.toContain(sensitive);
  });

  it('counts completed revenue by currency without including pending reservations', async () => {
    const a = await service.createProduct(owner, item());
    const sale = await service.createOrder(owner, { items: [{ productId: a.id, quantity: 2 }], channel: 'web', paymentMethod: 'manual', idempotencyKey: 'confirm-1' });
    expect((await service.getDashboard(owner)).revenueByCurrency).toEqual([]);
    await service.updateOrderStatus(owner, sale.id, { status: 'completed' });
    await service.updateOrderStatus(owner, sale.id, { status: 'completed' });
    expect((await service.getDashboard(owner)).revenueByCurrency).toEqual([{ currency: 'USD', totalMinor: 2598 }]);
    expect((await service.getProduct(owner, a.id)).stock).toBe(8);
  });

  it('emits bounded outcome events and isolates telemetry exporter failures', async () => {
    await service.createProduct(owner, item({ name: 'SECRET_PRODUCT_NAME' }));
    await expect(service.createProduct(owner, item({ priceMinor: -1 }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(events.filter(e => e.name === 'commerce.operation.completed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ schemaVersion: 1, operation: 'product.create', outcome: 'success', durationMs: expect.any(Number) }),
      expect.objectContaining({ schemaVersion: 1, operation: 'product.create', outcome: 'rejected', errorCode: 'INVALID_INPUT' }),
    ]));
    expect(JSON.stringify(events)).not.toContain('SECRET_PRODUCT_NAME');
    expect(JSON.stringify(events)).not.toContain(owner.userId);
    const brokenSink = createCommerceService(db, { telemetry: () => { throw new Error('Exporter down'); } });
    expect(await brokenSink.listProducts(owner)).toHaveLength(1);
    await db.destroy();
    await expect(service.listProducts(owner)).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ outcome: 'failure', errorCode: 'INTERNAL_ERROR' });
  });
});
