import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { randomBytes, createHash } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { getSchema } from 'better-auth/db';
import type { Database } from '../src/db/schema';

// PostgreSQL engine in WASM: validates actual SQL/types/permissions, not a cloud connection.
let db: Kysely<Database>;
vi.mock('@/db', () => ({ getDatabase: () => db }));
let auth: ReturnType<typeof import('../src/lib/auth')['getAuth']>;
let getSessionActor: typeof import('../src/lib/actor')['getSessionActor'];
let actorFromVerifiedClaims: typeof import('../src/lib/actor')['actorFromVerifiedClaims'];
const origin = 'http://localhost:3000';
let cookie = '';
let userId = '';
let tenantId = '';
let tableNames: string[];
const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => new Request(origin + path, {
  method, headers: { origin, ...(authenticated ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PROVIDER', 'postgres');
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(32).toString('hex'));
  db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  auth = (await import('../src/lib/auth')).getAuth();
  ({ getSessionActor, actorFromVerifiedClaims } = await import('../src/lib/actor'));
  await auth.$context;
  const migration = await getMigrations(auth.options); await migration.runMigrations();
  tableNames = Object.keys(getSchema(auth.options));
  await sql`create role anon nologin`.execute(db);
  await sql`create role authenticated nologin`.execute(db);
  // Reproduce public-provider privileges before running the actual migration protection logic.
  for (const table of tableNames) {
    await sql`grant select on table ${sql.table(table)} to public, anon, authenticated`.execute(db);
    await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
    await sql`revoke all on table ${sql.table(table)} from public`.execute(db);
    for (const role of ['anon', 'authenticated']) await sql`revoke all on table ${sql.table(table)} from ${sql.id(role)}`.execute(db);
  }
}, 30000);
afterAll(async () => { await db?.destroy(); vi.unstubAllEnvs(); vi.resetModules(); });

test('real Better Auth migration creates every configured PostgreSQL auth table and is idempotent', async () => {
  expect(tableNames).toEqual(expect.arrayContaining(['user', 'session', 'account', 'member', 'organization', 'jwks', 'oauthClient', 'oauthConsent', 'oauthResource', 'rateLimit']));
  for (const table of tableNames) {
    const result = await sql<{ name: string | null }>`select to_regclass(${`public."${table}"`})::text as name`.execute(db);
    expect(result.rows[0].name).not.toBeNull();
  }
  const second = await getMigrations(auth.options);
  expect(second.toBeCreated).toHaveLength(0); expect(second.toBeAdded).toHaveLength(0);
  await second.runMigrations();
});

test('RLS is enabled on every auth table and API roles cannot read credentials', async () => {
  for (const table of tableNames) {
    const result = await sql<{ rls: boolean; anon_select: boolean; member_select: boolean }>`select c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select') as anon_select, has_table_privilege('authenticated', c.oid, 'select') as member_select from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relname=${table}`.execute(db);
    expect(result.rows[0]).toEqual({ rls: true, anon_select: false, member_select: false });
  }
  await sql`set role authenticated`.execute(db);
  try { await expect(sql`select * from "user"`.execute(db)).rejects.toThrow(/permission denied/i); }
  finally { await sql`reset role`.execute(db); }
});

test('signup, password login, organization membership and selected-session actor work with PostgreSQL', async () => {
  const signup = await auth.handler(request('/api/auth/sign-up/email', 'POST', { email: 'pg-owner@example.test', password: 'Test-password-123456789', name: 'Postgres Owner' }, false));
  expect(signup.status).toBe(200); userId = (await signup.json()).user.id;
  const login = await auth.handler(request('/api/auth/sign-in/email', 'POST', { email: 'pg-owner@example.test', password: 'Test-password-123456789' }, false));
  expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const created = await auth.handler(request('/api/auth/organization/create', 'POST', { name: 'Postgres business', slug: 'postgres-business' }));
  expect(created.status).toBe(200); tenantId = (await created.json()).id;
  const active = await auth.handler(request('/api/auth/organization/set-active', 'POST', { organizationId: tenantId }));
  expect(active.status).toBe(200);
  const session = await auth.handler(request('/api/auth/get-session'));
  expect(session.status).toBe(200); expect((await session.json()).session.activeOrganizationId).toBe(tenantId);
  expect(await getSessionActor(new Headers({ cookie }))).toMatchObject({ tenantId, userId, role: 'owner' });
});

test('PostgreSQL persists real OAuth clients, JWT keys, consent scopes and tenant-bound tokens', async () => {
  const scope = 'openid products:read';
  const registered = await auth.handler(request('/api/auth/oauth2/register', 'POST', { client_name: 'PG MCP Client', redirect_uris: ['http://localhost:3456/callback'], token_endpoint_auth_method: 'none', application_type: 'native', grant_types: ['authorization_code'], response_types: ['code'], scope }, false));
  expect(registered.status).toBe(201); const clientId = (await registered.json()).client_id;
  const verifier = randomBytes(48).toString('base64url');
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:3456/callback', response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/api/mcp', scope, state: 'pg-state' });
  const authorization = await auth.handler(request('/api/auth/oauth2/authorize?' + query));
  expect(authorization.status).toBe(302);
  const consentUrl = new URL(authorization.headers.get('location')!, origin);
  expect(consentUrl.pathname).toBe('/consent');
  const consent = await auth.handler(request('/api/auth/oauth2/consent', 'POST', { accept: true, scope, oauth_query: consentUrl.search.slice(1) }));
  expect(consent.status).toBe(200);
  const callback = new URL((await consent.json()).url);
  const response = await auth.handler(new Request(origin + '/api/auth/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code')!, redirect_uri: 'http://localhost:3456/callback', code_verifier: verifier, resource: origin + '/api/mcp' }) }));
  expect(response.status).toBe(200);
  const token = (await response.json()).access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  expect(claims.tenant_id).toBe(tenantId); expect(claims.sub).toBe(userId);
  expect(await actorFromVerifiedClaims(claims)).toMatchObject({ tenantId, userId, role: 'owner', scopes: ['openid', 'products:read'] });
  const list = await auth.handler(request('/api/auth/oauth2/get-consents'));
  const consentId = (await list.json()).find((entry: { clientId: string }) => entry.clientId === clientId).id;
  expect((await auth.handler(request('/api/auth/oauth2/delete-consent', 'POST', { id: consentId }))).status).toBe(200);
  await expect(actorFromVerifiedClaims(claims)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
