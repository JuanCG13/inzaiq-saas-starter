import Stripe from 'stripe';
import { AppError } from '../../core/contracts';
import { withOperation } from '../../lib/telemetry';
import type { CheckoutInput, HostedCheckout, PaymentEvent, PaymentProvider } from '../contracts';

/** Deliberate allowlist: ISO minor units equal Stripe charge units for these currencies. */
export const STRIPE_CURRENCY_EXPONENTS: Readonly<Record<string, 0 | 2>> = Object.freeze({
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  AED: 2, ARS: 2, AUD: 2, BOB: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2,
  COP: 2, CRC: 2, CZK: 2, DKK: 2, DOP: 2, EUR: 2, GBP: 2, GTQ: 2,
  HKD: 2, HNL: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2, MXN: 2, MYR: 2,
  NIO: 2, NOK: 2, NZD: 2, PEN: 2, PHP: 2, PLN: 2, RON: 2, SEK: 2,
  SGD: 2, THB: 2, TRY: 2, TWD: 2, USD: 2, UYU: 2, ZAR: 2,
});
// Generated once for this integration; never regenerate per call or retry.
export const STRIPE_INTEGRATION_IDENTIFIER = 'agentic-commerce-kpvqbzcw';
const MAX_AMOUNT_MINOR = 99_999_999;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value);
const supportedTypes = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
]);

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  integrationIdentifier?: string;
  /** Dependency injection for tests; runtime uses the official SDK client. */
  client?: Stripe;
}

function invalidInput(message: string): never { throw new AppError('PAYMENT_INPUT_INVALID', message); }
function validateMoney(amount: unknown, currency: unknown): asserts currency is string {
  if (typeof currency !== 'string' || !Object.hasOwn(STRIPE_CURRENCY_EXPONENTS, currency)) {
    throw new AppError('PAYMENT_CURRENCY_UNSUPPORTED', 'The currency is not enabled for this payment gateway.');
  }
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT_MINOR) {
    invalidInput('The amount is outside the range supported by this payment gateway.');
  }
  // Reject if the application's minor-unit representation cannot be passed
  // unchanged to Stripe; never guess a conversion.
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (digits !== STRIPE_CURRENCY_EXPONENTS[currency]) {
    throw new AppError('PAYMENT_CURRENCY_UNSUPPORTED', 'The currency requires a conversion that is not enabled.');
  }
}
function validateReturnUrl(value: string): void {
  if (typeof value !== 'string' || value.length > 2048) invalidInput('The return URL is not valid.');
  let url: URL;
  try { url = new URL(value); } catch { return invalidInput('The return URL is not valid.'); }
  const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    invalidInput('The return URL must use HTTPS.');
  }
}
function trustedCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function eventError(): never { throw new AppError('PAYMENT_EVENT_INVALID', 'The payment event is not valid.'); }

export class StripePaymentProvider implements PaymentProvider {
  readonly id = 'stripe';
  readonly idempotencyRetentionMs = 23 * 60 * 60 * 1000;
  private readonly client: Stripe;
  private readonly webhookSecret: string;
  private readonly liveMode: boolean;
  private readonly integrationIdentifier: string;

  constructor(options: StripeProviderOptions) {
    if (!/^(?:rk|sk)_(?:test|live)_[A-Za-z0-9]+$/.test(options.secretKey) || !/^whsec_[A-Za-z0-9]+$/.test(options.webhookSecret)) {
      throw new AppError('PAYMENT_NOT_CONFIGURED', 'The payment gateway is not configured.', 503);
    }
    const identifier = options.integrationIdentifier ?? STRIPE_INTEGRATION_IDENTIFIER;
    if (!/^[a-z][a-z0-9-]{1,70}-[a-z]{8}$/.test(identifier)) {
      throw new AppError('PAYMENT_NOT_CONFIGURED', 'The integration identifier is not valid.', 503);
    }
    this.liveMode = options.secretKey.startsWith('rk_live_') || options.secretKey.startsWith('sk_live_');
    this.webhookSecret = options.webhookSecret;
    this.integrationIdentifier = identifier;
    this.client = options.client ?? new Stripe(options.secretKey, {
      apiVersion: '2026-09-30.endive', timeout: 15_000, maxNetworkRetries: 2,
      appInfo: { name: 'agentic-commerce', version: '0.1.0' },
    });
  }

  validateCheckoutInput(input: CheckoutInput): void {
    validateMoney(input.amountMinor, input.currency);
    if (!validId(input.orderId) || !validId(input.tenantId) || typeof input.idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,255}$/.test(input.idempotencyKey)) invalidInput('The payment reference is not valid.');
    validateReturnUrl(input.successUrl); validateReturnUrl(input.cancelUrl);
  }

  async createCheckout(input: CheckoutInput): Promise<HostedCheckout> {
    return withOperation('commerce.payment.checkout_create', {}, async () => {
      this.validateCheckoutInput(input);
      const metadata = { orderId: input.orderId, tenantId: input.tenantId };
      let session: Stripe.Checkout.Session;
      try {
        session = await this.client.checkout.sessions.create({
          mode: 'payment', ui_mode: 'hosted',
          integration_identifier: this.integrationIdentifier,
          adaptive_pricing: { enabled: false },
          client_reference_id: input.orderId,
          metadata, payment_intent_data: { metadata },
          line_items: [{ quantity: 1, price_data: {
            currency: input.currency.toLowerCase(), unit_amount: input.amountMinor,
            product_data: { name: 'Store order' },
          } }],
          success_url: input.successUrl, cancel_url: input.cancelUrl,
        }, { idempotencyKey: input.idempotencyKey });
      } catch {
        // A timeout may occur after Stripe created the session: caller must keep
        // the reservation and retry with this same idempotency key.
        throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Could not confirm the payment session. Retry the same order.', 503);
      }
      if (!session || typeof session !== 'object' || session.livemode !== this.liveMode || session.mode !== 'payment' ||
        session.amount_total !== input.amountMinor || typeof session.currency !== 'string' || session.currency.toUpperCase() !== input.currency ||
        session.metadata?.orderId !== input.orderId || session.metadata?.tenantId !== input.tenantId ||
        !validId(session.id) || !trustedCheckoutUrl(session.url) ||
        !Number.isSafeInteger(session.expires_at) || session.expires_at <= 0 || session.expires_at > 8_640_000_000_000) {
        throw new AppError('PAYMENT_RESPONSE_INVALID', 'The payment gateway response requires review.', 502);
      }
      return { sessionId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000).toISOString() };
    });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    return withOperation('commerce.payment.webhook_verify', {}, async () => {
      let event: Stripe.Event;
      try {
        const signature = headers.get('stripe-signature');
        if (!signature) throw new Error('missing_signature');
        event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret, 300);
      } catch {
        throw new AppError('PAYMENT_SIGNATURE_INVALID', 'The event signature is not valid.', 400);
      }
      if (!event || typeof event !== 'object') eventError();
      if (event.livemode !== this.liveMode) throw new AppError('PAYMENT_MODE_MISMATCH', 'The event mode does not match the payment gateway.', 400);
      if (!supportedTypes.has(event.type)) return null;
      const session = event.data?.object as Stripe.Checkout.Session;
      if (!session || typeof session !== 'object' || session.object !== 'checkout.session' || session.mode !== 'payment' || session.livemode !== this.liveMode) eventError();
      const paid = session.payment_status === 'paid' || (session.payment_status === 'no_payment_required' && session.amount_total === 0);
      const paymentType = event.type === 'checkout.session.expired' ? 'expired'
        : event.type === 'checkout.session.async_payment_failed' ? 'failed' : 'paid';
      // Redirect completion alone is never evidence of payment; delayed methods
      // complete later. Stale failure/expiration events cannot undo a paid session.
      if ((paymentType === 'paid' && !paid) || (paymentType !== 'paid' && paid)) return null;
      const currency = typeof session.currency === 'string' ? session.currency.toUpperCase() : undefined;
      if (typeof currency !== 'string' || !Object.hasOwn(STRIPE_CURRENCY_EXPONENTS, currency) ||
        !Number.isSafeInteger(session.amount_total) || session.amount_total === null || session.amount_total < 0 || session.amount_total > MAX_AMOUNT_MINOR ||
        !validId(session.id) || !validId(event.id) ||
        !validId(session.metadata?.orderId) || !validId(session.metadata?.tenantId) ||
        !Number.isSafeInteger(event.created) || event.created < 0 || event.created > 8_640_000_000_000) eventError();
      return {
        id: event.id, provider: this.id, sessionId: session.id,
        orderId: session.metadata!.orderId, tenantId: session.metadata!.tenantId,
        amountMinor: session.amount_total, currency, type: paymentType,
        occurredAt: new Date(event.created * 1000).toISOString(),
      };
    });
  }
}
