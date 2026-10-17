import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { AppError, type Actor, type CreateOrderInput } from '../core/contracts';
import { createCommerceService } from '../core/service';
import type { Database, OrderTable } from '../db/schema';
import { emitEvent, withOperation } from '../lib/telemetry';
import type { CheckoutInput, CheckoutResult, CheckoutUrls, PaymentEvent, PaymentProvider, PaymentProviderRegistry, ResumeCheckoutResult, WebhookResult } from './contracts';

type Attempt = Selectable<Database['commerce_payment_attempts']>;
const MAX_STOCK = 1_000_000_000;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);
function checkProvider(provider: PaymentProvider) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(provider.id) || !Number.isSafeInteger(provider.idempotencyRetentionMs) || provider.idempotencyRetentionMs < 60_000 || provider.idempotencyRetentionMs > 7 * 86_400_000) {
    throw new AppError('PAYMENT_CONFIGURATION_ERROR', 'Payment provider configuration is invalid.', 503);
  }
}
function checkoutInput(order: Pick<Selectable<OrderTable>, 'id' | 'tenant_id' | 'total_minor' | 'currency'>, key: string, urls: CheckoutUrls): CheckoutInput {
  return { orderId: order.id, tenantId: order.tenant_id, amountMinor: Number(order.total_minor), currency: order.currency, idempotencyKey: key, ...urls };
}
function validateUrls(urls: CheckoutUrls) {
  for (const value of [urls.successUrl, urls.cancelUrl]) {
    try {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (value.length > 2048 || url.username || url.password || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error();
    } catch { throw new AppError('PAYMENT_CONFIGURATION_ERROR', 'Checkout return URLs must be configured securely.', 503); }
  }
}
function validateEvent(event: PaymentEvent, provider: PaymentProvider) {
  if (!event || event.provider !== provider.id || !identifier(event.id) || !identifier(event.sessionId) || !identifier(event.orderId) || !identifier(event.tenantId)
    || !Number.isSafeInteger(event.amountMinor) || event.amountMinor < 0 || !/^[A-Z]{3}$/.test(event.currency)
    || !['paid', 'failed', 'expired'].includes(event.type) || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new AppError('PAYMENT_EVENT_INVALID', 'The verified payment event has invalid fields.', 400);
  }
}
async function paymentAudit(trx: Transaction<Database>, tenantId: string, provider: string, orderId: string, action: string, details: Record<string, string | boolean>) {
  await trx.insertInto('commerce_audit').values({ id: randomUUID(), tenant_id: tenantId, actor_id: `payment:${provider}`, action, resource_id: orderId, details_json: JSON.stringify(details), created_at: new Date().toISOString() }).execute();
}
function transactionCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const e = error as { code?: string; extendedCode?: string };
  return e.extendedCode ?? e.code ?? '';
}

export function createPaymentService(db: Kysely<Database>) {
  const commerce = createCommerceService(db);
  async function atomic<T>(run: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction().execute(run); }
      catch (error) {
        if (!['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', '40001', '40P01'].includes(transactionCode(error))) throw error;
        if (attempt >= 2) throw new AppError('PAYMENT_RETRY_REQUIRED', 'Payment persistence is busy. Retry the same operation.', 503);
        emitEvent('commerce.payment.retry', { 'event.outcome': 'rejected', 'error.code': 'CONCURRENT_TRANSACTION', 'retry.count': attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  async function hosted(order: Selectable<OrderTable>, provider: PaymentProvider, urls: CheckoutUrls): Promise<{ kind: 'redirect'; url: string }> {
    checkProvider(provider);
    validateUrls(urls);
    if (order.payment_provider !== provider.id) throw new AppError('PAYMENT_PROVIDER_MISMATCH', 'The order belongs to a different payment provider.', 409);
    if (order.status !== 'pending') throw new AppError('ORDER_STATUS_CONFLICT', 'This order is no longer awaiting payment.', 409);
    const requestHash = fingerprint({ orderId: order.id, tenantId: order.tenant_id, amountMinor: Number(order.total_minor), currency: order.currency, provider: provider.id, ...urls });
    const attempt = await atomic(async trx => {
      const id = randomUUID();
      const now = new Date();
      await trx.insertInto('commerce_payment_attempts').values({
        id, tenant_id: order.tenant_id, order_id: order.id, provider: provider.id,
        request_hash: requestHash, provider_key: `${provider.id}:checkout:${id}`,
        retry_until: new Date(now.getTime() + provider.idempotencyRetentionMs).toISOString(),
        session_id: null, checkout_url: null, expires_at: null, state: 'creating', created_at: now.toISOString(), updated_at: now.toISOString(),
      }).onConflict(oc => oc.columns(['tenant_id', 'order_id']).doNothing()).execute();
      return trx.selectFrom('commerce_payment_attempts').selectAll().where('tenant_id', '=', order.tenant_id).where('order_id', '=', order.id).executeTakeFirstOrThrow();
    });
    if (attempt.provider !== provider.id || attempt.request_hash !== requestHash) throw new AppError('PAYMENT_ATTEMPT_CONFLICT', 'Checkout configuration differs from the original attempt. Reconciliation is required.', 409);
    if (attempt.state === 'reconciliation_required') throw new AppError('PAYMENT_RECONCILIATION_REQUIRED', 'This payment requires review by the business.', 409);
    if (attempt.session_id) return checkedRedirect(attempt);
    if (Date.now() >= Date.parse(attempt.retry_until)) throw new AppError('PAYMENT_RECONCILIATION_REQUIRED', 'The safe provider retry window expired. Do not create another payment session.', 409);
    const input = checkoutInput(order, attempt.provider_key, urls);
    provider.validateCheckoutInput(input);
    // Never hold a SQL transaction over an external API call. Concurrent calls use
    // the same persisted key; the provider must guarantee idempotent session creation.
    const session = await withOperation('commerce.payment.provider.create', {}, async () => {
      try { return await provider.createCheckout(input); }
      catch { throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Checkout could not be confirmed. Resume using the same checkout key.', 503); }
    });
    if (!identifier(session.sessionId) || !Number.isFinite(Date.parse(session.expiresAt))) throw new AppError('PAYMENT_PROVIDER_RESPONSE_INVALID', 'The provider returned an invalid checkout session.', 503);
    try { if (new URL(session.url).protocol !== 'https:' || session.url.length > 4096) throw new Error(); }
    catch { throw new AppError('PAYMENT_PROVIDER_RESPONSE_INVALID', 'The provider returned an invalid checkout URL.', 503); }
    const bound = await atomic(async trx => {
      // A webhook arriving before this durable binding gets a retryable response.
      await trx.updateTable('commerce_payment_attempts').set({ session_id: session.sessionId, checkout_url: session.url, expires_at: session.expiresAt, state: 'ready', updated_at: new Date().toISOString() })
        .where('id', '=', attempt.id).where('tenant_id', '=', order.tenant_id).where('session_id', 'is', null).execute();
      const current = await trx.selectFrom('commerce_payment_attempts').selectAll().where('id', '=', attempt.id).where('tenant_id', '=', order.tenant_id).executeTakeFirstOrThrow();
      if (current.session_id !== session.sessionId) throw new AppError('PAYMENT_RECONCILIATION_REQUIRED', 'The provider returned inconsistent sessions for one attempt.', 409);
      return current;
    });
    return checkedRedirect(bound);
  }

  function checkedRedirect(attempt: Attempt): { kind: 'redirect'; url: string } {
    if (attempt.state !== 'ready') throw new AppError('ORDER_STATUS_CONFLICT', 'This checkout is no longer awaiting payment.', 409);
    if (!attempt.checkout_url || !attempt.expires_at || Date.now() >= Date.parse(attempt.expires_at)) {
      throw new AppError('PAYMENT_SESSION_EXPIRED', 'The checkout expired. Wait for provider confirmation before starting another order.', 409);
    }
    return { kind: 'redirect', url: attempt.checkout_url };
  }

  return {
    createHostedCheckout(actor: Actor, input: CreateOrderInput, provider: PaymentProvider, urls: CheckoutUrls): Promise<CheckoutResult> {
      return withOperation('commerce.payment.checkout', {}, async () => {
        checkProvider(provider);
        validateUrls(urls);
        if (!Number.isSafeInteger(input.expectedTotalMinor) || input.expectedTotalMinor! < 0 || !input.expectedCurrency || !/^[A-Z]{3}$/.test(input.expectedCurrency)) {
          throw new AppError('INVALID_INPUT', 'Hosted checkout requires the approved total and currency.', 400);
        }
        provider.validateCheckoutInput({ orderId: randomUUID(), tenantId: actor.tenantId, amountMinor: input.expectedTotalMinor!, currency: input.expectedCurrency, idempotencyKey: 'preflight-validation', ...urls });
        const order = await commerce.createOrder(actor, { ...input, paymentProvider: provider.id, channel: 'web', paymentMethod: 'manual' });
        const row = await db.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('id', '=', order.id).executeTakeFirstOrThrow();
        return { order, checkout: await hosted(row, provider, urls) };
      });
    },
    resumeHostedCheckout(tenantId: string, idempotencyKey: string, registry: PaymentProviderRegistry, urls: CheckoutUrls): Promise<ResumeCheckoutResult> {
      return withOperation('commerce.payment.resume', {}, async () => {
        if (!identifier(tenantId) || !identifier(idempotencyKey)) throw new AppError('INVALID_INPUT', 'Invalid checkout reference.', 400);
        const row = await db.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', tenantId).where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
        if (!row) return { state: 'not_found' };
        if (!row.payment_provider) return { state: 'manual_received' };
        if (row.status !== 'pending') return { state: row.status };
        return { state: 'pending', checkout: await hosted(row, registry(row.payment_provider), urls) };
      });
    },
    processWebhook(provider: PaymentProvider, rawBody: string, headers: Headers): Promise<WebhookResult> {
      return withOperation('commerce.payment.webhook', {}, async () => {
        checkProvider(provider);
        const event = await provider.verifyWebhook(rawBody, headers);
        if (!event) return { received: true, outcome: 'ignored' };
        validateEvent(event, provider);
        const eventHash = fingerprint({ id: event.id, provider: event.provider, sessionId: event.sessionId, orderId: event.orderId, tenantId: event.tenantId, amountMinor: event.amountMinor, currency: event.currency, type: event.type, occurredAt: event.occurredAt });
        const result = await atomic<WebhookResult>(async trx => {
          const order = await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', event.tenantId).where('id', '=', event.orderId).executeTakeFirst();
          if (!order || order.payment_provider !== provider.id || Number(order.total_minor) !== event.amountMinor || order.currency !== event.currency) {
            throw new AppError('PAYMENT_EVENT_MISMATCH', 'The verified event does not match the persisted order.', 400);
          }
          const attempt = await trx.selectFrom('commerce_payment_attempts').selectAll().where('tenant_id', '=', event.tenantId).where('order_id', '=', event.orderId).executeTakeFirst();
          if (!attempt?.session_id) throw new AppError('PAYMENT_SESSION_UNBOUND', 'Checkout binding is not yet durable. Retry this event.', 503);
          if (attempt.provider !== provider.id || attempt.session_id !== event.sessionId) throw new AppError('PAYMENT_EVENT_MISMATCH', 'The verified event does not match the persisted session.', 400);
          const inserted = await trx.insertInto('commerce_payment_events').values({ id: randomUUID(), provider: event.provider, event_id: event.id, event_hash: eventHash, tenant_id: event.tenantId, order_id: event.orderId, session_id: event.sessionId, type: event.type, outcome: 'ignored', created_at: new Date().toISOString() })
            .onConflict(oc => oc.columns(['provider', 'event_id']).doNothing()).returning('id').executeTakeFirst();
          if (!inserted) {
            const previous = await trx.selectFrom('commerce_payment_events').selectAll().where('provider', '=', event.provider).where('event_id', '=', event.id).executeTakeFirstOrThrow();
            if (previous.event_hash !== eventHash) throw new AppError('PAYMENT_EVENT_CONFLICT', 'A provider event ID was reused with different content.', 409);
            return { received: true, outcome: 'duplicate' };
          }
          const target = event.type === 'paid' ? 'completed' : 'cancelled';
          const transitioned = await trx.updateTable('commerce_orders').set({ status: target }).where('tenant_id', '=', event.tenantId).where('id', '=', event.orderId).where('status', '=', 'pending').returningAll().executeTakeFirst();
          let outcome: 'applied' | 'ignored' | 'reconciliation_required' = transitioned ? 'applied' : 'ignored';
          const latest = transitioned ?? await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', event.tenantId).where('id', '=', event.orderId).executeTakeFirstOrThrow();
          if (!transitioned && event.type === 'paid' && latest.status === 'cancelled') outcome = 'reconciliation_required';
          if (transitioned && target === 'cancelled') {
            const items = await trx.selectFrom('commerce_order_items').select(['product_id', 'quantity']).where('tenant_id', '=', event.tenantId).where('order_id', '=', event.orderId).orderBy('product_id').execute();
            for (const item of items) {
              const updated = await trx.updateTable('commerce_products').set({ stock: sql`stock + ${item.quantity}`, version: sql`version + 1`, updated_at: new Date().toISOString() }).where('tenant_id', '=', event.tenantId).where('id', '=', item.product_id).where('stock', '<=', MAX_STOCK - item.quantity).returning('id').executeTakeFirst();
              if (!updated) throw new AppError('STOCK_LIMIT', 'Payment cancellation stock restoration requires review.', 503);
            }
          }
          await trx.updateTable('commerce_payment_events').set({ outcome }).where('id', '=', inserted.id).execute();
          if (outcome !== 'ignored') {
            await trx.updateTable('commerce_payment_attempts').set({ state: outcome === 'reconciliation_required' ? outcome : target, updated_at: new Date().toISOString() }).where('id', '=', attempt.id).where('tenant_id', '=', event.tenantId).execute();
            await paymentAudit(trx, event.tenantId, provider.id, event.orderId, outcome === 'reconciliation_required' ? 'payment.reconciliation_required' : 'payment.status.updated', { provider: provider.id, status: latest.status, stockRestored: target === 'cancelled' && !!transitioned });
          }
          return { received: true, outcome };
        });
        if (result.outcome === 'reconciliation_required') emitEvent('commerce.payment.reconciliation_required', { 'event.outcome': 'rejected', 'error.code': 'PAYMENT_RECONCILIATION_REQUIRED' });
        return result;
      });
    },
  };
}
