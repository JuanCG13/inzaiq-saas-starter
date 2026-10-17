import { z } from 'zod';
import { route, jsonBody, service, requireModule, storefrontWriteBudget } from '@/lib/http';
import { storeActor } from '@/lib/request-actor';
import { templateConfig } from '@/template.config';
import { AppError } from '@/core/contracts';
import { getPaymentProvider } from '@/payments/registry';
import { checkoutUrls, paymentService } from '@/payments/server';
export const runtime = 'nodejs';
const inputSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(1000) }).strict()).min(1).max(100),
  idempotencyKey: z.string().uuid(), expectedTotalMinor: z.number().int().nonnegative().safe(), expectedCurrency: z.string().regex(/^[A-Z]{3}$/),
  customer: z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(254), phone: z.string().max(40).optional(), address: z.string().max(500).optional() }).strict(),
}).strict();
export function POST(request: Request) {
  return route(request, 'api.store.checkout', '/api/store/orders', async () => {
    requireModule('orders');
    if (templateConfig.kind !== 'ecommerce') throw new AppError('MODULE_DISABLED', 'The public store is not enabled.', 404);
    const actor = storeActor();
    const input = inputSchema.parse(await jsonBody(request));
    const provider = getPaymentProvider();
    // Older storefront JavaScript only understands manual receipts. Do not reserve
    // stock until the caller explicitly understands the hosted-checkout response.
    if (provider && request.headers.get('x-checkout-protocol') !== 'hosted-v1') throw new AppError('CLIENT_UPGRADE_REQUIRED', 'Reload the page before continuing to payment.', 409);
    await storefrontWriteBudget(actor.tenantId);
    if (provider) return paymentService().createHostedCheckout(actor, { ...input, channel: 'web', paymentMethod: 'manual' }, provider, checkoutUrls());
    const order = await service().createOrder(actor, { ...input, channel: 'web', paymentMethod: 'manual' });
    return { order };
  }, 201);
}
