'use client';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
export default function SignInPage() {
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const fields = { email: String(data.get('email')), password: String(data.get('password')), callbackURL: '/onboarding' };
      const result = create ? await authClient.signUp.email({ ...fields, name: String(data.get('name')) }) : await authClient.signIn.email(fields);
      if (result.error) { setError('No se pudo acceder. Revisá tus datos e intentá de nuevo.'); return; }
      // OAuth provider owns signed continuations; normal application sign-in enters onboarding.
      const next = result.data as { url?: string; redirect?: boolean } | null;
      if (next?.url && next.redirect) window.location.assign(next.url);
      else window.location.assign('/onboarding' + window.location.search);
    } catch { setError('No hay conexión. Intentá nuevamente.'); } finally { setBusy(false); }
  }
  return <main id="main-content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f5f7' }}><section style={{ width: '100%', maxWidth: 440, background: 'white', borderRadius: 28, padding: 36, boxShadow: '0 12px 50px #00000008' }}>
    <Link href="/" style={{ fontSize: 14 }}>← Volver a la tienda</Link><p style={{ marginTop: 32, color: '#6e6e73', fontSize: 13 }}>TU ESPACIO DE TRABAJO</p><h1 style={{ fontSize: 34, margin: '12px 0' }}>{create ? 'Empezá con tu negocio.' : 'Todo, en un lugar.'}</h1><p style={{ color: '#6e6e73', lineHeight: 1.6 }}>Administrá productos, ventas y acceso de tus agentes.</p>
    <form onSubmit={submit} style={{ display: 'grid', gap: 18, marginTop: 26 }}>
      {create && <label>Tu nombre<input name="name" autoComplete="name" required maxLength={100} style={inputStyle} /></label>}
      <label>Email<input type="email" name="email" autoComplete="email" required style={inputStyle} /></label>
      <label>Contraseña<input type="password" name="password" autoComplete={create ? 'new-password' : 'current-password'} minLength={12} required style={inputStyle} /></label>
      {create && <small style={{ color: '#6e6e73' }}>Usá al menos 12 caracteres.</small>}
      {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
      <button disabled={busy} style={buttonStyle}>{busy ? 'Conectando…' : create ? 'Crear cuenta' : 'Entrar'}</button>
    </form><button type="button" onClick={() => setCreate(!create)} style={{ border: 0, background: 'none', color: '#0066cc', padding: '20px 0 0' }}>{create ? 'Ya tengo una cuenta' : 'Crear una cuenta'}</button>
  </section></main>;
}
const inputStyle = { display: 'block', width: '100%', marginTop: 8, padding: 13, border: '1px solid #d2d2d7', borderRadius: 12, fontSize: 16 };
const buttonStyle = { border: 0, borderRadius: 12, background: '#0071e3', color: 'white', padding: 15, fontSize: 16, cursor: 'pointer' };
