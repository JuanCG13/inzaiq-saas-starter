import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { Database, ProductTable, OrderTable, OrderItemTable } from '../db/schema';
import {
  AppError, type Actor, type AdjustStockInput, type AuditEntry, type CreateOrderInput,
  type CreateProductInput, type Dashboard, type DomainEvent, type ListOptions,
  type Order, type Product, type ProductListOptions, type ServiceOptions, type UpdateProductInput, type Customer, type UpdateOrderStatusInput,
} from './contracts';

type DB = Kysely<Database> | Transaction<Database>;
const MAX_STOCK = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;
const READ_SCOPES = ['products:read', 'orders:read', 'dashboard:read'];

function assertActor(actor: Actor, scope: string) {
  if (!actor?.userId || !actor?.tenantId) throw new AppError('UNAUTHENTICATED', 'Authentication required.', 401);
  const allowed = actor.role === 'owner' || actor.role === 'admin'
    || (actor.role === 'cashier' && [...READ_SCOPES, 'orders:write'].includes(scope))
    || (actor.role === 'viewer' && READ_SCOPES.includes(scope));
  if (!allowed || (actor.scopes && !actor.scopes.includes(scope))) {
    throw new AppError('FORBIDDEN', 'This operation is not permitted.', 403);
  }
}
function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', 'An input object is required.');
}

function text(value: unknown, field: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AppError('INVALID_INPUT', `Invalid ${field}.`);
  }
  return value.trim();
}
function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new AppError('INVALID_INPUT', `${field} must be a safe integer between ${min} and ${max}.`);
  }
  return value;
}
function safeMoney(value: number | string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new AppError('MONEY_OVERFLOW', 'Amount exceeds supported precision.', 422);
  return number;
}
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new AppError('INVALID_INPUT', 'Currency must use a three-letter uppercase code.');
  return value;
}
function imageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new AppError('INVALID_INPUT', 'Invalid image URL.');
  // Stored for rendering only; the server never fetches arbitrary user URLs.
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { if (new URL(value).protocol === 'https:') return value; } catch { /* normalized below */ }
  throw new AppError('INVALID_INPUT', 'Image URL must use HTTPS or a local absolute path.');
}
function page(options: ListOptions = {}) {
  return { limit: integer(options.limit ?? 50, 'limit', 1, 200), offset: integer(options.offset ?? 0, 'offset', 0, 1_000_000) };
}
function product(row: Selectable<ProductTable>): Product {
  return {
    id: row.id, tenantId: row.tenant_id, sku: row.sku, name: row.name,
    description: row.description, category: row.category, priceMinor: safeMoney(row.price_minor),
    currency: row.currency, stock: row.stock, imageUrl: row.image_url, active: row.active === 1, version: row.version,
  };
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function customer(value: Customer | undefined): Customer | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new AppError('INVALID_INPUT', 'Invalid customer.');
  const email = text(value.email, 'customer.email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('INVALID_INPUT', 'Invalid customer email.');
  return { name: text(value.name, 'customer.name', 160), email,
    ...(value.phone ? { phone: text(value.phone, 'customer.phone', 40) } : {}),
    ...(value.address ? { address: text(value.address, 'customer.address', 500) } : {}),
  };
}
function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const e = error as { code?: unknown; extendedCode?: unknown; cause?: unknown };
  return typeof e.extendedCode === 'string' ? e.extendedCode : typeof e.code === 'string' ? e.code : e.cause ? errorCode(e.cause) : '';
}
function normalizeError(error: unknown): Error {
  if (error instanceof AppError) return error;
  const code = errorCode(error);
  if (['23505', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(code)) {
    return new AppError('CONFLICT', 'A resource with that key already exists.', 409);
  }
  if (['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', '40001', '40P01'].includes(code)) {
    return new AppError('RETRY_REQUIRED', 'Concurrent change. Retry with the same idempotency key.', 409);
  }
  return error instanceof Error ? error : new Error('Unexpected database failure.');
}
async function audit(db: DB, actor: Actor, action: string, resourceId: string, details: Record<string, string | number | boolean>) {
  await db.insertInto('commerce_audit').values({
    id: randomUUID(), tenant_id: actor.tenantId, actor_id: actor.userId, action,
    resource_id: resourceId, details_json: JSON.stringify(details), created_at: new Date().toISOString(),
  }).execute();
}
async function findProduct(db: DB, tenantId: string, id: string): Promise<Product> {
  const row = await db.selectFrom('commerce_products').selectAll().where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  return product(row);
}
function orderWithItems(row: Selectable<OrderTable>, items: Selectable<OrderItemTable>[]): Order {
  return {
    id: row.id, tenantId: row.tenant_id, totalMinor: safeMoney(row.total_minor), currency: row.currency,
    status: row.status, channel: row.channel, paymentMethod: row.payment_method, paymentProvider: row.payment_provider, createdAt: row.created_at,
    customer: row.customer_json ? JSON.parse(row.customer_json) : null,
    items: items.map(i => ({ productId: i.product_id, sku: i.sku, name: i.name, quantity: i.quantity, unitPriceMinor: safeMoney(i.unit_price_minor), totalMinor: safeMoney(i.total_minor) })),
  };
}
async function loadOrders(db: DB, tenantId: string, rows: Selectable<OrderTable>[]): Promise<Order[]> {
  if (!rows.length) return [];
  if (rows.some(row => row.tenant_id !== tenantId)) throw new Error('Order batch tenant invariant failed.');
  const items = await db.selectFrom('commerce_order_items').selectAll().where('tenant_id', '=', tenantId)
    .where('order_id', 'in', rows.map(row => row.id)).orderBy('order_id').orderBy('product_id').execute();
  const byOrder = new Map<string, Selectable<OrderItemTable>[]>();
  for (const item of items) {
    const group = byOrder.get(item.order_id) ?? [];
    group.push(item);
    byOrder.set(item.order_id, group);
  }
  return rows.map(row => orderWithItems(row, byOrder.get(row.id) ?? []));
}
async function loadOrder(db: DB, row: Selectable<OrderTable>): Promise<Order> {
  return (await loadOrders(db, row.tenant_id, [row]))[0]!;
}

export function createCommerceService(db: Kysely<Database>, options: ServiceOptions = {}) {
  function emit(event: DomainEvent) { try { options.telemetry?.(event); } catch { /* Diagnostics must never break commerce. */ } }
  async function operation<T>(name: string, actor: Actor, scope: string, action: () => Promise<T>): Promise<T> {
    const start = performance.now();
    let outcome: DomainEvent['outcome'] = 'success';
    let code: string | undefined;
    try { assertActor(actor, scope); return await action(); }
    catch (error) {
      const normalized = normalizeError(error);
      outcome = normalized instanceof AppError ? 'rejected' : 'failure';
      code = normalized instanceof AppError ? normalized.code : 'INTERNAL_ERROR';
      throw normalized;
    } finally {
      emit({ name: 'commerce.operation.completed', schemaVersion: 1, operation: name, outcome, durationMs: performance.now() - start, ...(code ? { errorCode: code } : {}) });
    }
  }
  async function transaction<T>(name: string, work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction().execute(work); }
      catch (error) {
        // Retry only transactions the database has rolled back; never retry unknown commit outcomes.
        if (attempt >= 2 || !['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', '40001', '40P01'].includes(errorCode(error))) throw error;
        emit({ name: 'commerce.operation.retry', schemaVersion: 1, operation: name, outcome: 'rejected', errorCode: 'CONCURRENT_TRANSACTION', durationMs: 0, retryCount: attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  return {
    createProduct(actor: Actor, input: CreateProductInput): Promise<Product> {
      return operation('product.create', actor, 'products:write', async () => {
        assertRecord(input);
        const now = new Date().toISOString();
        if (input.active !== undefined && typeof input.active !== 'boolean') throw new AppError('INVALID_INPUT', 'Invalid active flag.');
        const values = {
          id: randomUUID(), tenant_id: actor.tenantId, sku: text(input.sku, 'sku', 64), name: text(input.name, 'name', 160),
          description: text(input.description, 'description', 2000, true), category: text(input.category, 'category', 80, true),
          price_minor: integer(input.priceMinor, 'priceMinor'), currency: currency(input.currency), stock: integer(input.stock ?? 0, 'stock', 0, MAX_STOCK),
          image_url: imageUrl(input.imageUrl), active: input.active === false ? 0 : 1, version: 1, created_at: now, updated_at: now,
        };
        return transaction('product.create', async trx => {
          const row = await trx.insertInto('commerce_products').values(values).returningAll().executeTakeFirstOrThrow();
          await audit(trx, actor, 'product.created', row.id, { initialStock: values.stock, version: 1 });
          return product(row);
        });
      });
    },
    updateProduct(actor: Actor, id: string, input: UpdateProductInput): Promise<Product> {
      return operation('product.update', actor, 'products:write', async () => {
        assertRecord(input);
        integer(input.version, 'version', 1, 2_147_483_646);
        if ('stock' in input) throw new AppError('INVALID_INPUT', 'Use adjustStock for stock changes.');
        const values: Record<string, string | number | null> = { updated_at: new Date().toISOString(), version: input.version + 1 };
        if (input.sku !== undefined) values.sku = text(input.sku, 'sku', 64);
        if (input.name !== undefined) values.name = text(input.name, 'name', 160);
        if (input.description !== undefined) values.description = text(input.description, 'description', 2000, true);
        if (input.category !== undefined) values.category = text(input.category, 'category', 80, true);
        if (input.priceMinor !== undefined) values.price_minor = integer(input.priceMinor, 'priceMinor');
        if (input.currency !== undefined) values.currency = currency(input.currency);
        if (input.imageUrl !== undefined) values.image_url = imageUrl(input.imageUrl);
        if (input.active !== undefined) {
          if (typeof input.active !== 'boolean') throw new AppError('INVALID_INPUT', 'Invalid active flag.');
          values.active = input.active ? 1 : 0;
        }
        return transaction('product.update', async trx => {
          await findProduct(trx, actor.tenantId, id);
          const row = await trx.updateTable('commerce_products').set(values).where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('version', '=', input.version).returningAll().executeTakeFirst();
          if (!row) throw new AppError('VERSION_CONFLICT', 'Product changed. Refresh before updating.', 409);
          await audit(trx, actor, 'product.updated', id, { version: row.version });
          return product(row);
        });
      });
    },
    getProduct(actor: Actor, id: string): Promise<Product> {
      return operation('product.get', actor, 'products:read', () => findProduct(db, actor.tenantId, id));
    },
    listProducts(actor: Actor, options: ProductListOptions = {}): Promise<Product[]> {
      return operation('product.list', actor, 'products:read', async () => {
        const { limit, offset } = page(options);
        let query = db.selectFrom('commerce_products').selectAll().where('tenant_id', '=', actor.tenantId);
        if (options.activeOnly) query = query.where('active', '=', 1);
        if (options.search) {
          const search = text(options.search, 'search', 100).toLowerCase();
          const pattern = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
          query = query.where(eb => eb.or([
            sql<boolean>`lower(name) like ${pattern} escape '\\'`,
            sql<boolean>`lower(sku) like ${pattern} escape '\\'`,
          ]));
        }
        return (await query.orderBy('name').orderBy('id').limit(limit).offset(offset).execute()).map(product);
      });
    },
    adjustStock(actor: Actor, id: string, input: AdjustStockInput): Promise<Product> {
      return operation('stock.adjust', actor, 'stock:write', async () => {
        assertRecord(input);
        integer(input.delta, 'delta', -MAX_STOCK, MAX_STOCK);
        if (!input.delta) throw new AppError('INVALID_INPUT', 'Stock delta must be nonzero.');
        const reason = text(input.reason, 'reason', 240);
        const key = text(input.idempotencyKey, 'idempotencyKey', 128);
        if (input.version !== undefined) integer(input.version, 'version', 1, 2_147_483_646);
        const requestHash = hash({ id, delta: input.delta, reason, version: input.version ?? null });
        return transaction('stock.adjust', async trx => {
          await findProduct(trx, actor.tenantId, id);
          const inserted = await trx.insertInto('commerce_stock_operations').values({
            id: randomUUID(), tenant_id: actor.tenantId, product_id: id, idempotency_key: key, request_hash: requestHash,
            result_json: '{}', created_at: new Date().toISOString(),
          }).onConflict(oc => oc.columns(['tenant_id', 'idempotency_key']).doNothing()).returning('id').executeTakeFirst();
          if (!inserted) {
            const previous = await trx.selectFrom('commerce_stock_operations').selectAll().where('tenant_id', '=', actor.tenantId).where('idempotency_key', '=', key).executeTakeFirstOrThrow();
            if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request.', 409);
            return JSON.parse(previous.result_json) as Product;
          }
          let query = trx.updateTable('commerce_products').set({ stock: sql`stock + ${input.delta}`, version: sql`version + 1`, updated_at: new Date().toISOString() })
            .where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('stock', '>=', -input.delta).where('stock', '<=', MAX_STOCK - input.delta);
          if (input.version !== undefined) query = query.where('version', '=', input.version);
          const row = await query.returningAll().executeTakeFirst();
          if (!row) {
            const current = await findProduct(trx, actor.tenantId, id);
            if (input.version !== undefined && current.version !== input.version) throw new AppError('VERSION_CONFLICT', 'Product changed. Refresh before adjusting.', 409);
            throw new AppError('STOCK_LIMIT', 'Stock adjustment exceeds available stock or supported capacity.', 409);
          }
          const result = product(row);
          await trx.updateTable('commerce_stock_operations').set({ result_json: JSON.stringify(result) }).where('id', '=', inserted.id).where('tenant_id', '=', actor.tenantId).execute();
          // Reason is intentional business audit data, never diagnostic telemetry.
          await audit(trx, actor, 'stock.adjusted', id, { delta: input.delta, reason, stock: result.stock, version: result.version });
          return result;
        });
      });
    },
    createOrder(actor: Actor, input: CreateOrderInput): Promise<Order> {
      return operation('order.create', actor, 'orders:write', async () => {
        assertRecord(input);
        const key = text(input.idempotencyKey, 'idempotencyKey', 128);
        if (!['web', 'pos'].includes(input.channel) || !['cash', 'manual'].includes(input.paymentMethod)) throw new AppError('INVALID_INPUT', 'Invalid order channel or payment method.');
        if (input.expectedTotalMinor !== undefined) integer(input.expectedTotalMinor, 'expectedTotalMinor');
        if (input.expectedCurrency !== undefined) currency(input.expectedCurrency);
        if (input.paymentProvider !== undefined && (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.paymentProvider) || input.channel !== 'web' || input.paymentMethod !== 'manual')) throw new AppError('INVALID_INPUT', 'Invalid hosted payment configuration.');
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new AppError('INVALID_INPUT', 'Orders require between 1 and 100 items.');
        const quantities = new Map<string, number>();
        for (const item of input.items) {
          assertRecord(item);
          if (Object.keys(item).some(k => !['productId', 'quantity'].includes(k))) throw new AppError('INVALID_INPUT', 'Order items accept only productId and quantity.');
          const id = text(item.productId, 'productId', 128);
          quantities.set(id, integer((quantities.get(id) ?? 0) + integer(item.quantity, 'quantity', 1, MAX_QUANTITY), 'quantity', 1, MAX_QUANTITY));
        }
        const items = [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }));
        const orderCustomer = customer(input.customer);
        // Preserve hashes for pre-payment manual requests while binding hosted requests to their provider.
        const requestHash = hash({ items, channel: input.channel, paymentMethod: input.paymentMethod, customer: orderCustomer, expectedTotalMinor: input.expectedTotalMinor ?? null, expectedCurrency: input.expectedCurrency ?? null, ...(input.paymentProvider ? { paymentProvider: input.paymentProvider } : {}) });
        return transaction('order.create', async trx => {
          const previous = await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('idempotency_key', '=', key).executeTakeFirst();
          if (previous) {
            if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request.', 409);
            return loadOrder(trx, previous);
          }
          const runtime = await trx.selectFrom('commerce_runtime_settings').select('accepting_orders').where('tenant_id', '=', actor.tenantId).executeTakeFirst();
          if (runtime?.accepting_orders === 0) throw new AppError('ORDERS_PAUSED', 'Las nuevas operaciones están pausadas. Intentá más tarde.', 409);
          // Claim the idempotency key before changing stock. Concurrent inserts serialize on the unique constraint.
          const id = randomUUID();
          const row = await trx.insertInto('commerce_orders').values({
            id, tenant_id: actor.tenantId, actor_id: actor.userId, idempotency_key: key, request_hash: requestHash,
            total_minor: 0, currency: 'XXX', status: input.channel === 'pos' && input.paymentMethod === 'cash' ? 'completed' : 'pending',
            channel: input.channel, payment_method: input.paymentMethod, payment_provider: input.paymentProvider ?? null, created_at: new Date().toISOString(), customer_json: orderCustomer ? JSON.stringify(orderCustomer) : null,
          }).onConflict(oc => oc.columns(['tenant_id', 'idempotency_key']).doNothing()).returningAll().executeTakeFirst();
          if (!row) {
            const existing = await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('idempotency_key', '=', key).executeTakeFirstOrThrow();
            if (existing.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request.', 409);
            return loadOrder(trx, existing);
          }
          let total = 0;
          let orderCurrency: string | undefined;
          // Stable product order reduces deadlocks; atomic UPDATE both locks and snapshots current server price.
          for (const item of items) {
            const updated = await trx.updateTable('commerce_products').set({ stock: sql`stock - ${item.quantity}`, version: sql`version + 1`, updated_at: new Date().toISOString() })
              .where('tenant_id', '=', actor.tenantId).where('id', '=', item.productId).where('active', '=', 1).where('stock', '>=', item.quantity).returningAll().executeTakeFirst();
            if (!updated) throw new AppError('INSUFFICIENT_STOCK', 'An item is unavailable or has insufficient stock.', 409);
            const current = product(updated);
            if (orderCurrency && current.currency !== orderCurrency) throw new AppError('MIXED_CURRENCY', 'All order items must use the same currency.', 422);
            orderCurrency = current.currency;
            const lineTotal = safeMoney(current.priceMinor * item.quantity);
            total = safeMoney(total + lineTotal);
            await trx.insertInto('commerce_order_items').values({ id: randomUUID(), tenant_id: actor.tenantId, order_id: id, product_id: current.id, sku: current.sku, name: current.name, quantity: item.quantity, unit_price_minor: current.priceMinor, total_minor: lineTotal }).execute();
          }
          if (input.expectedTotalMinor !== undefined && input.expectedTotalMinor !== total) {
            throw new AppError('PRICE_CHANGED', 'Prices have changed. Review the current total before confirming.', 409);
          }
          if (input.expectedCurrency !== undefined && input.expectedCurrency !== orderCurrency) {
            throw new AppError('CURRENCY_CHANGED', 'Currency has changed. Review the current currency before confirming.', 409);
          }
          const completed = await trx.updateTable('commerce_orders').set({ total_minor: total, currency: orderCurrency! }).where('id', '=', id).where('tenant_id', '=', actor.tenantId).returningAll().executeTakeFirstOrThrow();
          await audit(trx, actor, 'order.created', id, { totalMinor: total, currency: orderCurrency!, itemCount: items.length, channel: input.channel, status: completed.status });
          return loadOrder(trx, completed);
        });
      });
    },
    listOrders(actor: Actor, options: ListOptions = {}): Promise<Order[]> {
      return operation('order.list', actor, 'orders:read', async () => {
        const { limit, offset } = page(options);
        const rows = await db.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).orderBy('created_at', 'desc').orderBy('id').limit(limit).offset(offset).execute();
        return loadOrders(db, actor.tenantId, rows);
      });
    },
    getOrder(actor: Actor, id: string): Promise<Order> {
      return operation('order.get', actor, 'orders:read', async () => {
        const row = await db.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('id', '=', id).executeTakeFirst();
        if (!row) throw new AppError('NOT_FOUND', 'Order not found.', 404);
        return loadOrder(db, row);
      });
    },
    updateOrderStatus(actor: Actor, id: string, input: UpdateOrderStatusInput): Promise<Order> {
      return operation('order.status.update', actor, 'orders:write', async () => {
        assertRecord(input);
        // Cashiers can create sales but cannot confirm manual payments or reverse stock.
        if (!['owner', 'admin'].includes(actor.role)) throw new AppError('FORBIDDEN', 'Only an administrator can change order status.', 403);
        if (!['completed', 'cancelled'].includes(input.status)) throw new AppError('INVALID_INPUT', 'Invalid target status.');
        return transaction('order.status.update', async trx => {
          const current = await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('id', '=', id).executeTakeFirst();
          if (!current) throw new AppError('NOT_FOUND', 'Order not found.', 404);
          if (current.payment_provider) throw new AppError('PAYMENT_PROVIDER_MANAGED', 'Hosted payment orders are updated only by verified provider events.', 409);
          if (current.status === input.status) return loadOrder(trx, current);
          if (current.status !== 'pending') throw new AppError('ORDER_STATUS_CONFLICT', 'Only pending orders can be completed or cancelled.', 409);
          const updated = await trx.updateTable('commerce_orders').set({ status: input.status }).where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('status', '=', 'pending').returningAll().executeTakeFirst();
          if (!updated) {
            const latest = await trx.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).where('id', '=', id).executeTakeFirstOrThrow();
            if (latest.status === input.status) return loadOrder(trx, latest);
            throw new AppError('ORDER_STATUS_CONFLICT', 'Order status changed concurrently.', 409);
          }
          const order = await loadOrder(trx, updated);
          if (input.status === 'cancelled') {
            for (const item of order.items) {
              const restored = await trx.updateTable('commerce_products').set({ stock: sql`stock + ${item.quantity}`, version: sql`version + 1`, updated_at: new Date().toISOString() }).where('tenant_id', '=', actor.tenantId).where('id', '=', item.productId).where('stock', '<=', MAX_STOCK - item.quantity).returning('id').executeTakeFirst();
              if (!restored) throw new AppError('STOCK_LIMIT', 'Restoring stock would exceed supported capacity.', 409);
            }
          }
          await audit(trx, actor, 'order.status.updated', id, { previousStatus: 'pending', status: input.status, stockRestored: input.status === 'cancelled' });
          return order;
        });
      });
    },
    getDashboard(actor: Actor): Promise<Dashboard> {
      return operation('dashboard.get', actor, 'dashboard:read', async () => {
        const counts = await db.selectFrom('commerce_products').select(eb => [eb.fn.countAll<number>().as('total'), sql<number>`coalesce(sum(active), 0)`.as('active'), sql<number>`coalesce(sum(case when active = 1 and stock <= 5 then 1 else 0 end), 0)`.as('low_stock')]).where('tenant_id', '=', actor.tenantId).executeTakeFirstOrThrow();
        const count = await db.selectFrom('commerce_orders').select(eb => eb.fn.countAll<number>().as('total')).where('tenant_id', '=', actor.tenantId).executeTakeFirstOrThrow();
        const revenue = await db.selectFrom('commerce_orders').select(['currency', sql<number | string>`sum(total_minor)`.as('total')]).where('tenant_id', '=', actor.tenantId).where('status', '=', 'completed').groupBy('currency').execute();
        const rows = await db.selectFrom('commerce_orders').selectAll().where('tenant_id', '=', actor.tenantId).orderBy('created_at', 'desc').orderBy('id').limit(5).execute();
        return { productCount: Number(counts.total), activeProductCount: Number(counts.active), lowStockCount: Number(counts.low_stock), orderCount: Number(count.total), revenueByCurrency: revenue.map(r => ({ currency: r.currency, totalMinor: safeMoney(r.total) })), recentOrders: await loadOrders(db, actor.tenantId, rows) };
      });
    },
    listAudit(actor: Actor, options: ListOptions = {}): Promise<AuditEntry[]> {
      return operation('audit.list', actor, 'audit:read', async () => {
        const { limit, offset } = page(options);
        const rows = await db.selectFrom('commerce_audit').selectAll().where('tenant_id', '=', actor.tenantId).orderBy('created_at', 'desc').orderBy('id').limit(limit).offset(offset).execute();
        return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, actorId: row.actor_id, action: row.action, resourceId: row.resource_id, details: JSON.parse(row.details_json), createdAt: row.created_at }));
      });
    },
  };
}
export type CommerceService = ReturnType<typeof createCommerceService>;
