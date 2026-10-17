import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { ConsentForm } from './consent-form';
export const dynamic = 'force-dynamic';
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item)); else if (value !== undefined) params.append(key, value);
  }
  const auth = getAuth();
  const { secret } = await auth.$context;
  const valid = await verifyOAuthQueryParams(params.toString(), secret);
  const requestHeaders = await headers();
  const session = valid ? await auth.api.getSession({ headers: requestHeaders }) : null;
  if (!valid || !session?.session.activeOrganizationId || !params.get('client_id')) return <main id="main-content" style={{ padding: 48 }}><h1>La solicitud no es válida.</h1><p>Iniciá de nuevo la conexión desde tu agente.</p></main>;
  const [client, org] = await Promise.all([
    auth.api.getOAuthClientPublic({ query: { client_id: params.get('client_id')! }, headers: requestHeaders }),
    auth.api.getFullOrganization({ query: { organizationId: session.session.activeOrganizationId }, headers: requestHeaders }),
  ]);
  return <ConsentForm clientName={client.client_name || 'Aplicación externa'} organizationName={org?.name || 'Tu negocio'} scopes={(params.get('scope') || '').split(' ').filter(Boolean)} />;
}
