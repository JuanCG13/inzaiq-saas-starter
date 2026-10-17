import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import type { Actor, DomainEvent } from '../src/core/contracts';
import { createRuntimeSettingsService } from '../src/runtime/service';
import { emitEvent, withOperation, withTelemetrySink } from '../src/lib/telemetry';

const owner: Actor = { userId: 'private-user-a', tenantId: 'tenant-a', role: 'owner' };
const other: Actor = { userId: 'private-user-b', tenantId: 'tenant-b', role: 'owner' };
const defaults = { version: 0, acceptingOrders: true, notice: '' };
const update = { ...defaults, acceptingOrders: false, notice: 'PRIVATE_NOTICE_NO_DIAGNOSTICS' };

describe.each(['sqlite', 'postgres'] as const)('runtime settings on real %s engine', provider => {
  let db: Kysely<Database>;
  let directory: string;
  let events: DomainEvent[];
  let service: ReturnType<typeof createRuntimeSettingsService>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'runtime-settings-'));
    db = provider === 'sqlite'
      ? createDatabase({ provider: 'sqlite', url: `file:${join(directory, 'settings.db')}` })
      : new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
    await migrateDatabase(db, { provider });
    events = [];
    service = createRuntimeSettingsService(db, { telemetry: event => events.push(event) });
  });
  afterEach(async () => { await db.destroy(); await rm(directory, { recursive: true, force: true }); });

  it('migrates idempotently and defaults without mutating on a read', async () => {
    await migrateDatabase(db, { provider });
    expect(await service.getSettings(owner)).toEqual(defaults);
    expect(await db.selectFrom('commerce_runtime_settings').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('commerce_audit').selectAll().execute()).toEqual([]);
  });

  it('isolates tenants, persists across service instances and protects every version', async () => {
    const first = await service.updateSettings(owner, update);
    expect(first).toEqual({ ...update, version: 1 });
    expect(await createRuntimeSettingsService(db).getSettings(owner)).toEqual(first);
    expect(await service.getSettings(other)).toEqual(defaults);
    await expect(service.updateSettings(owner, update)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(service.updateSettings(other, { ...update, version: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const second = await service.updateSettings(owner, { version: 1, acceptingOrders: true, notice: '' });
    expect(second.version).toBe(2);
    await expect(service.updateSettings(owner, { ...update, version: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await service.getSettings(owner)).toEqual(second);
    const audits = await db.selectFrom('commerce_audit').selectAll().execute();
    expect(audits).toHaveLength(2);
    expect(audits.every(audit => audit.action === 'settings.updated' && audit.tenant_id === owner.tenantId)).toBe(true);
    expect(JSON.parse(audits[0].details_json)).toEqual({ previousVersion: 0, version: 1, acceptingOrders: false, noticePresent: true });
    expect(JSON.stringify(audits)).not.toContain(update.notice);
  });

  it('requires admin role AND the explicit settings scope; operational read grants no write', async () => {
    for (const actor of [{ ...owner, role: 'cashier' as const }, { ...owner, role: 'viewer' as const }, { ...owner, scopes: [] }, { ...owner, scopes: ['products:read'] }]) {
      await expect(service.getSettings(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.updateSettings(actor, update)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(service.updateSettings({ ...owner, scopes: ['settings:read'] }, update)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getSettings({ ...owner, scopes: ['settings:write'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.getSettings({ ...owner, scopes: ['settings:read'] })).toEqual(defaults);
    await service.updateSettings({ ...owner, role: 'admin', scopes: ['settings:write'] }, update);
    expect((await service.getOperationalSettings({ ...owner, role: 'viewer', scopes: ['products:read'] })).acceptingOrders).toBe(false);
    await expect(service.getOperationalSettings({ ...owner, scopes: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getSettings({ ...owner, tenantId: '' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('admits one winner for two concurrent edits of the same version', async () => {
    const initial = await service.updateSettings(owner, update);
    const results = await Promise.allSettled([
      service.updateSettings(owner, { ...initial, notice: 'First proposed notice' }),
      service.updateSettings(owner, { ...initial, notice: 'Second proposed notice' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect((await service.getSettings(owner)).version).toBe(2);
    expect(await db.selectFrom('commerce_audit').selectAll().execute()).toHaveLength(2);
  });

  it('rejects unknown flags, invalid versions and oversized notice before writes', async () => {
    const bad = [null, [], 'bad', { ...update, secret: 'TOKEN' }, { ...update, version: -1 }, { ...update, version: 1.5 }, { ...update, version: 2147483647 }, { ...update, acceptingOrders: 'false' }, { ...update, notice: 'x'.repeat(201) }, { ...update, notice: 'bad\u0000notice' }];
    for (const input of bad) await expect(service.updateSettings(owner, input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await service.getSettings(owner)).toEqual(defaults);
    expect(await db.selectFrom('commerce_audit').selectAll().execute()).toEqual([]);
  });

  it('rolls initial insert and subsequent CAS back when audit persistence fails', async () => {
    const first = await service.updateSettings(owner, update);
    await db.schema.dropTable('commerce_audit').execute();
    await expect(service.updateSettings(owner, { ...first, notice: 'DO_NOT_COMMIT' })).rejects.toThrow();
    await expect(service.updateSettings(other, update)).rejects.toThrow();
    expect(await service.getSettings(owner)).toEqual(first);
    expect(await service.getSettings(other)).toEqual(defaults);
    expect(events.filter(event => event.operation === 'settings.update' && event.outcome === 'failure')).toHaveLength(2);
  });

  it('pauses new admissions only for that tenant and resumes explicitly', async () => {
    await service.assertAcceptingOrders(owner);
    const paused = await service.updateSettings(owner, update);
    await expect(service.assertAcceptingOrders(owner)).rejects.toMatchObject({ code: 'ORDERS_PAUSED', status: 409 });
    await expect(service.assertAcceptingOrders({ ...owner, role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.assertAcceptingOrders({ ...other, role: 'cashier', scopes: ['orders:write'] });
    await service.updateSettings(owner, { ...paused, acceptingOrders: true });
    await service.assertAcceptingOrders({ ...owner, role: 'cashier', scopes: ['orders:write'] });
  });

  it('enforces persisted constraints and PostgreSQL default-deny RLS', async () => {
    await expect(db.insertInto('commerce_runtime_settings').values({ tenant_id: owner.tenantId, version: 0, accepting_orders: 7, notice: '', updated_at: 'now' }).execute()).rejects.toThrow();
    if (provider === 'postgres') {
      const result = await sql<{ rls: boolean }>`select relrowsecurity as rls from pg_class where relname = 'commerce_runtime_settings'`.execute(db);
      expect(result.rows[0].rls).toBe(true);
      await service.updateSettings(owner, update);
      await sql`create role runtime_reader nologin`.execute(db);
      await sql`grant select on commerce_runtime_settings to runtime_reader`.execute(db);
      await sql`set role runtime_reader`.execute(db);
      try { expect(await db.selectFrom('commerce_runtime_settings').selectAll().execute()).toEqual([]); }
      finally { await sql`reset role`.execute(db); }
    }
  });

  it('records safe correlated outcomes and survives an unavailable telemetry sink', async () => {
    const records: Record<string, unknown>[] = [];
    const correlated = createRuntimeSettingsService(db, { telemetry: event => emitEvent(event.name, { operation: event.operation, 'event.outcome': event.outcome, 'error.code': event.errorCode, duration_ms: event.durationMs }) });
    await withTelemetrySink(record => records.push(record), () => withOperation('api.settings.update', { requestId: 'safe-request', route: '/api/admin/settings', method: 'PATCH' }, async () => {
      await correlated.updateSettings(owner, update);
      await expect(correlated.updateSettings(owner, update)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    }));
    const domain = records.filter(record => record['event.name'] === 'commerce.operation.completed');
    expect(domain).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'event.schema_version': 1, 'event.outcome': 'success', operation: 'settings.update', 'request.id': 'safe-request', duration_ms: expect.any(Number) }),
      expect.objectContaining({ 'event.outcome': 'rejected', 'error.code': 'VERSION_CONFLICT', 'request.id': 'safe-request' }),
    ]));
    for (const secret of [update.notice, owner.userId, owner.tenantId]) expect(JSON.stringify(records)).not.toContain(secret);
    const failingSink = createRuntimeSettingsService(db, { telemetry: () => { throw new Error('Exporter offline'); } });
    expect((await failingSink.updateSettings(other, update)).version).toBe(1);
  });
});
