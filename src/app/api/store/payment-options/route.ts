import { route, requireModule } from '@/lib/http';
import { AppError } from '@/core/contracts';
import { templateConfig } from '@/template.config';
import { getPaymentProvider } from '@/payments/registry';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return route(request, 'api.store.payment.options', '/api/store/payment-options', async () => {
    requireModule('orders');
    if (templateConfig.kind !== 'ecommerce') throw new AppError('MODULE_DISABLED', 'Tienda pública no habilitada.', 404);
    const provider = getPaymentProvider();
    return provider ? { provider: provider.id, label: provider.id === 'stripe' ? 'Pago seguro con Stripe' : 'Pago online', mode: 'redirect' } : { provider: 'manual', label: 'Pago a coordinar', mode: 'manual' };
  });
}
