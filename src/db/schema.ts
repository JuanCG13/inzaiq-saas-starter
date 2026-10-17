import type { ColumnType } from 'kysely';

/** pg returns int8 as a string; map explicitly rather than changing global parsers. */
type Int8 = ColumnType<number | string, number, number>;
export interface ProductTable {
  id: string; tenant_id: string; sku: string; name: string; description: string;
  category: string; price_minor: Int8; currency: string; stock: number;
  image_url: string | null; active: number; version: number; created_at: string; updated_at: string;
}
export interface OrderTable {
  id: string; tenant_id: string; actor_id: string; idempotency_key: string;
  request_hash: string; total_minor: Int8; currency: string;
  status: 'pending' | 'completed' | 'cancelled'; channel: 'web' | 'pos';
  payment_method: 'cash' | 'manual'; created_at: string; customer_json: string | null;
  payment_provider: ColumnType<string | null, string | null | undefined, string | null>;
}
export interface OrderItemTable {
  id: string; tenant_id: string; order_id: string; product_id: string;
  sku: string; name: string; quantity: number; unit_price_minor: Int8; total_minor: Int8;
}
export interface AuditTable {
  id: string; tenant_id: string; actor_id: string; action: string;
  resource_id: string; details_json: string; created_at: string;
}
export interface Database {
  commerce_products: ProductTable;
  commerce_orders: OrderTable;
  commerce_order_items: OrderItemTable;
  commerce_audit: AuditTable;
  commerce_stock_operations: {
    id: string; tenant_id: string; product_id: string; idempotency_key: string;
    request_hash: string; result_json: string; created_at: string;
  };
  commerce_rate_limits: { key: string; count: number; expires_at: string };
  commerce_payment_attempts: {
    id: string; tenant_id: string; order_id: string; provider: string;
    request_hash: string; provider_key: string; retry_until: string;
    session_id: string | null; checkout_url: string | null; expires_at: string | null;
    state: 'creating' | 'ready' | 'completed' | 'cancelled' | 'reconciliation_required';
    created_at: string; updated_at: string;
  };
  commerce_payment_events: {
    id: string; provider: string; event_id: string; event_hash: string;
    tenant_id: string; order_id: string; session_id: string;
    type: 'paid' | 'failed' | 'expired';
    outcome: 'applied' | 'ignored' | 'reconciliation_required';
    created_at: string;
  };
  commerce_runtime_settings: {
    tenant_id: string; version: number; accepting_orders: number; notice: string; updated_at: string;
  };
}
