import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { getAuth } from '@/lib/auth';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { getTranslator } from '@/i18n/messages';
import { isEnabledLocale } from '@/i18n/runtime';
import { LocaleSwitcher } from '@/i18n/switcher';
import { ConsentForm } from './consent-form';
export const dynamic = 'force-dynamic';
// Logical offsets keep the switcher in the top corner of the reading direction for right-to-left languages.
const switcherCorner = { position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 } as const;
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await lang();
  if (!isEnabledLocale(locale)) notFound();
  const t = await getTranslator(locale, 'auth');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item)); else if (value !== undefined) params.append(key, value);
  }
  const auth = getAuth();
  const { secret } = await auth.$context;
  const valid = await verifyOAuthQueryParams(params.toString(), secret);
  const requestHeaders = await headers();
  const session = valid ? await auth.api.getSession({ headers: requestHeaders }) : null;
  if (!valid || !session?.session.activeOrganizationId || !params.get('client_id')) return <>
    <div style={switcherCorner}><LocaleSwitcher /></div>
    <main id="main-content" style={{ padding: 48 }}><h1>{t('consent.invalid.title')}</h1><p>{t('consent.invalid.body')}</p></main>
  </>;
  const [client, org] = await Promise.all([
    auth.api.getOAuthClientPublic({ query: { client_id: params.get('client_id')! }, headers: requestHeaders }),
    auth.api.getFullOrganization({ query: { organizationId: session.session.activeOrganizationId }, headers: requestHeaders }),
  ]);
  return <ConsentForm clientName={client.client_name || t('consent.defaultClient')} organizationName={org?.name || t('consent.defaultOrganization')} scopes={(params.get('scope') || '').split(' ').filter(Boolean)} />;
}
