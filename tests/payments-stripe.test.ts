import Stripe from 'stripe';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CheckoutInput } from '../src/payments/contracts';
import { STRIPE_INTEGRATION_IDENTIFIER, StripePaymentProvider } from '../src/payments/providers/stripe';
import { withTelemetrySink } from '../src/lib/telemetry';

const secretKey = ['rk', 'test', 'fixture'].join('_');
const webhookSecret = ['whsec', 'fixture'].join('_');
const client = new Stripe(secretKey);
const input: CheckoutInput = {
  orderId: 'order-123', tenantId: 'tenant-456', amountMinor: 2500, currency: 'USD',
  idempotencyKey: 'stripe:tenant-456:attempt-789',
  successUrl: 'https://store.example/checkout?result=success', cancelUrl: 'https://store.example/checkout?result=cancel',
};
const provider = () => new StripePaymentProvider({ secretKey, webhookSecret, client });
function session(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_fixture', object: 'checkout.session', mode: 'payment', livemode: false,
    amount_total: 2500, currency: 'usd', payment_status: 'paid',
    metadata: { orderId: input.orderId, tenantId: input.tenantId },
    url: 'https://checkout.stripe.com/c/pay/cs_test_fixture', expires_at: Math.floor(Date.now() / 1000) + 86400,
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}
function signedEvent(type = 'checkout.session.completed', object: unknown = session(), extras: Record<string, unknown> = {}) {
  const rawBody = JSON.stringify({ id: 'evt_fixture', object: 'event', created: Math.floor(Date.now() / 1000), livemode: false, type, data: { object }, ...extras });
  const signature = client.webhooks.generateTestHeaderString({ payload: rawBody, secret: webhookSecret });
  return { rawBody, headers: new Headers({ 'stripe-signature': signature }) };
}
let records: Record<string, unknown>[] = [];
beforeEach(() => { records = []; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function observed<T>(operation: () => Promise<T>) { return withTelemetrySink(record => records.push(record), operation); }

test('Checkout uses canonical minor units, dynamic methods and stable idempotency parameters', async () => {
  const result = session();
  const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue(result as Stripe.Response<Stripe.Checkout.Session>);
  const adapter = provider();
  const first = await observed(() => adapter.createCheckout(input));
  await observed(() => adapter.createCheckout(input));
  expect(first).toEqual({ sessionId: result.id, url: result.url, expiresAt: new Date(result.expires_at * 1000).toISOString() });
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  const [params, options] = create.mock.calls[0];
  expect(options).toEqual({ idempotencyKey: input.idempotencyKey });
  expect(params).toMatchObject({ mode: 'payment', ui_mode: 'hosted', integration_identifier: STRIPE_INTEGRATION_IDENTIFIER,
    adaptive_pricing: { enabled: false }, metadata: { orderId: input.orderId, tenantId: input.tenantId },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2500 } }],
  });
  expect(params).not.toHaveProperty('payment_method_types');
  expect(params).not.toHaveProperty('automatic_tax');
  expect(params).not.toHaveProperty('expires_at');
  expect(adapter.idempotencyRetentionMs).toBe(23 * 60 * 60 * 1000);
  expect(records).toHaveLength(2); expect(records[0]['event.outcome']).toBe('success');
});

test.each(['PYG', 'JPY', 'CLP', 'KRW'])('passes %s zero-decimal amount unchanged to Stripe', async currency => {
  const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue(session({ currency: currency.toLowerCase() }) as Stripe.Response<Stripe.Checkout.Session>);
  await observed(() => provider().createCheckout({ ...input, currency }));
  expect(create.mock.calls[0][0]?.line_items?.[0].price_data).toMatchObject({ currency: currency.toLowerCase(), unit_amount: 2500 });
});

test.each(['ISK', 'UGX', 'BHD', 'KWD', 'XXX', 'usd'])('rejects unimplemented currency %s before any Stripe call', currency => {
  const create = vi.spyOn(client.checkout.sessions, 'create');
  expect(() => provider().validateCheckoutInput({ ...input, currency })).toThrow(expect.objectContaining({ code: 'PAYMENT_CURRENCY_UNSUPPORTED' }));
  expect(create).not.toHaveBeenCalled();
});
test.each([-1, 1.2, NaN, Infinity, 100_000_000])('rejects unsafe amount %s before any Stripe call', amountMinor => {
  const create = vi.spyOn(client.checkout.sessions, 'create');
  expect(() => provider().validateCheckoutInput({ ...input, amountMinor })).toThrow(expect.objectContaining({ code: 'PAYMENT_INPUT_INVALID' }));
  expect(create).not.toHaveBeenCalled();
});
test('validates references and server return URLs without accepting unsafe schemes or credentials', () => {
  expect(() => provider().validateCheckoutInput({ ...input, successUrl: 'javascript:alert(1)' })).toThrow();
  expect(() => provider().validateCheckoutInput({ ...input, successUrl: 'https://user:password@store.example' })).toThrow();
  expect(() => provider().validateCheckoutInput({ ...input, tenantId: '../other-tenant' })).toThrow();
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => provider().validateCheckoutInput({ ...input, successUrl: 'http://localhost:3000/checkout' })).toThrow();
});

test.each([
  { url: 'https://checkout.stripe.com.evil.example/pay' }, { url: 'javascript:alert(1)' },
  { url: 'https://user:password@checkout.stripe.com/pay' }, { amount_total: 2501 },
  { currency: 'eur' }, { livemode: true }, { metadata: { orderId: 'other', tenantId: input.tenantId } },
  { id: undefined }, { expires_at: 8_640_000_000_001 },
  { currency: 123 },
])('rejects unexpected provider session binding or unsafe redirect: %j', async overrides => {
  vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue(session(overrides) as Stripe.Response<Stripe.Checkout.Session>);
  await expect(observed(() => provider().createCheckout(input))).rejects.toMatchObject({ code: 'PAYMENT_RESPONSE_INVALID' });
  expect(records[0]['event.outcome']).toBe('failure');
});
test('normalizes SDK failures and never emits provider messages, secrets or customer PII', async () => {
  const privateMessage = 'private-customer@example.test secret=do-not-disclose';
  vi.spyOn(client.checkout.sessions, 'create').mockRejectedValue(new Error(privateMessage));
  let error: unknown;
  try { await observed(() => provider().createCheckout(input)); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE', status: 503 });
  expect(String(error)).not.toContain(privateMessage);
  expect(JSON.stringify(records)).not.toContain(privateMessage);
  expect(JSON.stringify(records)).not.toContain(secretKey);
  expect(records).toHaveLength(1); expect(records[0]['error.code']).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
});

test.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])('verifies an actual signed %s and normalizes canonical fields', async type => {
  const event = signedEvent(type);
  const result = await observed(() => provider().verifyWebhook(event.rawBody, event.headers));
  expect(result).toMatchObject({ id: 'evt_fixture', provider: 'stripe', sessionId: 'cs_test_fixture', orderId: input.orderId, tenantId: input.tenantId,
    amountMinor: 2500, currency: 'USD', type: 'paid' });
  expect(result?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
test('never interprets unpaid completion or a nonzero no_payment_required session as paid', async () => {
  for (const status of ['unpaid', 'no_payment_required']) {
    const event = signedEvent('checkout.session.completed', session({ payment_status: status }));
    expect(await observed(() => provider().verifyWebhook(event.rawBody, event.headers))).toBeNull();
  }
  const zero = signedEvent('checkout.session.completed', session({ payment_status: 'no_payment_required', amount_total: 0 }));
  expect(await observed(() => provider().verifyWebhook(zero.rawBody, zero.headers))).toMatchObject({ type: 'paid', amountMinor: 0 });
});
test.each([['checkout.session.async_payment_failed', 'failed'], ['checkout.session.expired', 'expired']])('normalizes signed %s without undoing an already paid session', async (type, expected) => {
  const event = signedEvent(type, session({ payment_status: 'unpaid' }));
  expect(await observed(() => provider().verifyWebhook(event.rawBody, event.headers))).toMatchObject({ type: expected });
  const stale = signedEvent(type, session());
  expect(await observed(() => provider().verifyWebhook(stale.rawBody, stale.headers))).toBeNull();
});
test('ignores other signed event types', async () => {
  const event = signedEvent('customer.created', { id: 'cus_fixture' });
  expect(await observed(() => provider().verifyWebhook(event.rawBody, event.headers))).toBeNull();
});
test('rejects missing, altered and stale signatures using the official verifier', async () => {
  const event = signedEvent();
  await expect(observed(() => provider().verifyWebhook(event.rawBody, new Headers()))).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
  await expect(observed(() => provider().verifyWebhook(event.rawBody.replace('2500', '2501'), event.headers))).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
  const stale = client.webhooks.generateTestHeaderString({ payload: event.rawBody, secret: webhookSecret, timestamp: Math.floor(Date.now() / 1000) - 301 });
  await expect(observed(() => provider().verifyWebhook(event.rawBody, new Headers({ 'stripe-signature': stale })))).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
});
test('rejects signed test/live mismatch and incomplete order binding', async () => {
  const live = signedEvent('checkout.session.completed', session({ livemode: true }), { livemode: true });
  await expect(observed(() => provider().verifyWebhook(live.rawBody, live.headers))).rejects.toMatchObject({ code: 'PAYMENT_MODE_MISMATCH' });
  const unbound = signedEvent('checkout.session.completed', session({ metadata: {} }));
  await expect(observed(() => provider().verifyWebhook(unbound.rawBody, unbound.headers))).rejects.toMatchObject({ code: 'PAYMENT_EVENT_INVALID' });
  const wrongType = signedEvent('checkout.session.completed', session({ metadata: { orderId: 123, tenantId: input.tenantId } }));
  await expect(observed(() => provider().verifyWebhook(wrongType.rawBody, wrongType.headers))).rejects.toMatchObject({ code: 'PAYMENT_EVENT_INVALID' });
  const wrongCurrency = signedEvent('checkout.session.completed', session({ currency: 123 }));
  await expect(observed(() => provider().verifyWebhook(wrongCurrency.rawBody, wrongCurrency.headers))).rejects.toMatchObject({ code: 'PAYMENT_EVENT_INVALID' });
  const missingSession = signedEvent('checkout.session.completed', null);
  await expect(observed(() => provider().verifyWebhook(missingSession.rawBody, missingSession.headers))).rejects.toMatchObject({ code: 'PAYMENT_EVENT_INVALID' });
});
test('registry defaults to manual, loads credentials lazily and rejects unsupported providers', async () => {
  vi.resetModules(); vi.stubEnv('PAYMENT_PROVIDER', 'manual'); vi.stubEnv('STRIPE_SECRET_KEY', ''); vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
  const registry = await import('../src/payments/registry');
  expect(registry.getPaymentProvider()).toBeNull();
  expect(() => registry.getPaymentProvider('unknown')).toThrow(expect.objectContaining({ code: 'PAYMENT_PROVIDER_UNSUPPORTED' }));
  expect(() => registry.getPaymentProvider('stripe')).toThrow(expect.objectContaining({ code: 'PAYMENT_NOT_CONFIGURED' }));
  vi.stubEnv('STRIPE_SECRET_KEY', secretKey); vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret);
  expect(registry.getPaymentProvider('stripe').id).toBe('stripe');
});
