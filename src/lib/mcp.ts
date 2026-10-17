import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AppError, type Actor } from '@/core/contracts';
import type { createCommerceService } from '@/core/service';
import { templateConfig } from '@/template.config';
import { withOperation } from './telemetry';
import { runtimeSettings } from '@/runtime/server';

type CommerceService = ReturnType<typeof createCommerceService>;
const page = { limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() };
const id = z.string().min(1).max(128);
const confirmation = z.literal(true).describe('Set true only after the user explicitly approves this exact mutation.');
const fields = {
  sku: z.string().min(1).max(80), name: z.string().min(1).max(180), description: z.string().max(5000).optional(),
  category: z.string().max(80).optional(), priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/), imageUrl: z.string().url().nullable().optional(), active: z.boolean().optional(),
};

/** Same domain service as the UI. Tenant/identity are bound by verified OAuth, never model input. */
export function createCommerceMcpServer(actor: Actor, service: CommerceService) {
  const server = new McpServer({ name: templateConfig.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-commerce', version: '0.1.0' });
  function definition(description: string, scope: string, write = false) {
    return {
      description,
      annotations: { readOnlyHint: !write, destructiveHint: write, idempotentHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] },
    };
  }
  async function call(operation: string, fn: () => Promise<unknown>) {
    try {
      const result = await withOperation(`mcp.tool.${operation}`, { route: '/api/mcp' }, fn);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof AppError ? error.message : 'The operation failed. Retry using the same idempotency key when applicable.';
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }] };
    }
  }
  const granted = (scope: string) => {
    const roleAllows = actor.role === 'owner' || actor.role === 'admin' || ['products:read', 'orders:read', 'dashboard:read'].includes(scope) || (actor.role === 'cashier' && scope === 'orders:write');
    const moduleAllows = scope.startsWith('products:') ? templateConfig.modules.catalog : scope.startsWith('stock:') ? templateConfig.modules.inventory : scope.startsWith('orders:') ? templateConfig.modules.orders : true;
    return templateConfig.modules.mcp && moduleAllows && roleAllows && actor.scopes?.includes(scope) === true;
  };
  if (granted('products:read')) {
    server.registerTool('products_list', { ...definition('List products for the connected business. Prices use integer minor currency units.', 'products:read'), inputSchema: z.object({ ...page, search: z.string().max(100).optional(), activeOnly: z.boolean().optional() }) }, input => call('products_list', () => service.listProducts(actor, input)));
    server.registerTool('products_get', { ...definition('Read a product and its current version before changing it.', 'products:read'), inputSchema: z.object({ productId: id }) }, input => call('products_get', () => service.getProduct(actor, input.productId)));
  }
  if (granted('products:write')) {
    server.registerTool('products_create', { ...definition('Create a product after explicit user approval. Check SKU first to avoid duplicates.', 'products:write', true), inputSchema: z.object({ ...fields, stock: z.number().int().min(0).optional(), confirmed: confirmation }) }, ({ confirmed: _confirmed, ...input }) => call('products_create', () => service.createProduct(actor, input)));
    server.registerTool('products_update', { ...definition('Update a product after approval. Requires the version from products_get; a stale version returns a conflict.', 'products:write', true), inputSchema: z.object({ ...z.object(fields).partial().shape, productId: id, version: z.number().int().min(1), confirmed: confirmation }) }, ({ productId, confirmed: _confirmed, ...input }) => call('products_update', () => service.updateProduct(actor, productId, input)));
  }
  if (granted('stock:write')) server.registerTool('stock_adjust', { ...definition('Adjust stock with an audit reason after explicit approval. Reuse the same idempotency key on retries.', 'stock:write', true), inputSchema: z.object({ productId: id, delta: z.number().int(), reason: z.string().min(3).max(240), version: z.number().int().min(1).optional(), idempotencyKey: z.string().min(8).max(128), confirmed: confirmation }) }, ({ productId, confirmed: _confirmed, ...input }) => call('stock_adjust', () => service.adjustStock(actor, productId, input)));
  if (granted('orders:read')) server.registerTool('orders_list', { ...definition('List orders for the connected business.', 'orders:read'), inputSchema: z.object(page) }, input => call('orders_list', () => service.listOrders(actor, input)));
  if (granted('orders:write')) server.registerTool('orders_create', { ...definition('Record a cash POS sale or pending manual web order after explicit approval. This does not charge a payment card. Reuse the idempotency key on retries.', 'orders:write', true), inputSchema: z.object({ items: z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(10000) })).min(1).max(100), customer: z.object({ name: z.string().min(1).max(160), email: z.string().email().max(254), phone: z.string().max(40).optional(), address: z.string().max(500).optional() }).optional(), channel: z.enum(['web', 'pos']), paymentMethod: z.enum(['cash', 'manual']), expectedCurrency: z.string().regex(/^[A-Z]{3}$/).describe('Currency approved together with the total.'), expectedTotalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Exact total approved by the user in minor currency units; fails if prices changed.'), idempotencyKey: z.string().min(8).max(128), confirmed: confirmation }) }, ({ confirmed: _confirmed, ...input }) => call('orders_create', () => service.createOrder(actor, input)));
  if (granted('orders:write') && (actor.role === 'owner' || actor.role === 'admin')) server.registerTool('orders_update_status', { ...definition('Mark a pending manual order completed only after verifying payment, or cancel it and restore reserved stock. Requires explicit user approval. Terminal states cannot be reversed.', 'orders:write', true), inputSchema: z.object({ orderId: id, status: z.enum(['completed', 'cancelled']), confirmed: confirmation }) }, ({ orderId, confirmed: _confirmed, ...input }) => call('orders_update_status', () => service.updateOrderStatus(actor, orderId, input)));
  if (granted('dashboard:read')) server.registerTool('dashboard_get', { ...definition('Read sales totals separated by currency, inventory alerts and recent orders.', 'dashboard:read'), inputSchema: z.object({}) }, () => call('dashboard_get', () => service.getDashboard(actor)));
  if (granted('audit:read')) server.registerTool('audit_list', { ...definition('Read the business audit trail for administrative changes.', 'audit:read'), inputSchema: z.object(page) }, input => call('audit_list', () => service.listAudit(actor, input)));
  if (granted('settings:read')) server.registerTool('settings_get', { ...definition('Read current operational settings and version for this business.', 'settings:read'), inputSchema: z.object({}) }, () => call('settings_get', () => runtimeSettings().getSettings(actor)));
  if (granted('settings:write')) server.registerTool('settings_update', { ...definition('After explicit approval, change the public notice or pause/resume NEW orders immediately. Existing orders keep their lifecycle. Requires current settings version.', 'settings:write', true), inputSchema: z.object({ version: z.number().int().min(0), acceptingOrders: z.boolean(), notice: z.string().max(200), confirmed: confirmation }).strict() }, ({ confirmed: _confirmed, ...input }) => call('settings_update', () => runtimeSettings().updateSettings(actor, input)));
  return server;
}
export function createCommerceMcpHandler(actor: Actor, service: CommerceService) {
  return createMcpHandler(() => createCommerceMcpServer(actor, service), { legacy: 'stateless' });
}
