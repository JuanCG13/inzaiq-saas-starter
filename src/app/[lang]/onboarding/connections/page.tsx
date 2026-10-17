'use client';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { templateConfig } from '@/template.config';
import { LocaleLink } from '@/i18n/link';
import { useLocalePath, useT } from '@/i18n/provider';
import { LocaleSwitcher } from '@/i18n/switcher';
// An empty name means the client did not publish one; the default label is worded at render time.
type Connection = { id: string; name: string; scopes: string[] };
export default function ConnectionsPage() {
  const t = useT('auth');
  const localePath = useLocalePath();
  const [items, setItems] = useState<Connection[]>([]); const [tenantId, setTenantId] = useState('');
  // Kept as a kind and worded at render time, so the loading effect never depends on the translator.
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [failure, setFailure] = useState<'load' | 'disconnect' | null>(null);
  useEffect(() => { void (async () => {
    try {
      const session = await authClient.getSession();
      const active = session.data?.session.activeOrganizationId;
      if (!active) { window.location.assign(localePath('/sign-in')); return; }
      setTenantId(active);
      const consents = await authClient.oauth2.getConsents();
      if (consents.error) throw new Error('load');
      const scoped = (consents.data ?? []).filter(consent => consent.referenceId === active).slice(0, 100);
      setItems(await Promise.all(scoped.map(async consent => {
        const client = await authClient.oauth2.publicClient({ query: { client_id: consent.clientId } });
        return { id: consent.id, name: client.data?.client_name || '', scopes: [...consent.scopes] };
      })));
    } catch { setFailure('load'); } finally { setLoading(false); }
  })(); }, [localePath]);
  async function disconnect(id: string) {
    setBusy(id); setFailure(null);
    try {
      const result = await authClient.oauth2.deleteConsent({ id });
      if (result.error) throw new Error('revoke');
      setItems(current => current.filter(item => item.id !== id));
    } catch { setFailure('disconnect'); } finally { setBusy(''); }
  }
  return <>
    <div style={switcherCorner}><LocaleSwitcher /></div>
    <main id="main-content" style={{ maxWidth: 760, margin: '60px auto', padding: 24 }}><LocaleLink href={templateConfig.kind === 'pos' ? '/' : '/admin'}>{t('connections.back')}</LocaleLink><p style={{ marginTop: 40, color: '#6e6e73' }}>{t('connections.eyebrow')}</p><h1 style={{ fontSize: 38 }}>{t('connections.title')}</h1><p style={{ color: '#6e6e73', lineHeight: 1.6 }}>{t('connections.intro')}</p>{loading && <p role="status">{t('connections.loading')}</p>}{failure && <p role="alert" style={{ color: '#b42318' }}>{t(failure === 'load' ? 'connections.errors.load' : 'connections.errors.disconnect')}</p>}<div style={{ display: 'grid', gap: 16, margin: '28px 0' }}>{items.map(item => <article key={item.id} style={{ border: '1px solid #e5e5e7', borderRadius: 20, padding: 24 }}><h2>{item.name || t('connections.defaultAgent')}</h2><p style={{ color: '#6e6e73', overflowWrap: 'anywhere' }}>{item.scopes.join(' · ')}</p><button onClick={() => void disconnect(item.id)} disabled={!!busy} style={{ background: '#fff1f0', color: '#b42318', padding: '10px 18px', border: 0, borderRadius: 10 }}>{busy === item.id ? t('connections.disconnecting') : t('connections.disconnect')}</button></article>)}</div>{!loading && !items.length && !failure && <p>{t('connections.empty')}</p>}
      <section style={{ marginTop: 40, padding: 24, background: '#f5f5f7', borderRadius: 20 }}><h2 style={{ fontSize: 20 }}>{t('connections.details.title')}</h2><p>{t('connections.details.mcpUrl')} <code style={{ overflowWrap: 'anywhere' }}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp</code></p><p>{t('connections.details.tenantId')} <code style={{ overflowWrap: 'anywhere' }}>{tenantId || '—'}</code></p><p style={{ color: '#6e6e73' }}>{t('connections.details.hint')}</p></section>
    </main>
  </>;
}
// Logical offsets keep the switcher in the top corner of the reading direction for right-to-left languages.
const switcherCorner = { position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 } as const;
