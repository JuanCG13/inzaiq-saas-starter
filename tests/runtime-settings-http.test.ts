import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { AppError, type Actor } from '../src/core/contracts';
import { createRuntimeSettingsService } from '../src/runtime/service';
import { withTelemetrySink } from '../src/lib/telemetry';
import { templateConfig } from '../src/template.config';

let db: Kysely<Database>;
let directory: string;
vi.mock('@/db', async importOriginal => ({ ...await importOriginal<object>(), getDatabase: () => db }));
vi.mock('@/lib/request-actor', async importOriginal => ({ ...await importOriginal<object>(), requestActor: vi.fn() }));
const { requestActor } = await import('../src/lib/request-actor');
const { GET, PATCH } = await import('../src/app/api/admin/settings/route');
const owner: Actor = { userId: 'owner', tenantId: 'store-a', role: 'owner' };
const origin = 'http://localhost:3000';
const request = (body?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/admin/settings`, {
  method: body === undefined ? 'GET' : 'PATCH', headers: { origin, 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'runtime-http-'));
  db = createDatabase({ provider: 'sqlite', url: `file:${join(directory, 'runtime.db')}` });
  await migrateDatabase(db);
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('APP_URL', origin);
  vi.mocked(requestActor).mockResolvedValue(owner);
});
afterEach(async () => { await db.destroy(); await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('serves uncached current settings and enforces PATCH version with safe correlated HTTP events', async () => {
  const records: Record<string, unknown>[] = [];
  const id = '12345678-1234-1234-1234-123456789012';
  const body = { version: 0, acceptingOrders: false, notice: 'NOTICE_MUST_NOT_APPEAR_IN_LOGS' };
  const response = await withTelemetrySink(record => records.push(record), () => PATCH(request(body, { 'x-request-id': id, 'x-tenant-id': 'forged-tenant' })));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-request-id')).toBe(id);
  expect((await response.json()).data.settings).toEqual({ ...body, version: 1 });
  expect((await PATCH(request(body))).status).toBe(409);
  expect((await (await GET(request())).json()).data.settings.version).toBe(1);
  expect(await db.selectFrom('commerce_runtime_settings').select('tenant_id').execute()).toEqual([{ tenant_id: owner.tenantId }]);
  expect(records.filter(event => event.operation === 'settings.update')).toEqual([expect.objectContaining({ 'request.id': id, 'event.outcome': 'success' })]);
  expect(JSON.stringify(records)).not.toContain(body.notice);
});

it('rejects unsigned sessions, insufficient roles, cross-origin PATCH and extra fields', async () => {
  const body = { version: 0, acceptingOrders: false, notice: '' };
  vi.mocked(requestActor).mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in', 401));
  expect((await GET(request())).status).toBe(401);
  vi.mocked(requestActor).mockResolvedValue({ ...owner, role: 'cashier' });
  expect((await GET(request())).status).toBe(403);
  expect((await PATCH(request(body))).status).toBe(403);
  vi.mocked(requestActor).mockResolvedValue(owner);
  expect((await PATCH(request(body, { origin: 'https://untrusted.test' }))).status).toBe(403);
  expect((await PATCH(request({ ...body, secret: 'arbitrary-setting' }))).status).toBe(400);
  expect(await db.selectFrom('commerce_runtime_settings').selectAll().execute()).toEqual([]);
});

it('exposes only the configured ecommerce tenant through the public read endpoint', async () => {
  if (templateConfig.kind !== 'ecommerce') return;
  const publicRoute = await import('../src/app/api/store/settings/route');
  vi.stubEnv('STORE_TENANT_ID', owner.tenantId);
  const service = createRuntimeSettingsService(db);
  await service.updateSettings(owner, { version: 0, acceptingOrders: false, notice: 'Store A' });
  await service.updateSettings({ ...owner, tenantId: 'store-b' }, { version: 0, acceptingOrders: true, notice: 'Private other tenant' });
  const response = await publicRoute.GET(new Request(`${origin}/api/store/settings?tenantId=store-b`, { headers: { 'x-tenant-id': 'store-b' } }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.settings).toEqual({ version: 1, acceptingOrders: false, notice: 'Store A' });
});
