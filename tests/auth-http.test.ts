import { beforeEach, expect, test, vi } from 'vitest';
import { withTelemetrySink } from '../src/lib/telemetry';
const mocked = vi.hoisted(() => ({ handler: vi.fn(), getAuth: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ getAuth: mocked.getAuth }));
import { POST as authPost } from '../src/app/api/auth/[...all]/route';
import { GET as discoveryGet } from '../src/app/.well-known/[...path]/route';
const records: Record<string, unknown>[] = [];
beforeEach(() => { records.length = 0; mocked.handler.mockReset(); mocked.getAuth.mockReset().mockReturnValue({ handler: mocked.handler }); });

test.each([false, true])('normalizes unexpected provider/config failure without leaking PII (discovery=%s)', async discovery => {
  const sentinel = 'private-customer@example.test token=do-not-disclose';
  if (discovery) mocked.getAuth.mockImplementation(() => { throw new Error(sentinel); });
  else mocked.handler.mockRejectedValue(new Error(sentinel));
  const request = new Request('https://store.example/' + (discovery ? '.well-known/oauth-authorization-server/api/auth' : 'api/auth/sign-in/email'), { method: discovery ? 'GET' : 'POST' });
  const response = await withTelemetrySink(record => records.push(record), () => discovery ? discoveryGet(request) : authPost(request));
  expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.error.code).toBe('AUTH_UNAVAILABLE'); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ 'event.name': discovery ? 'auth.discovery.completed' : 'auth.request.completed', 'event.outcome': 'failure', 'error.code': 'INTERNAL_ERROR', 'request.id': body.requestId });
  expect(JSON.stringify({ body, records })).not.toContain('private-customer');
  expect(JSON.stringify({ body, records })).not.toContain('do-not-disclose');
});
test('preserves legitimate provider rejection, cookies and authentication challenge', async () => {
  const headers = new Headers({ 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="commerce"' });
  headers.append('set-cookie', 'session=opaque-test-value; HttpOnly; Secure');
  headers.append('set-cookie', 'csrf=opaque-other-value; Secure');
  mocked.handler.mockResolvedValue(new Response('{"code":"INVALID_CREDENTIALS"}', { status: 401, headers }));
  const response = await withTelemetrySink(record => records.push(record), () => authPost(new Request('https://store.example/api/auth/sign-in/email', { method: 'POST' })));
  expect(response.status).toBe(401); expect(await response.text()).toBe('{"code":"INVALID_CREDENTIALS"}');
  expect(response.headers.get('www-authenticate')).toBe('Bearer realm="commerce"'); expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(records[0]['event.outcome']).toBe('rejected'); expect(JSON.stringify(records)).not.toContain('opaque-test-value');
});
test('discovery receives the original request URL and successful metadata remains unchanged', async () => {
  const request = new Request('https://store.example/.well-known/oauth-authorization-server/api/auth');
  const metadata = { issuer: 'https://store.example/api/auth', authorization_endpoint: 'https://store.example/api/auth/oauth2/authorize' };
  mocked.handler.mockResolvedValue(Response.json(metadata, { headers: { 'x-provider-header': 'preserved' } }));
  const response = await withTelemetrySink(record => records.push(record), () => discoveryGet(request));
  expect(mocked.handler).toHaveBeenCalledExactlyOnceWith(request);
  expect(mocked.handler.mock.calls[0][0].url).toBe(request.url);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(metadata);
  expect(response.headers.get('x-provider-header')).toBe('preserved'); expect(response.headers.get('x-request-id')).toBeTruthy();
  expect(records[0]['event.outcome']).toBe('success');
});
