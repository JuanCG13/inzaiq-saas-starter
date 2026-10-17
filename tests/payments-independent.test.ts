import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Database } from '../src/db/schema';
import type { PaymentProvider } from '../src/payments/contracts';
import type { Actor, Order, Product } from '../src/core/contracts';

// Substitute only the external network call and the application's database handle.
// Requests, validation, Stripe's official signature verifier and SQL are real.
const fixture = vi.hoisted(() => ({ db: undefined as Kysely<Database> | undefined, provider: undefined as PaymentProvider | undefined }));
vi.mock('../src/db', async importOriginal => ({
  ...await importOriginal<typeof import('../src/db')>(),
  getDatabase: () => { if (!fixture.db) throw new Error('Missing QA database'); return fixture.db; },
}));
vi.mock('../src/payments/registry', () => ({ getPaymentProvider: (id?: string) => {
  if (id && id !== 'stripe') throw new Error('Unknown test provider');
  return fixture.provider;
} }));
import { createDatabase, migrateDatabase } from '../src/db';
import { createCommerceService } from '../src/core/service';
import { StripePaymentProvider } from '../src/payments/providers/stripe';
import { POST as checkout } from '../src/app/api/store/orders/route';
import { POST as resume } from '../src/app/api/store/checkout/resume/route';
import { POST as webhook } from '../src/app/api/payments/webhooks/[provider]/route';
import { PATCH as manualStatus } from '../src/app/api/admin/orders/[id]/route';
import { withTelemetrySink } from '../src/lib/telemetry';

const origin = 'http://localhost:3000';
const actor: Actor = { userId: 'qa-payments-owner', tenantId: 'qa-payments-a', role: 'owner' };
const signingSecret = ['whsec', 'independentfixture'].join('_');
let directory: string;
let stripe: Stripe;
let commerce: ReturnType<typeof createCommerceService>;
let product: Product;
let calls: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DEMO_MODE', 'true');
  vi.stubEnv('APP_URL', origin); vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('STORE_TENANT_ID', actor.tenantId);
  directory = await mkdtemp(join(tmpdir(), 'payment-independent-'));
  fixture.db = createDatabase({ provider: 'sqlite', url: 'file:' + join(directory, 'qa.db') });
  await migrateDatabase(fixture.db);
  commerce = createCommerceService(fixture.db);
  product = await commerce.createProduct(actor, { sku: 'QA-PAY', name: 'Product with private customer fixture', priceMinor: 750, currency: 'USD', stock: 10 });
  const secretKey = ['rk', 'test', 'independentfixture'].join('_');
  stripe = new Stripe(secretKey);
  calls = vi.spyOn(stripe.checkout.sessions, 'create').mockImplementation(async params => ({
    id: 'cs_test_' + params!.metadata!.orderId, object: 'checkout.session', mode: 'payment', livemode: false,
    amount_total: params!.line_items![0].price_data!.unit_amount, currency: params!.line_items![0].price_data!.currency,
    metadata: params!.metadata, payment_status: 'unpaid',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    url: 'https://checkout.stripe.com/c/pay/' + params!.metadata!.orderId,
  } as Stripe.Response<Stripe.Checkout.Session>));
  fixture.provider = new StripePaymentProvider({ secretKey, webhookSecret: signingSecret, client: stripe });
});
afterEach(async () => {
  await fixture.db?.destroy(); fixture.db = undefined; fixture.provider = undefined;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
});
const body = (idempotencyKey = randomUUID()) => ({
  items: [{ productId: product.id, quantity: 2 }], idempotencyKey, expectedTotalMinor: 1500, expectedCurrency: 'USD',
  customer: { name: 'Sensitive Customer', email: 'sensitive-payment@example.invalid', phone: '555-private' },
});
function request(path: string, input: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(origin + path, { method, headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(input) });
}
async function prepare() {
  const input = body();
  const response = await checkout(request('/api/store/orders', input, { 'x-checkout-protocol': 'hosted-v1' }));
  expect(response.status).toBe(201);
  const data = (await response.json()).data as { order: Order; checkout: { kind: string; url: string } };
  expect(data.order.status).toBe('pending');
  return { ...data, input };
}
async function signed(order: Order, type = 'checkout.session.completed', overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  const attempt = await fixture.db!.selectFrom('commerce_payment_attempts').selectAll().where('order_id', '=', order.id).executeTakeFirstOrThrow();
  const raw = JSON.stringify({
    id: 'evt_' + randomUUID(), object: 'event', created: Math.floor(Date.now() / 1000), type, livemode: false,
    data: { object: {
      id: attempt.session_id, object: 'checkout.session', mode: 'payment', livemode: false,
      amount_total: order.totalMinor, currency: order.currency.toLowerCase(),
      payment_status: type.includes('failed') || type.includes('expired') ? 'unpaid' : 'paid',
      metadata: { tenantId: actor.tenantId, orderId: order.id }, ...overrides,
    } }, ...eventOverrides,
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: signingSecret });
  return { raw, signature };
}
function deliver(value: { raw: string; signature: string }, headers: Record<string, string> = {}) {
  return webhook(new Request(origin + '/api/payments/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': value.signature, ...headers }, body: value.raw }), { params: Promise.resolve({ provider: 'stripe' }) });
}

test('old checkout clients and injected provider/tenant/price fields cannot reserve stock', async () => {
  const input = body();
  const old = await checkout(request('/api/store/orders', input));
  expect(old.status).toBe(409); expect((await old.json()).error.code).toBe('CLIENT_UPGRADE_REQUIRED');
  for (const injected of [
    { ...input, tenantId: 'qa-payments-b' }, { ...input, paymentProvider: 'manual' },
    { ...input, paymentMethod: 'cash' }, { ...input, items: [{ ...input.items[0], unitPriceMinor: 1 }] },
  ]) expect((await checkout(request('/api/store/orders', injected, { 'x-checkout-protocol': 'hosted-v1' }))).status).toBe(400);
  expect(await commerce.listOrders(actor)).toEqual([]);
  expect((await commerce.getProduct(actor, product.id)).stock).toBe(10);
  expect(calls).not.toHaveBeenCalled();
});

test('signed Stripe webhook is bound to the persisted tenant, order, amount, currency and session before fulfillment', async () => {
  const { order } = await prepare();
  for (const override of [
    { metadata: { tenantId: 'qa-payments-b', orderId: order.id } },
    { metadata: { tenantId: actor.tenantId, orderId: randomUUID() } },
    { amount_total: 1 }, { currency: 'eur' }, { id: 'cs_test_other' },
  ]) {
    const response = await deliver(await signed(order, 'checkout.session.completed', override));
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('PAYMENT_EVENT_MISMATCH');
  }
  expect((await commerce.getOrder(actor, order.id)).status).toBe('pending');
  expect(await fixture.db!.selectFrom('commerce_payment_events').selectAll().execute()).toEqual([]);
  for (const status of ['completed', 'cancelled']) {
    const response = await manualStatus(request('/api/admin/orders/' + order.id, { status }, {}, 'PATCH'), { params: Promise.resolve({ id: order.id }) });
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('PAYMENT_PROVIDER_MANAGED');
  }
  const paid = await signed(order);
  expect((await deliver(paid)).status).toBe(200);
  expect(await (await deliver(paid)).json()).toEqual({ received: true, outcome: 'duplicate' });
  const alteredEvent = JSON.parse(paid.raw); alteredEvent.created += 1;
  const raw = JSON.stringify(alteredEvent);
  const conflicting = await deliver({ raw, signature: stripe.webhooks.generateTestHeaderString({ payload: raw, secret: signingSecret }) });
  expect(conflicting.status).toBe(409); expect((await conflicting.json()).error.code).toBe('PAYMENT_EVENT_CONFLICT');
  expect((await commerce.getOrder(actor, order.id)).status).toBe('completed');
  expect((await commerce.getProduct(actor, product.id)).stock).toBe(8);
  expect(await fixture.db!.selectFrom('commerce_payment_events').selectAll().execute()).toHaveLength(1);
});

test.each(['checkout.session.async_payment_failed', 'checkout.session.expired'])('%s restores stock once even when failure, expiry and retry notifications overlap', async type => {
  const { order } = await prepare();
  const event = await signed(order, type);
  const deliveries = await Promise.all([deliver(event), deliver(event)]);
  const results = await Promise.all(deliveries.map(response => response.json()));
  expect(results.map(result => result.outcome).sort()).toEqual(['applied', 'duplicate']);
  expect(await (await deliver(await signed(order, 'checkout.session.expired'))).json()).toEqual({ received: true, outcome: 'ignored' });
  expect((await commerce.getProduct(actor, product.id)).stock).toBe(10);
  expect((await commerce.getOrder(actor, order.id)).status).toBe('cancelled');
  expect((await commerce.listAudit(actor)).filter(event => event.action === 'payment.status.updated')).toHaveLength(1);
});

test('resume UUID is a tenant-bound narrow capability and never discloses order/customer data or telemetry secrets', async () => {
  const records: Record<string, unknown>[] = [];
  await withTelemetrySink(record => records.push(record), async () => {
    const { input, order, checkout: redirect } = await prepare();
    for (const invalid of [{ idempotencyKey: 'guessable-key' }, { idempotencyKey: input.idempotencyKey, tenantId: actor.tenantId }]) {
      expect((await resume(request('/api/store/checkout/resume', invalid))).status).toBe(400);
    }
    vi.stubEnv('STORE_TENANT_ID', 'qa-payments-b');
    const foreign = await resume(request('/api/store/checkout/resume', { idempotencyKey: input.idempotencyKey }, { 'x-tenant-id': actor.tenantId }));
    expect((await foreign.json()).data).toEqual({ state: 'not_found' });
    vi.stubEnv('STORE_TENANT_ID', actor.tenantId);
    const pending = await resume(request('/api/store/checkout/resume', { idempotencyKey: input.idempotencyKey }));
    expect(pending.headers.get('cache-control')).toBe('no-store');
    expect((await pending.json()).data).toEqual({ state: 'pending', checkout: redirect });
    await deliver(await signed(order));
    const paid = await resume(request('/api/store/checkout/resume', { idempotencyKey: input.idempotencyKey }));
    expect((await paid.json()).data).toEqual({ state: 'completed' });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(records)).not.toContain(input.idempotencyKey);
    expect(JSON.stringify(records)).not.toContain(redirect.url);
  });
  for (const secret of ['Sensitive Customer', 'sensitive-payment@example.invalid', '555-private', signingSecret]) expect(JSON.stringify(records)).not.toContain(secret);
});

test('webhook HTTP verifies exact raw bytes, rejects oversized streamed payload despite false Content-Length and redacts failures', async () => {
  const { order } = await prepare();
  const signedEvent = await signed(order);
  const records: Record<string, unknown>[] = [];
  await withTelemetrySink(record => records.push(record), async () => {
    for (const invalid of [{ ...signedEvent, signature: '' }, { ...signedEvent, raw: signedEvent.raw + ' ' }]) {
      const response = await deliver(invalid);
      expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    }
    const oversized = await deliver({ raw: 'x'.repeat(262145), signature: signedEvent.signature }, { 'content-length': '1' });
    expect(oversized.status).toBe(413); expect((await oversized.json()).error.code).toBe('BODY_TOO_LARGE');
    const media = await deliver(signedEvent, { 'content-type': 'text/plain' });
    expect(media.status).toBe(415);
  });
  expect((await commerce.getOrder(actor, order.id)).status).toBe('pending');
  expect(await fixture.db!.selectFrom('commerce_payment_events').selectAll().execute()).toEqual([]);
  expect(records.some(record => record['error.code'] === 'PAYMENT_SIGNATURE_INVALID' && record['event.outcome'] === 'rejected')).toBe(true);
  expect(JSON.stringify(records)).not.toContain(signedEvent.signature);
  expect(JSON.stringify(records)).not.toContain(signedEvent.raw);
});
