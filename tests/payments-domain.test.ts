import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { AppError, type Actor } from '../src/core/contracts';
import { createCommerceService } from '../src/core/service';
import { createPaymentService } from '../src/payments/service';
import type { CheckoutInput, CheckoutResult, HostedCheckout, PaymentEvent, PaymentProvider } from '../src/payments/contracts';
import { withTelemetrySink } from '../src/lib/telemetry';

const actor: Actor = { userId: 'payment-owner', tenantId: 'payment-tenant', role: 'owner' };
const urls = { successUrl: 'https://shop.example/checkout/success', cancelUrl: 'https://shop.example/cart' };
const headers = new Headers({ 'test-signature': 'verified' });
class FakeProvider implements PaymentProvider {
  id = 'testpay';
  idempotencyRetentionMs = 23 * 60 * 60 * 1000;
  sessions = new Map<string, HostedCheckout>();
  calls = 0;
  failAfterCreate = false;
  validateCheckoutInput(input: CheckoutInput) {
    if (input.currency !== 'USD') throw new AppError('PAYMENT_CURRENCY_UNSUPPORTED', 'Unsupported payment currency.', 400);
  }
  async createCheckout(input: CheckoutInput): Promise<HostedCheckout> {
    this.calls++;
    let session = this.sessions.get(input.idempotencyKey);
    if (!session) {
      session = { sessionId: `session-${input.orderId}`, url: `https://checkout.example/${input.orderId}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
      this.sessions.set(input.idempotencyKey, session);
    }
    if (this.failAfterCreate) { this.failAfterCreate = false; throw new Error('Secret provider response should never leak'); }
    return session;
  }
  async verifyWebhook(rawBody: string, receivedHeaders: Headers): Promise<PaymentEvent | null> {
    if (receivedHeaders.get('test-signature') !== 'verified') throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Invalid signature.', 400);
    return JSON.parse(rawBody) as PaymentEvent | null;
  }
}

describe.each(['libsql', 'postgres-wasm'] as const)('payment orchestration: %s', engine => {
  let db: Kysely<Database>;
  let directory: string | undefined;
  let commerce: ReturnType<typeof createCommerceService>;
  let payments: ReturnType<typeof createPaymentService>;
  let provider: FakeProvider;
  const records: Record<string, unknown>[] = [];
  const check = (name: string, run: () => Promise<void>) => it(name, () => withTelemetrySink(record => records.push(record), run));
  beforeAll(async () => {
    if (engine === 'libsql') directory = await mkdtemp(join(tmpdir(), 'payment-domain-'));
    db = engine === 'libsql'
      ? createDatabase({ provider: 'sqlite', url: 'file:' + join(directory!, 'payments.db') })
      : new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
    await migrateDatabase(db, { provider: engine === 'libsql' ? 'sqlite' : 'postgres' });
    commerce = createCommerceService(db);
    payments = createPaymentService(db);
  }, 30_000);
  beforeEach(async () => {
    for (const table of ['commerce_payment_events', 'commerce_payment_attempts', 'commerce_order_items', 'commerce_stock_operations', 'commerce_orders', 'commerce_audit', 'commerce_products', 'commerce_runtime_settings'] as const) await db.deleteFrom(table).execute();
    provider = new FakeProvider();
    records.length = 0;
  });
  afterAll(async () => { await db.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function prepare(key = 'payment-key-1') {
    const product = await commerce.createProduct(actor, { sku: key, name: 'Secret product', priceMinor: 1250, currency: 'USD', stock: 5 });
    const input = { items: [{ productId: product.id, quantity: 2 }], channel: 'web' as const, paymentMethod: 'manual' as const, expectedTotalMinor: 2500, expectedCurrency: 'USD', idempotencyKey: key, customer: { name: 'Private Customer', email: 'private-customer@example.com' } };
    return { product, input };
  }
  async function eventFor(checkout: CheckoutResult, type: PaymentEvent['type'] = 'paid', id = 'event-1'): Promise<PaymentEvent> {
    const attempt = await db.selectFrom('commerce_payment_attempts').selectAll().where('order_id', '=', checkout.order.id).executeTakeFirstOrThrow();
    return { id, type, provider: provider.id, sessionId: attempt.session_id!, orderId: checkout.order.id, tenantId: actor.tenantId, amountMinor: checkout.order.totalMinor, currency: checkout.order.currency, occurredAt: '2026-10-17T00:00:00.000Z' };
  }
  const deliver = (event: PaymentEvent) => payments.processWebhook(provider, JSON.stringify(event), headers);

  check('reserves once and persists session before returning a redirect; retries reuse it', async () => {
    const { product, input } = await prepare();
    const first = await payments.createHostedCheckout(actor, input, provider, urls);
    const replay = await payments.createHostedCheckout(actor, input, provider, urls);
    expect(replay).toEqual(first);
    expect(first.order.paymentProvider).toBe(provider.id);
    expect(first.order.status).toBe('pending');
    expect(provider.calls).toBe(1);
    expect(provider.sessions.size).toBe(1);
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    const attempt = await db.selectFrom('commerce_payment_attempts').selectAll().executeTakeFirstOrThrow();
    expect(attempt.session_id).toBeTruthy();
    expect(attempt.checkout_url).toBe(first.checkout.url);
    const resumed = await payments.resumeHostedCheckout(actor.tenantId, input.idempotencyKey, () => provider, urls);
    expect(resumed).toEqual({ state: 'pending', checkout: first.checkout });
    expect(JSON.stringify(resumed)).not.toContain('Private Customer');
  });

  check('recovers an unknown remote result with the same provider key and refuses stale unbound retries', async () => {
    const { product, input } = await prepare();
    provider.failAfterCreate = true;
    await expect(payments.createHostedCheckout(actor, input, provider, urls)).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    expect(provider.sessions.size).toBe(1);
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    expect((await payments.resumeHostedCheckout(actor.tenantId, input.idempotencyKey, () => provider, urls)).checkout?.url).toMatch(/^https:/);
    expect(provider.sessions.size).toBe(1);
    const second = await prepare('second-attempt');
    provider.failAfterCreate = true;
    await expect(payments.createHostedCheckout(actor, second.input, provider, urls)).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    await db.updateTable('commerce_payment_attempts').set({ retry_until: '2000-01-01T00:00:00.000Z' }).where('session_id', 'is', null).execute();
    const callCount = provider.calls;
    await expect(payments.resumeHostedCheckout(actor.tenantId, second.input.idempotencyKey, () => provider, urls)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(provider.calls).toBe(callCount);
  });

  check('validates supported currency before reserving stock and blocks manual confirmation/cancellation', async () => {
    const { product, input } = await prepare();
    await expect(payments.createHostedCheckout(actor, { ...input, expectedCurrency: 'EUR' }, provider, urls)).rejects.toMatchObject({ code: 'PAYMENT_CURRENCY_UNSUPPORTED' });
    expect(await commerce.listOrders(actor)).toHaveLength(0);
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(5);
    const checkout = await payments.createHostedCheckout(actor, input, provider, urls);
    for (const status of ['completed', 'cancelled'] as const) await expect(commerce.updateOrderStatus(actor, checkout.order.id, { status })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_MANAGED' });
    expect((await commerce.getOrder(actor, checkout.order.id)).status).toBe('pending');
  });

  check('enforces runtime order admission inside the transaction while preserving accepted retries', async () => {
    const { product, input } = await prepare();
    const accepted = await payments.createHostedCheckout(actor, input, provider, urls);
    await db.insertInto('commerce_runtime_settings').values({ tenant_id: actor.tenantId, version: 1, accepting_orders: 0, notice: 'Paused', updated_at: new Date().toISOString() }).execute();
    expect((await payments.createHostedCheckout(actor, input, provider, urls)).order.id).toBe(accepted.order.id);
    await expect(payments.createHostedCheckout(actor, { ...input, idempotencyKey: 'new-while-paused' }, provider, urls)).rejects.toMatchObject({ code: 'ORDERS_PAUSED' });
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    expect(await commerce.listOrders(actor)).toHaveLength(1);
    expect(provider.sessions.size).toBe(1);
  });

  check('accepts paid only through a verified matching session, deduplicates events and ignores late expiry', async () => {
    const { product, input } = await prepare();
    const checkout = await payments.createHostedCheckout(actor, input, provider, urls);
    const paid = await eventFor(checkout);
    await expect(payments.processWebhook(provider, JSON.stringify(paid), new Headers())).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
    for (const mismatch of [{ amountMinor: 1 }, { currency: 'EUR' }, { sessionId: 'different-session' }, { tenantId: 'different-tenant' }, { orderId: 'different-order' }]) {
      await expect(deliver({ ...paid, ...mismatch })).rejects.toMatchObject({ code: 'PAYMENT_EVENT_MISMATCH' });
    }
    expect(await db.selectFrom('commerce_payment_events').selectAll().execute()).toHaveLength(0);
    expect(await deliver(paid)).toEqual({ received: true, outcome: 'applied' });
    expect(await deliver(paid)).toEqual({ received: true, outcome: 'duplicate' });
    expect(await deliver(await eventFor(checkout, 'expired', 'late-expiry'))).toEqual({ received: true, outcome: 'ignored' });
    expect((await commerce.getOrder(actor, checkout.order.id)).status).toBe('completed');
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    expect((await commerce.listAudit(actor)).filter(e => e.action === 'payment.status.updated')).toHaveLength(1);
    expect(await payments.resumeHostedCheckout(actor.tenantId, input.idempotencyKey, () => provider, urls)).toEqual({ state: 'completed' });
  });

  check('restores expiry once and records reconciliation for paid after cancelled without false fulfillment', async () => {
    const { product, input } = await prepare();
    const checkout = await payments.createHostedCheckout(actor, input, provider, urls);
    const expired = await eventFor(checkout, 'expired');
    expect((await deliver(expired)).outcome).toBe('applied');
    expect((await deliver(expired)).outcome).toBe('duplicate');
    expect((await deliver(await eventFor(checkout, 'failed', 'late-failure'))).outcome).toBe('ignored');
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(5);
    expect((await deliver(await eventFor(checkout, 'paid', 'late-paid'))).outcome).toBe('reconciliation_required');
    expect((await commerce.getOrder(actor, checkout.order.id)).status).toBe('cancelled');
    expect((await commerce.getDashboard(actor)).revenueByCurrency).toEqual([]);
    expect((await db.selectFrom('commerce_payment_attempts').selectAll().executeTakeFirstOrThrow()).state).toBe('reconciliation_required');
    expect(records.some(record => record['event.name'] === 'commerce.payment.reconciliation_required')).toBe(true);
    expect(await payments.resumeHostedCheckout(actor.tenantId, input.idempotencyKey, () => provider, urls)).toEqual({ state: 'cancelled' });
  });

  check('deduplicates concurrent webhook deliveries and keeps inventory unchanged', async () => {
    const { product, input } = await prepare();
    const checkout = await payments.createHostedCheckout(actor, input, provider, urls);
    const paid = await eventFor(checkout);
    const outcomes = await Promise.all([deliver(paid), deliver(paid)]);
    expect(outcomes.map(result => result.outcome).sort()).toEqual(['applied', 'duplicate']);
    expect((await commerce.getOrder(actor, checkout.order.id)).status).toBe('completed');
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    expect(await db.selectFrom('commerce_payment_events').selectAll().execute()).toHaveLength(1);
  });

  check('handles concurrent checkout retries with one order and one provider session', async () => {
    const { product, input } = await prepare();
    const results = await Promise.all([payments.createHostedCheckout(actor, input, provider, urls), payments.createHostedCheckout(actor, input, provider, urls)]);
    expect(results[0].order.id).toBe(results[1].order.id);
    expect(results[0].checkout.url).toBe(results[1].checkout.url);
    expect(provider.sessions.size).toBe(1);
    expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
    expect(await commerce.listOrders(actor)).toHaveLength(1);
  });

  check('rolls event, status and stock restoration back if audit fails; redacts payloads', async () => {
    const { product, input } = await prepare();
    const checkout = await payments.createHostedCheckout(actor, input, provider, urls);
    const expired = await eventFor(checkout, 'expired');
    // An impossible resource ID length is not portable; a trigger is a real forced DB failure.
    if (engine === 'libsql') await sql`CREATE TRIGGER fail_payment_audit BEFORE INSERT ON commerce_audit WHEN NEW.action = 'payment.status.updated' BEGIN SELECT RAISE(ABORT, 'audit offline'); END`.execute(db);
    else {
      await sql`CREATE FUNCTION fail_payment_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'payment.status.updated' THEN RAISE EXCEPTION 'audit offline'; END IF; RETURN NEW; END $$`.execute(db);
      await sql`CREATE TRIGGER fail_payment_audit BEFORE INSERT ON commerce_audit FOR EACH ROW EXECUTE FUNCTION fail_payment_audit_fn()`.execute(db);
    }
    try {
      await expect(deliver(expired)).rejects.toThrow();
      expect((await commerce.getOrder(actor, checkout.order.id)).status).toBe('pending');
      expect((await commerce.getProduct(actor, product.id)).stock).toBe(3);
      expect(await db.selectFrom('commerce_payment_events').selectAll().execute()).toHaveLength(0);
    } finally {
      if (engine === 'libsql') await sql`DROP TRIGGER fail_payment_audit`.execute(db);
      else { await sql`DROP TRIGGER fail_payment_audit ON commerce_audit`.execute(db); await sql`DROP FUNCTION fail_payment_audit_fn()`.execute(db); }
    }
    expect((await deliver(expired)).outcome).toBe('applied');
    const serialized = JSON.stringify(records);
    for (const secret of ['Private Customer', 'private-customer', 'Secret product', 'Secret provider response', 'payment-key-1', expired.sessionId]) expect(serialized).not.toContain(secret);
    expect(records.some(record => record['event.outcome'] === 'failure')).toBe(true);
    expect(records.some(record => record['event.outcome'] === 'success')).toBe(true);
  });

  check('returns opaque recovery states and rejects callbacks before durable session binding', async () => {
    expect(await payments.resumeHostedCheckout(actor.tenantId, 'unknown-key', () => provider, urls)).toEqual({ state: 'not_found' });
    const { input } = await prepare();
    const manual = await commerce.createOrder(actor, input);
    expect(await payments.resumeHostedCheckout(actor.tenantId, input.idempotencyKey, () => provider, urls)).toEqual({ state: 'manual_received' });
    expect(manual.paymentProvider).toBeNull();
    const next = await prepare('unbound-attempt');
    provider.failAfterCreate = true;
    await expect(payments.createHostedCheckout(actor, next.input, provider, urls)).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    const order = (await commerce.listOrders(actor)).find(order => order.paymentProvider)!;
    const session = [...provider.sessions.values()][0]!;
    await expect(deliver({ id: 'early-webhook', provider: provider.id, sessionId: session.sessionId, orderId: order.id, tenantId: actor.tenantId, amountMinor: order.totalMinor, currency: order.currency, type: 'paid', occurredAt: '2026-10-17T00:00:00Z' })).rejects.toMatchObject({ code: 'PAYMENT_SESSION_UNBOUND' });
    expect(await db.selectFrom('commerce_payment_events').selectAll().execute()).toHaveLength(0);
  });
});
