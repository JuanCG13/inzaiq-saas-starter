import { randomUUID } from 'node:crypto';
import { getAuth } from './auth';
import { withOperation } from './telemetry';

/** Keep provider initialization lazy, preserve OAuth responses, and own unexpected HTTP failures. */
export async function handleAuthRequest(request: Request, discovery = false): Promise<Response> {
  const requestId = randomUUID();
  const operation = discovery ? 'auth.discovery' : 'auth.request';
  const route = discovery ? '/.well-known/[...path]' : '/api/auth/[...all]';
  try {
    return await withOperation(operation, { requestId, route, method: request.method }, async () => {
      // The exact original URL is required for issuer-inserted OAuth discovery paths.
      const response = await getAuth().handler(request);
      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  } catch {
    // The operation boundary already recorded a redacted, correlated terminal failure.
    return Response.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' }, requestId }, {
      status: 503,
      headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
    });
  }
}
