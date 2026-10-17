import { z } from 'zod';
import { AppError, type Actor, type Order, type OrderItem } from '../core/contracts';

/** Contract-only ports. No carrier, storage, subscription or worker is registered here. */
export type IntegerMoney = Readonly<{ amountMinor: Order['totalMinor']; currency: Order['currency'] }>;
export const integerMoneySchema = z.object({
  amountMinor: z.number().int().nonnegative().safe(), currency: z.string().regex(/^[A-Z]{3}$/),
}).strict().readonly();
const opaqueId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const idempotency = z.string().min(1).max(255).regex(/^[A-Za-z0-9:_-]+$/);
const actorSchema = z.object({
  userId: opaqueId, tenantId: opaqueId, role: z.enum(['owner', 'admin', 'cashier', 'viewer']),
  scopes: z.array(z.string().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/)).max(100).optional(),
}).strict();
const identifiersSchema = z.object({ operationId: opaqueId, idempotencyKey: idempotency, requestId: opaqueId.optional() }).strict();
const orderReferenceSchema = z.object({ tenantId: opaqueId, orderId: opaqueId, total: integerMoneySchema }).strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('EXTENSION_INPUT_INVALID', 'Invalid extension contract input.', 400);
  return result.data;
}

/** Uses the same safe integer/minor-unit and uppercase currency contract as Order. */
export function createIntegerMoney(input: unknown): IntegerMoney { return parse(integerMoneySchema, input); }

export type ExtensionActor = Readonly<Omit<Actor, 'scopes'> & { scopes?: readonly string[] }>;
export interface ExtensionContext {
  readonly actor: ExtensionActor;
  readonly operationId: string;
  /** Persist once, reuse only for the same normalized operation and provider. */
  readonly idempotencyKey: string;
  readonly requestId?: string;
}

/** Shape validation is NOT authentication. Caller must first verify actor and authorize the operation. */
export function createExtensionContext(actor: Actor, identifiers: { operationId: string; idempotencyKey: string; requestId?: string }): ExtensionContext {
  const checked = parse(actorSchema, actor);
  const keys = parse(identifiersSchema, identifiers);
  const snapshot: ExtensionActor = Object.freeze({ userId: checked.userId, tenantId: checked.tenantId, role: checked.role,
    ...(checked.scopes === undefined ? {} : { scopes: Object.freeze([...checked.scopes]) }) });
  return Object.freeze({ actor: snapshot, ...keys });
}

export interface ImmutableOrderReference {
  readonly tenantId: Order['tenantId'];
  readonly orderId: Order['id'];
  readonly total: IntegerMoney;
}

/** Snapshot server-loaded order facts only. It does not prove payment or authorize fulfillment. */
export function createOrderReference(context: ExtensionContext, order: Pick<Order, 'tenantId' | 'id' | 'totalMinor' | 'currency'>): ImmutableOrderReference {
  if (!order || order.tenantId !== context.actor.tenantId) throw new AppError('FORBIDDEN', 'Order does not belong to this tenant.', 403);
  const checked = parse(orderReferenceSchema, { tenantId: order.tenantId, orderId: order.id,
    total: { amountMinor: order.totalMinor, currency: order.currency } });
  return Object.freeze({ ...checked, total: Object.freeze({ ...checked.total }) });
}

/** Always resolve these bindings in the verified tenant; never trust a client provider/customer ID. */
export interface TenantResourceReference { readonly tenantId: string; readonly resourceId: string }
export interface ProviderResourceReference extends TenantResourceReference { readonly providerId: string; readonly providerResourceId: string }
export type AsyncProviderResult<T> =
  | Readonly<{ state: 'completed'; value: T }>
  | Readonly<{ state: 'pending'; operation: ProviderResourceReference; pollAfterSeconds?: number }>
  | Readonly<{ state: 'reconciliation_required'; operation: ProviderResourceReference; reason: 'unknown_outcome' | 'state_conflict' }>;

/** Successful signature verification alone is insufficient: match persisted tenant/resource bindings. */
export interface VerifiedProviderEvent<T> {
  readonly providerId: string;
  readonly eventId: string;
  readonly resource: ProviderResourceReference;
  readonly occurredAt: string;
  readonly snapshot: T;
}
export interface WebhookVerifier<T> {
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedProviderEvent<T> | null>;
}

/** PII for a carrier request only; never diagnostic/audit attributes or a job payload. */
export interface DeliveryAddress {
  readonly recipient: string; readonly line1: string; readonly line2?: string;
  readonly city: string; readonly region?: string; readonly postalCode: string; readonly countryCode: string;
}
export interface FulfillmentSnapshot {
  readonly reference: ProviderResourceReference;
  readonly status: 'requested' | 'in_transit' | 'delivered' | 'failed' | 'cancelled' | 'unknown';
  readonly observedAt: string;
}
export interface FulfillmentProvider extends WebhookVerifier<FulfillmentSnapshot> {
  readonly id: string;
  dispatch(context: ExtensionContext, input: Readonly<{
    order: ImmutableOrderReference;
    items: readonly Readonly<Pick<OrderItem, 'productId' | 'quantity'>>[];
    destination: DeliveryAddress;
    /** Server-persisted carrier quote/service selection, including price approval before payment. */
    quote: TenantResourceReference;
  }>): Promise<AsyncProviderResult<FulfillmentSnapshot>>;
  status(context: ExtensionContext, reference: ProviderResourceReference): Promise<FulfillmentSnapshot>;
  /** Optional only when supported by the carrier. Never assume a dispatched parcel is cancellable. */
  cancel?(context: ExtensionContext, reference: ProviderResourceReference): Promise<AsyncProviderResult<FulfillmentSnapshot>>;
}

export interface EntitlementSnapshot {
  readonly reference: TenantResourceReference;
  readonly subject: TenantResourceReference;
  readonly resource: TenantResourceReference;
  readonly state: 'active' | 'revoked' | 'expired';
  readonly validUntil: string | null;
}
export interface EntitlementProvider {
  readonly id: string;
  grant(context: ExtensionContext, input: Readonly<{
    subject: TenantResourceReference; resource: TenantResourceReference;
    /** Validated payment/subscription/manual approval binding, loaded by the orchestrating service. */
    source: TenantResourceReference; validUntil: string | null;
  }>): Promise<AsyncProviderResult<EntitlementSnapshot>>;
  revoke(context: ExtensionContext, reference: TenantResourceReference,
    reason: 'refund' | 'subscription_ended' | 'administrative'): Promise<AsyncProviderResult<EntitlementSnapshot>>;
  get(context: ExtensionContext, reference: TenantResourceReference): Promise<EntitlementSnapshot>;
}

export interface SubscriptionSnapshot {
  readonly reference: ProviderResourceReference;
  readonly subject: TenantResourceReference;
  readonly plan: TenantResourceReference;
  readonly status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'paused' | 'unpaid' | 'cancelled' | 'expired' | 'unknown';
  readonly currentPeriodEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly observedAt: string;
}
export interface SubscriptionProvider extends WebhookVerifier<SubscriptionSnapshot> {
  readonly id: string;
  createCheckout(context: ExtensionContext, input: Readonly<{
    subject: TenantResourceReference; plan: TenantResourceReference;
    /** Server-selected allowlisted origins. The browser never selects a price or provider customer. */
    successUrl: string; cancelUrl: string;
  }>): Promise<Readonly<{ session: ProviderResourceReference; url: string; expiresAt: string }>>;
  status(context: ExtensionContext, reference: ProviderResourceReference): Promise<SubscriptionSnapshot>;
  cancel(context: ExtensionContext, reference: ProviderResourceReference,
    when: 'immediately' | 'period_end'): Promise<AsyncProviderResult<SubscriptionSnapshot>>;
}

/** Persist with the business change, not after commit. Contains references, not tokens/scopes/PII. */
export interface DurableEffectIntent {
  readonly id: string;
  readonly tenantId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly kind: 'fulfillment.dispatch' | 'entitlement.grant' | 'entitlement.revoke' | 'subscription.reconcile';
  readonly resource: TenantResourceReference;
  readonly availableAt: string;
}
export interface OutboxWriter<TTransaction> {
  append(transaction: TTransaction, intent: DurableEffectIntent): Promise<void>;
}
/** Contract for a future durable queue adapter; there is no table, queue or worker implementation. */
export interface DurableJobLease {
  readonly intent: DurableEffectIntent;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
}
