import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { requireMcpAuth } from '@better-auth/mcp';
import { getAuth } from '../src/lib/auth';
import { getDatabase } from '../src/db';
import { withTelemetrySink } from '../src/lib/telemetry';
import { actorFromVerifiedClaims } from '../src/lib/actor';

const origin = 'http://localhost:3000';
let cookie = '';
let userId = '';
let tenantId = '';
let clientId = '';
let token = '';
let refreshToken = '';
let claims: Record<string, unknown>;
const scope = 'openid offline_access products:read products:write';
const auth = () => getAuth();
function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
  return new Request(origin + path, { method, headers: { ...(authenticated ? { cookie } : {}), origin, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite'; process.env.DATABASE_URL = 'file::memory:';
  process.env.BETTER_AUTH_URL = origin; process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
  const migration = await getMigrations(auth().options); await migration.runMigrations();
  const signup = await auth().handler(request('/api/auth/sign-up/email', 'POST', { email: 'owner@example.test', password: 'Test-password-123456789', name: 'Test Owner' }, false));
  expect(signup.status).toBe(200);
  cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const signed = await signup.json(); userId = signed.user.id;
  const org = await auth().handler(request('/api/auth/organization/create', 'POST', { name: 'Test business', slug: 'test-business' }));
  expect(org.status).toBe(200); tenantId = (await org.json()).id;
  const active = await auth().handler(request('/api/auth/organization/set-active', 'POST', { organizationId: tenantId }));
  expect(active.status).toBe(200);
  const registration = await auth().handler(request('/api/auth/oauth2/register', 'POST', { client_name: 'Test MCP Client', redirect_uris: ['http://localhost:3456/callback'], token_endpoint_auth_method: 'none', application_type: 'native', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope }, false));
  expect(registration.status).toBe(201); clientId = (await registration.json()).client_id;
  const verifier = randomBytes(48).toString('base64url');
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:3456/callback', response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/api/mcp', scope, state: 'test-state' });
  const authorization = await auth().handler(request('/api/auth/oauth2/authorize?' + query));
  expect(authorization.status).toBe(302);
  const location = new URL(authorization.headers.get('location')!, origin);
  expect(location.pathname).toBe('/consent');
  const consent = await auth().handler(request('/api/auth/oauth2/consent', 'POST', { accept: true, scope, oauth_query: location.search.slice(1) }));
  expect(consent.status).toBe(200);
  const callback = new URL((await consent.json()).url);
  expect(callback.searchParams.get('state')).toBe('test-state');
  const result = await auth().handler(new Request(origin + '/api/auth/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code')!, redirect_uri: 'http://localhost:3456/callback', code_verifier: verifier, resource: origin + '/api/mcp' }) }));
  expect(result.status).toBe(200);
  const tokens = await result.json(); token = tokens.access_token; refreshToken = tokens.refresh_token;
  expect(tokens.refresh_token).toBeTruthy();
  claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}, 30000);
afterAll(async () => { await getDatabase().destroy(); });

test('real PKCE OAuth flow binds audience, subject and tenant', async () => {
  expect(claims.sub).toBe(userId); expect(claims.tenant_id).toBe(tenantId); expect(claims.aud).toContain(origin + '/api/mcp');
  expect(await actorFromVerifiedClaims(claims)).toMatchObject({ userId, tenantId, role: 'owner' });
});
test('publishes resource and authorization metadata and challenges unauthenticated clients', async () => {
  const resource = await auth().handler(request('/.well-known/oauth-protected-resource', 'GET', undefined, false));
  expect(resource.status).toBe(200); expect((await resource.json()).resource).toBe(origin + '/api/mcp');
  const discovery = await auth().handler(request('/.well-known/oauth-authorization-server/api/auth', 'GET', undefined, false));
  expect(discovery.status).toBe(200); const metadata = await discovery.json();
  expect(metadata.code_challenge_methods_supported).toContain('S256'); expect(metadata.client_id_metadata_document_supported).toBe(true);
  const handler = requireMcpAuth(auth(), async () => new Response('should not run'), { resource: origin + '/api/mcp' });
  const response = await handler(new Request(origin + '/api/mcp', { method: 'POST' }));
  expect(response.status).toBe(401); expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
});
test('protected handler verifies signed JWT, rejects tampering and checks scopes', async () => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith(origin)) return auth().handler(req);
    return realFetch(input, init);
  });
  try {
    const handler = requireMcpAuth(auth(), async (_req, verified) => Response.json({ actor: await actorFromVerifiedClaims(verified) }), { resource: origin + '/api/mcp', requiredScopes: ['products:read'] });
    const response = await handler(new Request(origin + '/api/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token } }));
    expect(response.status).toBe(200); expect((await response.json()).actor.tenantId).toBe(tenantId);
    const parts = token.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...claims, tenant_id: 'attacker' })).toString('base64url');
    expect((await handler(new Request(origin + '/api/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + parts.join('.') } }))).status).toBe(401);
    const privileged = requireMcpAuth(auth(), async () => new Response('denied'), { resource: origin + '/api/mcp', requiredScopes: ['audit:read'] });
    expect((await privileged(new Request(origin + '/api/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token } }))).status).toBe(403);
  } finally { vi.unstubAllGlobals(); }
});
test('refresh preserves tenant binding and rotates the refresh token', async () => {
  const response = await auth().handler(new Request(origin + '/api/auth/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: origin + '/api/mcp' }) }));
  expect(response.status).toBe(200); const renewed = await response.json();
  expect(renewed.refresh_token).toBeTruthy(); expect(renewed.refresh_token).not.toBe(refreshToken);
  const renewedClaims = JSON.parse(Buffer.from(renewed.access_token.split('.')[1], 'base64url').toString());
  expect(renewedClaims.tenant_id).toBe(tenantId); expect(renewedClaims.sub).toBe(userId);
});
test('signed login and post-login organization continuation are usable by the UI', async () => {
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:3456/callback', response_type: 'code', code_challenge: createHash('sha256').update(randomBytes(48).toString('base64url')).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/api/mcp', scope: 'products:read', state: 'login-state' });
  const response = await auth().handler(request('/api/auth/oauth2/authorize?' + query, 'GET', undefined, false));
  expect(response.status).toBe(302);
  const loginUrl = new URL(response.headers.get('location')!, origin); expect(loginUrl.pathname).toBe('/sign-in');
  const login = await auth().handler(request('/api/auth/sign-in/email', 'POST', { email: 'owner@example.test', password: 'Test-password-123456789', oauth_query: loginUrl.search.slice(1) }, false));
  expect(login.status).toBe(200); const loginData = await login.json();
  expect(loginData.redirect).toBe(true); expect(new URL(loginData.url, origin).pathname).toBe('/onboarding');
  const previousCookie = cookie;
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  await auth().handler(request('/api/auth/organization/set-active', 'POST', { organizationId: tenantId }));
  const continued = await auth().handler(request('/api/auth/oauth2/continue', 'POST', { postLogin: true, oauth_query: new URL(loginData.url, origin).search.slice(1) }));
  expect(continued.status).toBe(200); expect((await continued.json()).url).toBeTruthy();
  cookie = previousCookie;
});
test('rejects another tenant, unknown roles and missing tenant claims', async () => {
  await expect(actorFromVerifiedClaims({ ...claims, tenant_id: 'other-company' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(actorFromVerifiedClaims({ ...claims, tenant_id: undefined })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});
test('revocation is immediate for still-unexpired access tokens', async () => {
  const list = await auth().handler(request('/api/auth/oauth2/get-consents'));
  expect(list.status).toBe(200);
  const consents = await list.json();
  const consentId = consents.find((item: { clientId: string }) => item.clientId === clientId).id;
  const revoked = await auth().handler(request('/api/auth/oauth2/delete-consent', 'POST', { id: consentId }));
  expect(revoked.status).toBe(200);
  await expect(actorFromVerifiedClaims(claims)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('auth provider diagnostics redact message, secrets and arguments', () => {
  const records: Record<string, unknown>[] = [];
  withTelemetrySink(record => records.push(record), () => auth().options.logger?.log?.('error', 'private-password-secret', { token: 'private-access-token' }));
  expect(records[0]['event.name']).toBe('auth.provider.completed');
  expect(records[0]['error.code']).toBe('AUTH_PROVIDER_ERROR');
  expect(JSON.stringify(records)).not.toContain('private-');
});
