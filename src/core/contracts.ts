export type Role = 'owner' | 'admin' | 'cashier' | 'viewer';
export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
  /** Undefined means session access; present means explicit granted OAuth scopes. */
  scopes?: string[];
}

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceMinor: number;
  currency: string;
  stock: number;
  imageUrl: string | null;
  active: boolean;
  version: number;
}

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface Order {
  id: string;
  tenantId: string;
  items: OrderItem[];
  totalMinor: number;
  currency: string;
  status: 'pending' | 'completed' | 'cancelled';
  channel: 'web' | 'pos';
  paymentMethod: 'cash' | 'manual';
  paymentProvider: string | null;
  createdAt: string;
  customer: Customer | null;
}
export interface Customer { name: string; email: string; phone?: string; address?: string }

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  priceMinor: number;
  currency: string;
  stock?: number;
  imageUrl?: string | null;
  active?: boolean;
}

/** Stock is changed only through adjustStock, with its own audit reason. */
export type UpdateProductInput = Partial<Omit<CreateProductInput, 'stock'>> & { version: number };
export interface AdjustStockInput { delta: number; reason: string; version?: number; idempotencyKey: string }
export interface CreateOrderInput {
  items: { productId: string; quantity: number }[];
  idempotencyKey: string;
  channel: 'web' | 'pos';
  paymentMethod: 'cash' | 'manual';
  customer?: Customer;
  /** Optional caller assertion; server still calculates every price and total. */
  expectedTotalMinor?: number;
  /** Currency shown to the caller when confirming the expected total. */
  expectedCurrency?: string;
  /** Trusted server orchestration only. Never expose in HTTP/MCP mutation schemas. */
  paymentProvider?: string;
}
export interface UpdateOrderStatusInput { status: 'completed' | 'cancelled' }
export interface ListOptions { limit?: number; offset?: number }
export interface ProductListOptions extends ListOptions { activeOnly?: boolean; search?: string }
export interface AuditEntry {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceId: string;
  details: Record<string, string | number | boolean>;
  createdAt: string;
}
export interface Dashboard {
  productCount: number;
  activeProductCount: number;
  lowStockCount: number;
  orderCount: number;
  /** Never sums unlike currencies or pending/manual orders. */
  revenueByCurrency: { currency: string; totalMinor: number }[];
  recentOrders: Order[];
}

export interface DomainEvent {
  name: 'commerce.operation.completed' | 'commerce.operation.retry';
  schemaVersion: 1;
  operation: string;
  outcome: 'success' | 'rejected' | 'failure';
  durationMs: number;
  errorCode?: string;
  retryCount?: number;
}
export interface ServiceOptions { telemetry?: (event: DomainEvent) => void }

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) { super(message); this.name = 'AppError'; }
}
