import { randomUUID } from 'node:crypto';
import { requireMcpAuth } from '@better-auth/mcp';
import { getAuth, authOrigin, mcpResource } from '@/lib/auth';
import { actorFromVerifiedClaims } from '@/lib/actor';
import { createCommerceMcpHandler } from '@/lib/mcp';
import { service, requireModule, jsonBody } from '@/lib/http';
import { AppError } from '@/core/contracts';
import { withOperation } from '@/lib/telemetry';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const response = await withOperation('mcp.request', { requestId, route: '/api/mcp', method: 'POST' }, async () => {
      requireModule('mcp');
      const origin = request.headers.get('origin');
      if ((origin && origin !== authOrigin()) || new URL(request.url).origin !== authOrigin()) throw new AppError('FORBIDDEN', 'Origin not allowed', 403);
      const handler = requireMcpAuth(getAuth(), async (req, claims) => {
        const actor = await actorFromVerifiedClaims(claims);
        const body = await jsonBody(req);
        return createCommerceMcpHandler(actor, service()).fetch(new Request(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(body), signal: req.signal }));
      }, { resource: mcpResource(), challengeScopes: ['products:read'] });
      return handler(request);
    });
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    const status = error instanceof AppError ? error.status : 503;
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error instanceof AppError ? error.message : 'MCP is not configured or temporarily unavailable' } }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
  }
}
