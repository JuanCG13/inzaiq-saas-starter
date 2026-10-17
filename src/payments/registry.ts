import { AppError } from '../core/contracts';
import type { PaymentProvider } from './contracts';
import { StripePaymentProvider } from './providers/stripe';

let stripe: PaymentProvider | undefined;

/** No credentials are read until a configured gateway is actually used. */
export function getPaymentProvider(): PaymentProvider | null;
export function getPaymentProvider(id: string): PaymentProvider;
export function getPaymentProvider(id?: string): PaymentProvider | null {
  const configured = id ?? process.env.PAYMENT_PROVIDER ?? 'manual';
  if (configured === 'manual' && id === undefined) return null;
  if (configured !== 'stripe') throw new AppError('PAYMENT_PROVIDER_UNSUPPORTED', 'The requested payment gateway is not enabled.', 503);
  return stripe ??= new StripePaymentProvider({
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    integrationIdentifier: process.env.STRIPE_INTEGRATION_IDENTIFIER,
  });
}
