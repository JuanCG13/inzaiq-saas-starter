import { AppError } from '@/core/contracts';
export async function rawWebhookBody(request: Request, maxBytes = 262144): Promise<string> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.', 415);
  if (Number(request.headers.get('content-length')) > maxBytes) throw new AppError('BODY_TOO_LARGE', 'Webhook exceeds the configured limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_INPUT', 'Webhook body is required.', 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AppError('BODY_TOO_LARGE', 'Webhook exceeds the configured limit.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
