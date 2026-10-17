import { sql, type Kysely } from 'kysely';
import { getDatabase } from '@/db';
import { getAuth } from './auth';
import { AppError, type Actor, type Role } from '@/core/contracts';

const roles = new Set<Role>(['owner', 'admin', 'cashier', 'viewer']);
export async function membershipActor(userId: string, tenantId: string, scopes?: string[], db: Kysely<any> = getDatabase()): Promise<Actor> {
  if (!userId || !tenantId) throw new AppError('UNAUTHORIZED', 'Sign in and select an organization', 401);
  const result = await sql<{ role: string }>`select "role" from "member" where "userId" = ${userId} and "organizationId" = ${tenantId} limit 1`.execute(db);
  const role = result.rows[0]?.role as Role;
  if (!roles.has(role)) throw new AppError('FORBIDDEN', 'Organization access denied', 403);
  return { userId, tenantId, role, ...(scopes ? { scopes } : {}) };
}
export async function getSessionActor(headers: Headers): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers });
  if (!session?.session.activeOrganizationId) throw new AppError('UNAUTHORIZED', 'Sign in and select an organization', 401);
  return membershipActor(session.user.id, session.session.activeOrganizationId);
}
/** Call only after cryptographic JWT verification. Never accept tenant context from tool arguments. */
export async function actorFromVerifiedClaims(claims: Record<string, unknown>, db: Kysely<any> = getDatabase()): Promise<Actor> {
  if (typeof claims.sub !== 'string' || typeof claims.tenant_id !== 'string' || typeof claims.client_id !== 'string' || typeof claims.scope !== 'string') throw new AppError('UNAUTHORIZED', 'Invalid tenant-bound access token', 401);
  const scopes = claims.scope.split(' ').filter(Boolean);
  const actor = await membershipActor(claims.sub, claims.tenant_id, scopes, db);
  // JWT signatures survive consent revocation; check current consent for immediate disconnect.
  const consent = await sql<{ scopes: unknown }>`select "scopes" from "oauthConsent" where "userId" = ${actor.userId} and "clientId" = ${claims.client_id} and "referenceId" = ${actor.tenantId} limit 1`.execute(db);
  if (!consent.rows.length) throw new AppError('FORBIDDEN', 'Connection authorization revoked', 403);
  const raw = consent.rows[0].scopes;
  const granted = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : [];
  if (!Array.isArray(granted) || !scopes.every(scope => granted.includes(scope))) throw new AppError('FORBIDDEN', 'Connection permissions changed; reconnect', 403);
  return actor;
}
