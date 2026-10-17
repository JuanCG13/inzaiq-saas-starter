import { getDatabase } from '@/db';
import { authOrigin } from '@/lib/auth';
import { createPaymentService } from './service';
export const paymentService = () => createPaymentService(getDatabase());
export function checkoutUrls() {
  const origin = authOrigin();
  return { successUrl: `${origin}/checkout/return?from=success`, cancelUrl: `${origin}/checkout/return?from=cancel` };
}
