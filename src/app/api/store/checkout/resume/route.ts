import { z } from 'zod';
import { route, jsonBody, requireModule, storefrontWriteBudget } from '@/lib/http';
import { storeActor } from '@/lib/request-actor';
import { templateConfig } from '@/template.config';
import { AppError } from '@/core/contracts';
import { paymentService, checkoutUrls } from '@/payments/server';
import { getPaymentProvider } from '@/payments/registry';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return route(request, 'api.store.checkout.resume', '/api/store/checkout/resume', async () => {
    requireModule('orders');
    if (templateConfig.kind !== 'ecommerce') throw new AppError('MODULE_DISABLED', 'Tienda pública no habilitada.', 404);
    const actor = storeActor();
    const { idempotencyKey } = z.object({ idempotencyKey: z.string().uuid() }).strict().parse(await jsonBody(request));
    await storefrontWriteBudget(actor.tenantId);
    // Random checkout key acts as a narrow capability: no customer/order data is returned.
    return paymentService().resumeHostedCheckout(actor.tenantId, idempotencyKey, getPaymentProvider, checkoutUrls());
  });
}
