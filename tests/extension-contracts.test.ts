import { expect, it } from 'vitest';
import type { Actor } from '../src/core/contracts';
import { createExtensionContext, createIntegerMoney, createOrderReference, integerMoneySchema } from '../src/extensions/contracts';
import { withOperation, withTelemetrySink } from '../src/lib/telemetry';

const actor: Actor = { userId: 'user-a', tenantId: 'tenant-a', role: 'owner', scopes: ['orders:read'] };
const identifiers = { operationId: 'operation-a', idempotencyKey: 'fulfillment:order-a:1', requestId: 'request-a' };
const order = { id: 'order-a', tenantId: actor.tenantId, totalMinor: 2500, currency: 'USD' };

it('preserves integer minor units for USD and zero-decimal PYG without conversion', () => {
  expect(createIntegerMoney({ amountMinor: 2500, currency: 'USD' })).toEqual({ amountMinor: 2500, currency: 'USD' });
  expect(createIntegerMoney({ amountMinor: 2500, currency: 'PYG' })).toEqual({ amountMinor: 2500, currency: 'PYG' });
  expect(createIntegerMoney({ amountMinor: Number.MAX_SAFE_INTEGER, currency: 'USD' }).amountMinor).toBe(Number.MAX_SAFE_INTEGER);
  expect(Object.isFrozen(createIntegerMoney({ amountMinor: 0, currency: 'USD' }))).toBe(true);
});

it('rejects unsafe money, coercion, unknown fields and invalid currency', () => {
  for (const amountMinor of [-1, 1.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2500', null]) {
    expect(() => createIntegerMoney({ amountMinor, currency: 'USD' })).toThrow(expect.objectContaining({ code: 'EXTENSION_INPUT_INVALID' }));
  }
  expect(integerMoneySchema.safeParse({ amountMinor: 1, currency: 'usd' }).success).toBe(false);
  expect(integerMoneySchema.safeParse({ amountMinor: 1, currency: 'USD', exchangeRate: 1 }).success).toBe(false);
});

it('copies and freezes the actor, preserving absent versus empty OAuth scopes', () => {
  const original: Actor = { ...actor, scopes: ['orders:read'] };
  const context = createExtensionContext(original, identifiers);
  original.tenantId = 'tenant-b'; original.scopes!.push('orders:write');
  expect(context.actor.tenantId).toBe('tenant-a');
  expect(context.actor.scopes).toEqual(['orders:read']);
  expect(Object.isFrozen(context)).toBe(true);
  expect(Object.isFrozen(context.actor)).toBe(true);
  expect(Object.isFrozen(context.actor.scopes)).toBe(true);
  expect(createExtensionContext({ ...actor, scopes: [] }, identifiers).actor.scopes).toEqual([]);
  expect(createExtensionContext({ userId: actor.userId, tenantId: actor.tenantId, role: 'viewer' }, identifiers).actor.scopes).toBeUndefined();
});

it('rejects malformed actors and unbounded/injected identifiers without exposing values', () => {
  const invalid = [null, { ...actor, tenantId: '' }, { ...actor, role: 'root' }, { ...actor, token: 'PRIVATE_TOKEN' }, { ...actor, scopes: ['unsafe\nvalue'] }];
  for (const value of invalid) expect(() => createExtensionContext(value as never, identifiers)).toThrow(expect.objectContaining({ code: 'EXTENSION_INPUT_INVALID' }));
  for (const value of ['', 'key\nINJECT', 'a'.repeat(256)]) expect(() => createExtensionContext(actor, { ...identifiers, idempotencyKey: value })).toThrow(expect.objectContaining({ code: 'EXTENSION_INPUT_INVALID' }));
  expect(() => createExtensionContext(actor, { ...identifiers, authorization: 'PRIVATE_TOKEN' } as never)).toThrow('Invalid extension contract input.');
});

it('rejects a reference to an order owned by another tenant', () => {
  const context = createExtensionContext(actor, identifiers);
  expect(() => createOrderReference(context, { ...order, tenantId: 'tenant-b' })).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
});

it('snapshots only immutable commercial references without customer or mutable order state', () => {
  const context = createExtensionContext(actor, identifiers);
  const source = { ...order, status: 'pending', customer: { name: 'PRIVATE_CUSTOMER', email: 'private@example.test' } };
  const reference = createOrderReference(context, source);
  source.totalMinor = 9999; source.currency = 'EUR'; source.status = 'completed';
  expect(reference).toEqual({ tenantId: actor.tenantId, orderId: order.id, total: { amountMinor: 2500, currency: 'USD' } });
  expect(Object.isFrozen(reference)).toBe(true);
  expect(Object.isFrozen(reference.total)).toBe(true);
  expect(JSON.stringify(reference)).not.toContain('PRIVATE_CUSTOMER');
  expect(JSON.stringify(reference)).not.toContain('status');
});

it('rejects malformed server order amounts rather than carrying them to a provider', () => {
  const context = createExtensionContext(actor, identifiers);
  expect(() => createOrderReference(context, { ...order, totalMinor: 0.01 })).toThrow(expect.objectContaining({ code: 'EXTENSION_INPUT_INVALID' }));
  expect(() => createOrderReference(context, { ...order, id: 'bad\nid' })).toThrow(expect.objectContaining({ code: 'EXTENSION_INPUT_INVALID' }));
});

it('allows owning telemetry boundary to correlate success/rejection without logging contract data', async () => {
  const records: Record<string, unknown>[] = [];
  await withTelemetrySink(record => records.push(record), async () => {
    await withOperation('commerce.extension.reference', { requestId: 'request-reference' }, async () => createOrderReference(createExtensionContext(actor, identifiers), order));
    await expect(withOperation('commerce.extension.reference', { requestId: 'request-reference' }, async () => createOrderReference(createExtensionContext(actor, identifiers), { ...order, tenantId: 'SECRET_FOREIGN_TENANT' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ 'event.name': 'commerce.extension.reference.completed', 'event.outcome': 'success', 'request.id': 'request-reference' });
  expect(records[1]).toMatchObject({ 'event.outcome': 'rejected', 'error.code': 'FORBIDDEN', duration_ms: expect.any(Number) });
  for (const value of [actor.userId, actor.tenantId, identifiers.idempotencyKey, 'SECRET_FOREIGN_TENANT']) expect(JSON.stringify(records)).not.toContain(value);
  await withTelemetrySink(() => { throw new Error('Sink unavailable'); }, () => withOperation('commerce.extension.reference', {}, async () => createIntegerMoney({ amountMinor: 1, currency: 'USD' })));
});
