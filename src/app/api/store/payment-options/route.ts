import { route, requireModule } from '@/lib/http';
import { AppError } from '@/core/contracts';
import { templateConfig } from '@/template.config';
import { getPaymentProvider } from '@/payments/registry';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return route(request, 'api.store.payment.options', '/api/store/payment-options', async () => {
    requireModule('orders');
    if (templateConfig.kind !== 'ecommerce') throw new AppError('MODULE_DISABLED', 'The public store is not enabled.', 404);
    const provider = getPaymentProvider();
    return provider ? { provider: provider.id, label: provider.id === 'stripe' ? 'Secure payment with Stripe' : 'Online payment', mode: 'redirect' } : { provider: 'manual', label: 'Payment to be arranged', mode: 'manual' };
  });
}
