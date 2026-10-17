import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import { AppError, type Actor, type DomainEvent, type ServiceOptions } from '../core/contracts';
import type { Database } from '../db/schema';
import type { RuntimeSettings, UpdateRuntimeSettings } from './contracts';

const MAX_VERSION = 2_147_483_647;

function authorize(actor: Actor, scope: string, adminOnly = false) {
  if (!actor?.userId || !actor?.tenantId) throw new AppError('UNAUTHENTICATED', 'Sign in and select an organization.', 401);
  const admin = actor.role === 'owner' || actor.role === 'admin';
  const allowed = admin || (!adminOnly && (actor.role === 'cashier' || (actor.role === 'viewer' && scope === 'products:read')));
  if (!allowed || (actor.scopes !== undefined && !actor.scopes.includes(scope))) throw new AppError('FORBIDDEN', 'You do not have permission for this operation.', 403);
}

function validate(input: unknown): UpdateRuntimeSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_INPUT', 'Review the settings.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['version', 'acceptingOrders', 'notice'].includes(key))
    || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0 || value.version >= MAX_VERSION
    || typeof value.acceptingOrders !== 'boolean' || typeof value.notice !== 'string' || value.notice.length > 200
    || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value.notice)) {
    throw new AppError('INVALID_INPUT', 'Review the version, the status and the notice (up to 200 characters).');
  }
  return { version: value.version, acceptingOrders: value.acceptingOrders, notice: value.notice.trim() };
}

function settings(row?: { version: number; accepting_orders: number; notice: string }): RuntimeSettings {
  return row ? { version: row.version, acceptingOrders: row.accepting_orders === 1, notice: row.notice }
    : { version: 0, acceptingOrders: true, notice: '' };
}

/** Narrow tenant-scoped runtime configuration. No code, money, secrets or arbitrary flags. */
export function createRuntimeSettingsService(db: Kysely<Database>, options: ServiceOptions = {}) {
  async function operation<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    let outcome: DomainEvent['outcome'] = 'success';
    let errorCode: string | undefined;
    try { return await fn(); }
    catch (error) {
      outcome = error instanceof AppError && error.status < 500 ? 'rejected' : 'failure';
      errorCode = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      throw error;
    } finally {
      try { options.telemetry?.({ name: 'commerce.operation.completed', schemaVersion: 1, operation: name, outcome, durationMs: performance.now() - start, ...(errorCode ? { errorCode } : {}) }); }
      catch { /* Diagnostic export must not affect an audited settings mutation. */ }
    }
  }

  async function read(tenantId: string) {
    return settings(await db.selectFrom('commerce_runtime_settings').select(['version', 'accepting_orders', 'notice']).where('tenant_id', '=', tenantId).executeTakeFirst());
  }

  return {
    getSettings(actor: Actor): Promise<RuntimeSettings> {
      return operation('settings.read', async () => { authorize(actor, 'settings:read', true); return read(actor.tenantId); });
    },
    getOperationalSettings(actor: Actor): Promise<RuntimeSettings> {
      return operation('settings.operational.read', async () => { authorize(actor, 'products:read'); return read(actor.tenantId); });
    },
    assertAcceptingOrders(actor: Actor): Promise<void> {
      return operation('settings.orders.check', async () => {
        authorize(actor, 'orders:write');
        if (!(await read(actor.tenantId)).acceptingOrders) throw new AppError('ORDERS_PAUSED', 'New orders are paused. Try again later.', 409);
      });
    },
    updateSettings(actor: Actor, input: UpdateRuntimeSettings): Promise<RuntimeSettings> {
      return operation('settings.update', async () => {
        authorize(actor, 'settings:write', true);
        const next = validate(input);
        return db.transaction().execute(async trx => {
          const values = { version: next.version + 1, accepting_orders: next.acceptingOrders ? 1 : 0, notice: next.notice, updated_at: new Date().toISOString() };
          const row = next.version === 0
            ? await trx.insertInto('commerce_runtime_settings').values({ tenant_id: actor.tenantId, ...values }).onConflict(oc => oc.column('tenant_id').doNothing()).returning(['version', 'accepting_orders', 'notice']).executeTakeFirst()
            : await trx.updateTable('commerce_runtime_settings').set(values).where('tenant_id', '=', actor.tenantId).where('version', '=', next.version).returning(['version', 'accepting_orders', 'notice']).executeTakeFirst();
          if (!row) throw new AppError('VERSION_CONFLICT', 'The settings changed. Reload and review the values before saving.', 409);
          await trx.insertInto('commerce_audit').values({
            id: randomUUID(), tenant_id: actor.tenantId, actor_id: actor.userId, action: 'settings.updated', resource_id: actor.tenantId,
            details_json: JSON.stringify({ previousVersion: next.version, version: row.version, acceptingOrders: next.acceptingOrders, noticePresent: Boolean(next.notice) }),
            created_at: values.updated_at,
          }).execute();
          return settings(row);
        });
      });
    },
  };
}

export type RuntimeSettingsService = ReturnType<typeof createRuntimeSettingsService>;
