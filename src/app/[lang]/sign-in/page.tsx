'use client';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { LocaleLink } from '@/i18n/link';
import { useLocalePath, useT } from '@/i18n/provider';
import { LocaleSwitcher } from '@/i18n/switcher';
// Mirrored in the signIn.passwordHint message; change both together.
const PASSWORD_MIN_LENGTH = 12;
export default function SignInPage() {
  const t = useT('auth');
  const localePath = useLocalePath();
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const fields = { email: String(data.get('email')), password: String(data.get('password')), callbackURL: localePath('/onboarding') };
      const result = create ? await authClient.signUp.email({ ...fields, name: String(data.get('name')) }) : await authClient.signIn.email(fields);
      if (result.error) { setError(t('signIn.errors.rejected')); return; }
      // OAuth provider owns signed continuations; normal application sign-in enters onboarding.
      const next = result.data as { url?: string; redirect?: boolean } | null;
      if (next?.url && next.redirect) window.location.assign(next.url);
      else window.location.assign(localePath('/onboarding') + window.location.search);
    } catch { setError(t('signIn.errors.network')); } finally { setBusy(false); }
  }
  return <>
    <div style={switcherCorner}><LocaleSwitcher /></div>
    <main id="main-content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f5f7' }}><section style={{ width: '100%', maxWidth: 440, background: 'white', borderRadius: 28, padding: 36, boxShadow: '0 12px 50px #00000008' }}>
      <LocaleLink href="/" style={{ fontSize: 14 }}>{t('signIn.back')}</LocaleLink><p style={{ marginTop: 32, color: '#6e6e73', fontSize: 13 }}>{t('signIn.eyebrow')}</p><h1 style={{ fontSize: 34, margin: '12px 0' }}>{create ? t('signIn.title.create') : t('signIn.title.signIn')}</h1><p style={{ color: '#6e6e73', lineHeight: 1.6 }}>{t('signIn.intro')}</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 18, marginTop: 26 }}>
        {create && <label>{t('signIn.fields.name')}<input name="name" autoComplete="name" required maxLength={100} style={inputStyle} /></label>}
        <label>{t('signIn.fields.email')}<input type="email" name="email" autoComplete="email" required style={inputStyle} /></label>
        <label>{t('signIn.fields.password')}<input type="password" name="password" autoComplete={create ? 'new-password' : 'current-password'} minLength={PASSWORD_MIN_LENGTH} required style={inputStyle} /></label>
        {create && <small style={{ color: '#6e6e73' }}>{t('signIn.passwordHint')}</small>}
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        <button disabled={busy} style={buttonStyle}>{busy ? t('signIn.submit.busy') : create ? t('signIn.submit.create') : t('signIn.submit.signIn')}</button>
      </form><button type="button" onClick={() => setCreate(!create)} style={{ border: 0, background: 'none', color: '#0066cc', padding: '20px 0 0' }}>{create ? t('signIn.toggle.toSignIn') : t('signIn.toggle.toCreate')}</button>
    </section></main>
  </>;
}
// Logical offsets keep the switcher in the top corner of the reading direction for right-to-left languages.
const switcherCorner = { position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 } as const;
const inputStyle = { display: 'block', width: '100%', marginTop: 8, padding: 13, border: '1px solid #d2d2d7', borderRadius: 12, fontSize: 16 };
const buttonStyle = { border: 0, borderRadius: 12, background: '#0071e3', color: 'white', padding: 15, fontSize: 16, cursor: 'pointer' };
