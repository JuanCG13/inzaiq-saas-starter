import { randomUUID } from 'node:crypto';
import { AppError } from '@/core/contracts';
import { requireModule } from '@/lib/http';
import { rawWebhookBody } from '@/lib/raw-body';
import { withOperation } from '@/lib/telemetry';
import { getPaymentProvider } from '@/payments/registry';
import { paymentService } from '@/payments/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const requestId = randomUUID();
  try {
    const result = await withOperation('api.payment.webhook', { requestId, route: '/api/payments/webhooks/[provider]', method: 'POST' }, async () => {
      requireModule('orders');
      const { provider: name } = await params;
      const provider = getPaymentProvider(name);
      const raw = await rawWebhookBody(request);
      return paymentService().processWebhook(provider, raw, request.headers);
    });
    return Response.json(result, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { code: error instanceof AppError ? error.code : 'PAYMENT_WEBHOOK_UNAVAILABLE', message: error instanceof AppError ? error.message : 'Webhook processing is temporarily unavailable.' }, requestId }, { status: error instanceof AppError ? error.status : 503, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } });
  }
}
