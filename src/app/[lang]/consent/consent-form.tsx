'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/i18n/provider';
import { LocaleSwitcher } from '@/i18n/switcher';
// Logical offsets keep the switcher in the top corner of the reading direction for right-to-left languages.
const switcherCorner = { position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 } as const;
export function ConsentForm({ clientName, organizationName, scopes }: { clientName: string; organizationName: string; scopes: string[] }) {
  const t = useT('auth');
  const [selected, setSelected] = useState(scopes.filter(scope => !scope.endsWith(':write')));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // Scope identifiers come from the OAuth request; one without a translation is shown as its raw identifier.
  const scopeLabel = (scope: string) => { const key = `consent.scopes.${scope}`; return t.has(key) ? t(key as never) : scope; };
  async function submit(accept: boolean) {
    setBusy(true); setError('');
    try {
      const result = await authClient.oauth2.consent({ accept, scope: selected.join(' ') });
      if (result.error || !result.data?.url) throw new Error('consent');
      window.location.assign(result.data.url);
    } catch { setError(t('consent.errors.failed')); } finally { setBusy(false); }
  }
  return <>
    <div style={switcherCorner}><LocaleSwitcher /></div>
    <main id="main-content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f5f7' }}><section style={{ width: '100%', maxWidth: 540, borderRadius: 28, background: 'white', padding: 36 }}><p style={{ color: '#6e6e73' }}>{t('consent.eyebrow')}</p><h1 style={{ fontSize: 30 }}>{t('consent.title', { client: clientName, organization: organizationName })}</h1><p style={{ lineHeight: 1.6, color: '#6e6e73' }}>{t('consent.intro')}</p><div style={{ display: 'grid', gap: 16, margin: '28px 0' }}>{scopes.map(scope => <label key={scope} style={{ display: 'flex', gap: 12, alignItems: 'start' }}><input type="checkbox" checked={selected.includes(scope)} onChange={event => setSelected(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))} /><span>{scopeLabel(scope)}</span></label>)}</div>{error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}<div style={{ display: 'flex', gap: 12 }}><button disabled={busy} onClick={() => void submit(false)} style={{ flex: 1, border: 0, padding: 14, borderRadius: 12 }}>{t('consent.cancel')}</button><button disabled={busy || !selected.length} onClick={() => void submit(true)} style={{ flex: 1, background: '#0071e3', color: 'white', border: 0, padding: 14, borderRadius: 12 }}>{busy ? t('consent.busy') : t('consent.allow')}</button></div></section></main>
  </>;
}
