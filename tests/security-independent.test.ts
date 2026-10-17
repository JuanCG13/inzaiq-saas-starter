import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { createCommerceService } from '../src/core/service';
import type { Actor, DomainEvent } from '../src/core/contracts';

// OAuth cryptography belongs to the transport. These tests independently exercise
// the live authorization decisions performed AFTER verified claims arrive.
vi.mock('../src/lib/auth', () => ({ getAuth: vi.fn() }));
import { actorFromVerifiedClaims, membershipActor } from '../src/lib/actor';
import { isLocalDemo, requestActor, storeActor } from '../src/lib/request-actor';
import { jsonBody, verifyOrigin } from '../src/lib/http';
import { POST as publicCheckout } from '../src/app/api/store/orders/route';
import { withOperation, withTelemetrySink } from '../src/lib/telemetry';
import { templateConfig } from '../src/template.config';

const owner: Actor = { userId: 'owner-a', tenantId: 'tenant-a', role: 'owner' };
const other: Actor = { userId: 'owner-b', tenantId: 'tenant-b', role: 'owner' };
const input = (sku: string, extras: Record<string, unknown> = {}) => ({
  sku, name: `Product ${sku}`, priceMinor: 1250, currency: 'USD', stock: 10, ...extras,
});

describe('independent HTTP trust boundaries', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const checkoutBody = {
    items: [{ productId: 'existing-product', quantity: 1 }],
    idempotencyKey: 'f8722f55-a908-4157-a5b7-053c76b1cc7d', expectedTotalMinor: 1250, expectedCurrency: 'USD',
    customer: { name: 'Private Customer', email: 'private-checkout@example.invalid' },
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/store/orders', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers }, body: JSON.stringify(body),
  });

  it('classifies returned authentication rejection and dependency failures without leaking response bodies', async () => {
    const records: Record<string, unknown>[] = [];
    for (const status of [401, 503]) {
      const response = await withTelemetrySink(record => records.push(record), () => withOperation('auth.request', {}, async () => new Response('sensitive-response-body', { status })));
      expect(response.status).toBe(status);
    }
    expect(records.map(record => record['event.outcome'])).toEqual(['rejected', 'failure']);
    expect(records.map(record => record['error.code'])).toEqual(['UNAUTHORIZED', 'HTTP_ERROR']);
    expect(JSON.stringify(records)).not.toContain('sensitive-response-body');
  });

  it('forbids demo mode in production and on remote hosts', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => isLocalDemo(new Request('http://localhost:3000/'))).toThrowError(expect.objectContaining({ code: 'DEMO_DISABLED' }));
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => isLocalDemo(new Request('https://customer-store.example/'))).toThrowError(expect.objectContaining({ code: 'DEMO_DISABLED' }));
    expect(() => isLocalDemo(new Request('http://localhost:3000/', { headers: { origin: 'https://attacker.example' } }))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    vi.stubEnv('STORE_TENANT_ID', 'configured-tenant');
    expect((await requestActor(new Request('http://localhost:3000/', { headers: { 'x-tenant-id': 'attacker-tenant' } }))).tenantId).toBe('configured-tenant');
    expect(storeActor().tenantId).toBe('configured-tenant');
  });

  it('rejects cross-site mutations and oversized bodies without Content-Length', async () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(() => verifyOrigin(post(checkoutBody, { origin: 'https://attacker.example' }))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => verifyOrigin(post(checkoutBody, { 'sec-fetch-site': 'cross-site' }))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    await expect(jsonBody(post({ oversized: 'x'.repeat(70_000) }))).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
  });

  it('rejects public tenant, payment and price injection before touching persistence', async () => {
    vi.stubEnv('STORE_TENANT_ID', 'configured-tenant');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    const records: Record<string, unknown>[] = [];
    for (const body of [
      { ...checkoutBody, tenantId: 'attacker-tenant' },
      { ...checkoutBody, paymentMethod: 'cash', channel: 'pos' },
      { ...checkoutBody, items: [{ ...checkoutBody.items[0], unitPriceMinor: 1 }] },
    ]) {
      const response = await withTelemetrySink(record => records.push(record), () => publicCheckout(post(body)));
      expect(response.status).toBe(templateConfig.kind === 'ecommerce' ? 400 : 404);
      expect((await response.json()).error.code).toBe(templateConfig.kind === 'ecommerce' ? 'INVALID_INPUT' : 'MODULE_DISABLED');
    }
    expect(JSON.stringify(records)).not.toContain(checkoutBody.customer.email);
    expect(records).toHaveLength(3);
    for (const record of records) expect(record['event.outcome']).toBe('rejected');
  });
});

describe.each(['libsql', 'postgres-wasm'] as const)('independent security: %s', engine => {
  let db: Kysely<Database>;
  let service: ReturnType<typeof createCommerceService>;
  let databaseDirectory: string | undefined;
  const events: DomainEvent[] = [];

  beforeAll(async () => {
    if (engine === 'libsql') databaseDirectory = await mkdtemp(join(tmpdir(), 'commerce-independent-'));
    db = engine === 'libsql'
      ? createDatabase({ provider: 'sqlite', url: `file:${join(databaseDirectory!, 'qa.db')}` })
      : new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
    await migrateDatabase(db, { provider: engine === 'postgres-wasm' ? 'postgres' : 'sqlite' });
    // Minimal fixtures mirror the documented Better Auth columns used by actor.ts;
    // these are not a substitute for the separate real Better Auth migration tests.
    await sql`create table "member" ("userId" text not null, "organizationId" text not null, "role" text not null)`.execute(db);
    await sql`create table "oauthConsent" ("userId" text not null, "clientId" text not null, "referenceId" text not null, "scopes" text not null)`.execute(db);
    service = createCommerceService(db, { telemetry: event => events.push(event) });
  }, 30_000);

  beforeEach(async () => {
    for (const table of ['commerce_order_items', 'commerce_stock_operations', 'commerce_orders', 'commerce_audit', 'commerce_products'] as const) await db.deleteFrom(table).execute();
    await sql`delete from "member"`.execute(db);
    await sql`delete from "oauthConsent"`.execute(db);
    events.length = 0;
  });
  afterAll(async () => {
    await db?.destroy();
    if (databaseDirectory) await rm(databaseDirectory, { recursive: true, force: true });
  });

  it('isolates tenant reads, mutations, orders, audit and uniqueness', async () => {
    const a = await service.createProduct(owner, input('shared-sku'));
    const b = await service.createProduct(other, input('shared-sku'));
    await expect(service.getProduct(other, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateProduct(other, a.id, { name: 'Takeover', version: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.adjustStock(other, a.id, { delta: 2, reason: 'Attack', idempotencyKey: 'cross-tenant' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.createOrder(other, { items: [{ productId: a.id, quantity: 1 }], idempotencyKey: 'cross-order', channel: 'pos', paymentMethod: 'cash' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await service.listProducts(owner)).map(p => p.id)).toEqual([a.id]);
    expect((await service.listProducts(other)).map(p => p.id)).toEqual([b.id]);
    expect(await service.listOrders(other)).toEqual([]);
    expect((await service.listAudit(other)).map(e => e.resourceId)).toEqual([b.id]);
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    await expect(service.createProduct(owner, input('shared-sku'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('intersects current role with OAuth scopes, including explicit empty grants', async () => {
    const product = await service.createProduct(owner, input('roles'));
    await expect(service.createProduct({ ...owner, role: 'cashier', scopes: ['products:write'] }, input('no'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listProducts({ ...owner, scopes: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.adjustStock({ ...owner, scopes: ['products:read'] }, product.id, { delta: 1, reason: 'No write', idempotencyKey: 'no' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listAudit({ ...owner, role: 'viewer', scopes: ['audit:read'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.listProducts({ ...owner, role: 'viewer', scopes: ['products:read'] })).toHaveLength(1);
  });

  it('uses authoritative prices and idempotency hashes after canonicalizing quantities', async () => {
    const product = await service.createProduct(owner, input('idempotency'));
    const args = { items: [{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 2 }], idempotencyKey: 'sale-1', channel: 'pos' as const, paymentMethod: 'cash' as const };
    const order = await service.createOrder(owner, args);
    const replay = await service.createOrder(owner, { ...args, items: [{ productId: product.id, quantity: 3 }] });
    expect(replay.id).toBe(order.id);
    expect(order.totalMinor).toBe(3750);
    expect(order.items).toHaveLength(1);
    expect((await service.getProduct(owner, product.id)).stock).toBe(7);
    await expect(service.createOrder(owner, { ...args, paymentMethod: 'manual' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.createOrder(owner, { ...args, idempotencyKey: 'injected-price', items: [{ productId: product.id, quantity: 1, unitPriceMinor: 1 } as never] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await service.listOrders(owner)).toHaveLength(1);
  });

  it('binds stock idempotency to product, delta and reason', async () => {
    const product = await service.createProduct(owner, input('stock-idempotency'));
    const args = { delta: -2, reason: 'Damaged', idempotencyKey: 'adjust-1' };
    const first = await service.adjustStock(owner, product.id, args);
    expect(await service.adjustStock(owner, product.id, args)).toEqual(first);
    await expect(service.adjustStock(owner, product.id, { ...args, delta: -3 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.adjustStock(owner, product.id, { ...args, reason: 'Different reason' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await service.getProduct(owner, product.id)).stock).toBe(8);
    expect((await service.listAudit(owner)).filter(e => e.action === 'stock.adjusted')).toHaveLength(1);
  });

  if (engine === 'libsql') it('prevents overselling across two real database connections', async () => {
    const secondDb = createDatabase({ provider: 'sqlite', url: `file:${join(databaseDirectory!, 'qa.db')}` });
    try {
      const secondService = createCommerceService(secondDb);
      const product = await service.createProduct(owner, input('last-unit', { stock: 1 }));
      const args = { items: [{ productId: product.id, quantity: 1 }], channel: 'pos' as const, paymentMethod: 'cash' as const };
      const results = await Promise.allSettled([
        service.createOrder(owner, { ...args, idempotencyKey: 'buyer-one' }),
        secondService.createOrder(owner, { ...args, idempotencyKey: 'buyer-two' }),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect((await service.getProduct(owner, product.id)).stock).toBe(0);
      expect(await service.listOrders(owner)).toHaveLength(1);
      expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(1);
    } finally { await secondDb.destroy(); }
  });

  it('rolls every stock mutation and idempotency claim back on mixed currency', async () => {
    const a = await service.createProduct(owner, input('usd'));
    const b = await service.createProduct(owner, input('eur', { currency: 'EUR' }));
    const args = { items: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 2 }], idempotencyKey: 'rollback', channel: 'pos' as const, paymentMethod: 'cash' as const };
    await expect(service.createOrder(owner, args)).rejects.toMatchObject({ code: 'MIXED_CURRENCY' });
    expect((await service.getProduct(owner, a.id)).stock).toBe(10);
    expect((await service.getProduct(owner, b.id)).stock).toBe(10);
    expect(await service.listOrders(owner)).toHaveLength(0);
    expect(await db.selectFrom('commerce_order_items').selectAll().execute()).toHaveLength(0);
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.created')).toHaveLength(0);
    // Failed requests do not poison their idempotency key.
    expect((await service.createOrder(owner, { ...args, items: [{ productId: a.id, quantity: 2 }] })).totalMinor).toBe(2500);
  });

  it('restores a cancelled reservation once and prevents unauthorized state changes', async () => {
    const product = await service.createProduct(owner, input('cancel'));
    const order = await service.createOrder(owner, { items: [{ productId: product.id, quantity: 2 }], idempotencyKey: 'pending', channel: 'web', paymentMethod: 'manual' });
    expect(order.status).toBe('pending');
    expect((await service.getDashboard(owner)).revenueByCurrency).toEqual([]);
    await expect(service.updateOrderStatus({ ...owner, role: 'cashier' }, order.id, { status: 'completed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.updateOrderStatus(other, order.id, { status: 'cancelled' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.updateOrderStatus(owner, order.id, { status: 'cancelled' })).status).toBe('cancelled');
    expect((await service.updateOrderStatus(owner, order.id, { status: 'cancelled' })).status).toBe('cancelled');
    expect((await service.getProduct(owner, product.id)).stock).toBe(10);
    await expect(service.updateOrderStatus(owner, order.id, { status: 'completed' })).rejects.toMatchObject({ code: 'ORDER_STATUS_CONFLICT' });
    expect((await service.listAudit(owner)).filter(e => e.action === 'order.status.updated')).toHaveLength(1);
  });

  it('rolls back an order if its mandatory audit write fails', async () => {
    const product = await service.createProduct(owner, input('audit-failure'));
    await sql`alter table commerce_audit rename to commerce_audit_unavailable`.execute(db);
    try {
      await expect(service.createOrder(owner, { items: [{ productId: product.id, quantity: 1 }], idempotencyKey: 'audit-fail', channel: 'pos', paymentMethod: 'cash' })).rejects.toThrow();
      expect((await service.getProduct(owner, product.id)).stock).toBe(10);
      expect(await service.listOrders(owner)).toHaveLength(0);
      expect(await db.selectFrom('commerce_order_items').selectAll().execute()).toHaveLength(0);
      expect(events).toContainEqual(expect.objectContaining({ operation: 'order.create', outcome: 'failure', errorCode: 'INTERNAL_ERROR' }));
    } finally { await sql`alter table commerce_audit_unavailable rename to commerce_audit`.execute(db); }
  });

  it('enforces tenant foreign keys inside the database', async () => {
    const a = await service.createProduct(owner, input('a'));
    const b = await service.createProduct(other, input('b'));
    const order = await service.createOrder(owner, { items: [{ productId: a.id, quantity: 1 }], idempotencyKey: 'fk', channel: 'pos', paymentMethod: 'cash' });
    await expect(db.insertInto('commerce_order_items').values({ id: 'bad-fk', tenant_id: owner.tenantId, order_id: order.id, product_id: b.id, sku: 'b', name: 'cross tenant', quantity: 1, unit_price_minor: 1, total_minor: 1 }).execute()).rejects.toThrow();
    await expect(db.updateTable('commerce_products').set({ stock: -1 }).where('id', '=', a.id).execute()).rejects.toThrow();
  });

  if (engine === 'postgres-wasm') it('denies untrusted SQL roles through real PostgreSQL RLS', async () => {
    const product = await service.createProduct(owner, input('rls'));
    const flags = await sql<{ relrowsecurity: boolean }>`select relrowsecurity from pg_class where relname = 'commerce_products'`.execute(db);
    expect(flags.rows[0]?.relrowsecurity).toBe(true);
    await sql`create role independent_untrusted`.execute(db);
    await sql`grant select, update on commerce_products to independent_untrusted`.execute(db);
    await sql`set role independent_untrusted`.execute(db);
    try {
      expect(await db.selectFrom('commerce_products').selectAll().execute()).toEqual([]);
      const result = await db.updateTable('commerce_products').set({ stock: 999 }).where('id', '=', product.id).executeTakeFirstOrThrow();
      expect(Number(result.numUpdatedRows)).toBe(0);
    } finally { await sql`reset role`.execute(db); }
    expect((await service.getProduct(owner, product.id)).stock).toBe(10);
  });

  it('preserves literal search behavior on both supported SQL families', async () => {
    await service.createProduct(owner, input('literal-percent', { name: '100% cotton' }));
    await service.createProduct(owner, input('literal-underscore', { name: 'A_B shirt' }));
    await service.createProduct(owner, input('ordinary', { name: '1000 cotton ACB' }));
    expect((await service.listProducts(owner, { search: '100%' })).map(p => p.sku)).toEqual(['literal-percent']);
    expect((await service.listProducts(owner, { search: 'A_B' })).map(p => p.sku)).toEqual(['literal-underscore']);
  });

  it('redacts payloads and keeps commerce working when telemetry throws', async () => {
    const secret = 'private-customer@example.invalid';
    const serviceWithBrokenSink = createCommerceService(db, { telemetry() { throw new Error('exporter unavailable'); } });
    expect((await serviceWithBrokenSink.createProduct(owner, input('sink-fail'))).stock).toBe(10);
    const product = await service.createProduct(owner, input('telemetry', { name: secret }));
    await service.adjustStock(owner, product.id, { delta: -1, reason: secret, idempotencyKey: 'secret-key' });
    await expect(service.listProducts({ ...owner, scopes: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const serialized = JSON.stringify(events);
    for (const forbidden of [secret, 'secret-key', owner.userId, owner.tenantId]) expect(serialized).not.toContain(forbidden);
    expect(events).toContainEqual(expect.objectContaining({ name: 'commerce.operation.completed', schemaVersion: 1, outcome: 'rejected', errorCode: 'FORBIDDEN' }));
    for (const event of events) expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rechecks tenant membership, role downgrade and revoked consent for verified tokens', async () => {
    await sql`insert into "member" ("userId", "organizationId", "role") values (${owner.userId}, ${owner.tenantId}, ${'owner'})`.execute(db);
    const claims = { sub: owner.userId, tenant_id: owner.tenantId, client_id: 'approved-client', scope: 'products:read products:write' };
    await expect(actorFromVerifiedClaims(claims, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await sql`insert into "oauthConsent" ("userId", "clientId", "referenceId", "scopes") values (${owner.userId}, ${'approved-client'}, ${owner.tenantId}, ${JSON.stringify(['products:read', 'products:write'])})`.execute(db);
    expect((await actorFromVerifiedClaims(claims, db)).role).toBe('owner');
    await sql`update "member" set "role" = ${'viewer'}`.execute(db);
    const downgraded = await actorFromVerifiedClaims(claims, db);
    expect(downgraded.role).toBe('viewer');
    await expect(service.createProduct(downgraded, input('cannot-write'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await sql`update "oauthConsent" set "scopes" = ${JSON.stringify(['products:read'])}`.execute(db);
    await expect(actorFromVerifiedClaims(claims, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(actorFromVerifiedClaims({ ...claims, tenant_id: other.tenantId }, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await sql`delete from "member"`.execute(db);
    await expect(membershipActor(owner.userId, owner.tenantId, undefined, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
