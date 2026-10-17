'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { templateConfig } from '@/template.config';
import { authClient } from '@/lib/auth-client';
import { useLocalePath, useT } from '@/i18n/provider';
import { LocaleSwitcher } from '@/i18n/switcher';
export default function OnboardingPage() {
  const t = useT('auth');
  const localePath = useLocalePath();
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void authClient.organization.list().then(({ data, error }) => { if (error) window.location.assign(localePath('/sign-in') + window.location.search); else setOrganizations(data ?? []); }); }, [localePath]);
  async function select(organizationId: string) {
    setBusy(true); setError('');
    try {
      const result = await authClient.organization.setActive({ organizationId });
      if (result.error) throw new Error('selection');
      if (new URLSearchParams(window.location.search).has('client_id')) {
        const next = await authClient.oauth2.continue({ postLogin: true });
        if (next.error) throw new Error('authorization');
        const url = (next.data as { url?: string; redirectTo?: string } | null)?.url || (next.data as { redirectTo?: string } | null)?.redirectTo;
        if (url) { window.location.assign(url); return; }
        throw new Error('continuation');
      }
      window.location.assign(localePath(templateConfig.kind === 'pos' ? '/' : '/admin'));
    } catch { setError(t('onboarding.errors.open')); } finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await authClient.organization.create({ name: String(data.get('name')), slug: String(data.get('slug')) });
      if (result.error || !result.data) throw new Error('create');
      await select(result.data.id);
    } catch { setError(t('onboarding.errors.create')); } finally { setBusy(false); }
  }
  return <>
    <div style={switcherCorner}><LocaleSwitcher /></div>
    <main id="main-content" style={{ minHeight: '100vh', background: '#f5f5f7', display: 'grid', placeItems: 'center', padding: 24 }}><section style={{ maxWidth: 500, width: '100%', background: 'white', padding: 36, borderRadius: 28 }}>
      <p style={{ color: '#6e6e73' }}>{t('onboarding.eyebrow')}</p><h1 style={{ fontSize: 32 }}>{t('onboarding.title')}</h1><p style={{ color: '#6e6e73', lineHeight: 1.5 }}>{t('onboarding.intro')}</p>
      <div style={{ display: 'grid', gap: 10, margin: '24px 0' }}>{organizations.map(org => <button key={org.id} disabled={busy} onClick={() => void select(org.id)} style={{ padding: 16, textAlign: 'left', background: '#f5f5f7', border: 0, borderRadius: 12 }}>{t('onboarding.organization', { name: org.name })}</button>)}</div>
      <form onSubmit={create} style={{ display: 'grid', gap: 14 }}><h2 style={{ fontSize: 20 }}>{t('onboarding.create.title')}</h2><label>{t('onboarding.create.name')}<input name="name" required maxLength={100} style={field} /></label><label>{t('onboarding.create.slug')}<input name="slug" required pattern="[a-z0-9\-]{3,60}" placeholder={t('onboarding.create.slugPlaceholder')} style={field} /></label><button disabled={busy} style={{ background: '#0071e3', color: 'white', border: 0, borderRadius: 12, padding: 15 }}>{busy ? t('onboarding.create.busy') : t('onboarding.create.submit')}</button></form>{error && <p role="alert" style={{ color: '#b42318', marginTop: 18 }}>{error}</p>}
    </section></main>
  </>;
}
// Logical offsets keep the switcher in the top corner of the reading direction for right-to-left languages.
const switcherCorner = { position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 } as const;
const field = { width: '100%', display: 'block', padding: 12, borderRadius: 10, marginTop: 8, border: '1px solid #d2d2d7', fontSize: 16 };
