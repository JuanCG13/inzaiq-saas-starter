import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { jwt, organization } from 'better-auth/plugins';
import { ownerAc, adminAc, memberAc } from 'better-auth/plugins/organization/access';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { sql } from 'kysely';
import { getDatabase } from '@/db';
import { emitEvent } from './telemetry';

export const MCP_SCOPES = ['products:read', 'products:write', 'stock:write', 'orders:read', 'orders:write', 'dashboard:read', 'audit:read', 'settings:read', 'settings:write'] as const;

export function authOrigin() {
  const value = process.env.BETTER_AUTH_URL || process.env.APP_URL;
  if (!value && process.env.NODE_ENV === 'production') throw new Error('BETTER_AUTH_URL is required');
  const url = new URL(value || 'http://localhost:3000');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BETTER_AUTH_URL must be an origin');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.NODE_ENV !== 'production')) throw new Error('Authentication requires HTTPS');
  return url.origin;
}
export const mcpResource = () => `${authOrigin()}/api/mcp`;

async function hasMembership(userId: string, organizationId: unknown) {
  if (typeof organizationId !== 'string' || !organizationId) return false;
  const row = await sql<{ role: string }>`select "role" from "member" where "userId" = ${userId} and "organizationId" = ${organizationId} limit 1`.execute(getDatabase());
  return row.rows.some(member => ['owner', 'admin', 'cashier', 'viewer'].includes(member.role));
}

function buildAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  const baseURL = authOrigin();
  return betterAuth({
    appName: 'Commerce Workspace', baseURL, secret,
    logger: { log: (level, message, ..._args: unknown[]) => emitEvent('auth.provider.completed', {
      'event.outcome': level === 'error' ? 'failure' : level === 'warn' ? 'rejected' : 'success',
      'error.code': /schema/i.test(message) ? 'AUTH_SCHEMA_MISMATCH' : level === 'error' ? 'AUTH_PROVIDER_ERROR' : 'none',
      'feature.stage': 'provider',
    }) },
    database: { db: getDatabase(), type: ['turso', 'sqlite'].includes(process.env.DATABASE_PROVIDER ?? 'sqlite') ? 'sqlite' : 'postgres' },
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    trustedOrigins: [baseURL],
    disabledPaths: ['/token'],
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    plugins: [
      organization({ roles: { owner: ownerAc, admin: adminAc, cashier: memberAc, viewer: memberAc } }),
      jwt(),
      mcp({
        resource: mcpResource(), loginPage: '/sign-in', consentPage: '/consent',
        scopes: ['openid', 'profile', 'offline_access', ...MCP_SCOPES],
        accessTokenExpiresIn: 900,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        postLogin: {
          page: '/onboarding',
          shouldRedirect: async ({ user, session }) => !(await hasMembership(user.id, session.activeOrganizationId)),
          consentReferenceId: async ({ user, session }) => {
            if (!(await hasMembership(user.id, session.activeOrganizationId))) throw new APIError('FORBIDDEN', { message: 'Select an organization you belong to' });
            return session.activeOrganizationId as string;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user || !(await hasMembership(user.id, referenceId))) throw new APIError('FORBIDDEN', { message: 'Current organization membership required' });
          return { tenant_id: referenceId };
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}
let singleton: ReturnType<typeof buildAuth> | undefined;
/** Lazy: Next build must not need production credentials or a database connection. */
export function getAuth() { return singleton ??= buildAuth(); }
