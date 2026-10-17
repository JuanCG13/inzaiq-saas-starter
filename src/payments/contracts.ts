import type { Order } from '../core/contracts';

/** Server-owned fields only. Providers never receive a client-supplied line price. */
export interface CheckoutInput {
  orderId: string;
  tenantId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
}
export interface HostedCheckout { sessionId: string; url: string; expiresAt: string }
export interface PaymentEvent {
  id: string;
  provider: string;
  sessionId: string;
  orderId: string;
  tenantId: string;
  amountMinor: number;
  currency: string;
  type: 'paid' | 'failed' | 'expired';
  occurredAt: string;
}
export interface PaymentProvider {
  id: string;
  /** Conservative retry window guaranteed by the provider's idempotency contract. */
  idempotencyRetentionMs: number;
  validateCheckoutInput(input: CheckoutInput): void;
  createCheckout(input: CheckoutInput): Promise<HostedCheckout>;
  /** Verify signature before returning a normalized event. Throw on invalid signature. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
}
export type PaymentProviderRegistry = (providerId: string) => PaymentProvider;
export interface CheckoutUrls { successUrl: string; cancelUrl: string }
export interface CheckoutResult { order: Order; checkout: { kind: 'redirect'; url: string } }
export interface ResumeCheckoutResult {
  state: 'pending' | 'completed' | 'cancelled' | 'not_found' | 'manual_received';
  checkout?: { kind: 'redirect'; url: string };
}
export interface WebhookResult {
  received: true;
  outcome: 'applied' | 'ignored' | 'duplicate' | 'reconciliation_required';
}
