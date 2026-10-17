import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Actor } from '../src/core/contracts';
import type { Database } from '../src/db/schema';
import type { Kysely } from 'kysely';

const fixture = vi.hoisted(() => ({ db: undefined as Kysely<Database> | undefined }));
vi.mock('../src/db', async importOriginal => ({
  ...await importOriginal<typeof import('../src/db')>(),
  getDatabase: () => { if (!fixture.db) throw new Error('Fixture is not initialized'); return fixture.db; },
}));
import { createDatabase, migrateDatabase } from '../src/db';
import { createCommerceService } from '../src/core/service';
import { createCommerceMcpHandler } from '../src/lib/mcp';
import { withTelemetrySink } from '../src/lib/telemetry';

const owner: Actor = { userId: 'runtime-owner', tenantId: 'runtime-tenant-a', role: 'owner', scopes: ['settings:read', 'settings:write', 'orders:write', 'products:read'] };
let directory: string;
let commerce: ReturnType<typeof createCommerceService>;
const clients: Client[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'runtime-mcp-independent-'));
  fixture.db = createDatabase({ provider: 'sqlite', url: 'file:' + join(directory, 'test.db') });
  await migrateDatabase(fixture.db);
  commerce = createCommerceService(fixture.db);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await fixture.db?.destroy(); fixture.db = undefined;
  await rm(directory, { recursive: true, force: true });
});
async function connect(actor = owner) {
  const handler = createCommerceMcpHandler(actor, commerce);
  const client = new Client({ name: 'independent-runtime-qa', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/api/mcp'), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  // SDK schema failures are text; domain responses are structured JSON text.
  let data;
  try { data = JSON.parse(content[0].text); } catch { data = content[0].text; }
  return { failed: result.isError === true, data };
}

test('MCP settings discovery intersects administrative role with explicit scope and confirmation', async () => {
  for (const actor of [
    { ...owner, role: 'cashier' as const }, { ...owner, role: 'viewer' as const },
    { ...owner, scopes: ['products:read'] }, { ...owner, scopes: [] },
  ]) {
    const client = await connect(actor);
    expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('settings_update');
    await expect(call(client, 'settings_update', { version: 0, acceptingOrders: false, notice: '', confirmed: true })).rejects.toThrow(/not found/);
  }
  const reader = await connect({ ...owner, scopes: ['settings:read'] });
  expect((await reader.listTools()).tools.map(tool => tool.name)).toEqual(['settings_get']);
  const writer = await connect();
  for (const args of [
    { version: 0, acceptingOrders: false, notice: '' },
    { version: 0, acceptingOrders: false, notice: '', confirmed: false },
    { version: 0, acceptingOrders: false, notice: '', confirmed: true, tenantId: 'runtime-tenant-b' },
  ]) expect((await call(writer, 'settings_update', args)).failed).toBe(true);
  expect(await fixture.db!.selectFrom('commerce_runtime_settings').selectAll().execute()).toEqual([]);
});

test('MCP pause is live for new orders, preserves accepted replay and applies only to its tenant', async () => {
  const customerNotice = 'Private internal note customer@example.invalid';
  const records: Record<string, unknown>[] = [];
  await withTelemetrySink(record => records.push(record), async () => {
    const client = await connect();
    const other = await connect({ ...owner, tenantId: 'runtime-tenant-b' });
    const product = await commerce.createProduct({ ...owner, scopes: undefined }, { sku: 'LIVE-01', name: 'Live test', currency: 'USD', priceMinor: 500, stock: 5 });
    const orderInput = { items: [{ productId: product.id, quantity: 1 }], channel: 'pos', paymentMethod: 'cash', expectedTotalMinor: 500, expectedCurrency: 'USD', idempotencyKey: 'accepted-before-pause', confirmed: true };
    const accepted = await call(client, 'orders_create', orderInput);
    expect(accepted.failed).toBe(false);
    const paused = await call(client, 'settings_update', { version: 0, acceptingOrders: false, notice: customerNotice, confirmed: true });
    expect(paused).toEqual({ failed: false, data: { version: 1, acceptingOrders: false, notice: customerNotice } });
    expect((await call(other, 'settings_get', {})).data).toEqual({ version: 0, acceptingOrders: true, notice: '' });
    const denied = await call(client, 'orders_create', { ...orderInput, idempotencyKey: 'new-while-paused' });
    expect(denied).toMatchObject({ failed: true, data: { error: { code: 'ORDERS_PAUSED' } } });
    const replay = await call(client, 'orders_create', orderInput);
    expect(replay.failed).toBe(false); expect(replay.data.id).toBe(accepted.data.id);
    expect((await commerce.getProduct(owner, product.id)).stock).toBe(4);
    const stale = await call(client, 'settings_update', { version: 0, acceptingOrders: true, notice: '', confirmed: true });
    expect(stale).toMatchObject({ failed: true, data: { error: { code: 'VERSION_CONFLICT' } } });
    expect((await call(client, 'settings_get', {})).data.acceptingOrders).toBe(false);
    expect((await call(client, 'settings_update', { version: 1, acceptingOrders: true, notice: '', confirmed: true })).failed).toBe(false);
    expect((await call(client, 'orders_create', { ...orderInput, idempotencyKey: 'new-while-paused' })).failed).toBe(false);
    expect((await commerce.getProduct(owner, product.id)).stock).toBe(3);
  });
  const audit = await fixture.db!.selectFrom('commerce_audit').selectAll().where('action', '=', 'settings.updated').execute();
  expect(audit).toHaveLength(2);
  expect(JSON.stringify(audit)).not.toContain(customerNotice);
  expect(JSON.stringify(records)).not.toContain(customerNotice);
  expect(records.some(record => record['event.name'] === 'mcp.tool.orders_create.completed' && record['event.outcome'] === 'rejected' && record['error.code'] === 'ORDERS_PAUSED')).toBe(true);
});
