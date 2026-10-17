import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createCommerceMcpHandler } from '../src/lib/mcp';
import { createCommerceService } from '../src/core/service';
import { createDatabase, migrateDatabase } from '../src/db';
import { withTelemetrySink } from '../src/lib/telemetry';
import type { Actor } from '../src/core/contracts';
let dir: string;
let db: ReturnType<typeof createDatabase>;
let service: ReturnType<typeof createCommerceService>;
const actor: Actor = { userId: 'owner-1', tenantId: 'tenant-a', role: 'owner', scopes: ['products:read', 'products:write', 'stock:write', 'orders:read', 'orders:write', 'dashboard:read', 'audit:read'] };
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mcp-test-')); db = createDatabase({ provider: 'sqlite', url: 'file:' + join(dir, 'data.db') }); await migrateDatabase(db); service = createCommerceService(db); });
afterEach(async () => { await db.destroy(); await rm(dir, { recursive: true, force: true }); });
async function connect(principal = actor) {
  const handler = createCommerceMcpHandler(principal, service);
  const client = new Client({ name: 'template-integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/api/mcp'), { fetch: (input, init) => handler.fetch(new Request(input, init)) });
  await client.connect(transport); return client;
}
function payload(result: any) { return JSON.parse(result.content[0].text); }

test('real SDK discovers tools and invokes reads and approved writes with telemetry', async () => {
  const records: Record<string, unknown>[] = [];
  await withTelemetrySink(record => records.push(record), async () => {
    const client = await connect();
    try {
      const tools = await client.listTools(); expect(tools.tools.map(tool => tool.name)).toContain('stock_adjust');
      const created = await client.callTool({ name: 'products_create', arguments: { sku: 'MCP-01', name: 'Lamp', currency: 'USD', priceMinor: 2500, stock: 3, confirmed: true } });
      expect(created.isError).not.toBe(true); const product = payload(created);
      expect((await service.listProducts(actor, {})).length).toBe(1);
      const listed = await client.callTool({ name: 'products_list', arguments: {} });
      expect(JSON.stringify(listed)).toContain(product.id);
      const sale = await client.callTool({ name: 'orders_create', arguments: { items: [{ productId: product.id, quantity: 1 }], channel: 'pos', paymentMethod: 'cash', expectedTotalMinor: 2500, expectedCurrency: 'USD', idempotencyKey: 'sale-retry-key-001', confirmed: true } });
      expect(sale.isError).not.toBe(true);
      const retry = await client.callTool({ name: 'orders_create', arguments: { items: [{ productId: product.id, quantity: 1 }], channel: 'pos', paymentMethod: 'cash', expectedTotalMinor: 2500, expectedCurrency: 'USD', idempotencyKey: 'sale-retry-key-001', confirmed: true } });
      expect(payload(retry).id).toBe(payload(sale).id);
      expect((await service.getProduct(actor, product.id)).stock).toBe(2);
    } finally { await client.close(); }
  });
  expect(records.some(record => record['event.name'] === 'mcp.tool.orders_create.completed' && record['event.outcome'] === 'success')).toBe(true);
  expect(JSON.stringify(records)).not.toContain('sale-retry-key-001');
});
test('write tools are unavailable without scope and malformed confirmation cannot mutate', async () => {
  const readonly = await connect({ ...actor, scopes: ['products:read'] });
  expect((await readonly.listTools()).tools.map(tool => tool.name)).toEqual(['products_list', 'products_get']); await readonly.close();
  const client = await connect();
  const response = await client.callTool({ name: 'products_create', arguments: { sku: 'NO-CONFIRM', name: 'Lamp', currency: 'USD', priceMinor: 100 } });
  expect(response.isError).toBe(true); expect(await service.listProducts(actor, {})).toEqual([]); await client.close();
});
test('tool discovery intersects token scopes with current role', async () => {
  const client = await connect({ ...actor, role: 'viewer' });
  expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('products_create');
  await client.close();
});
