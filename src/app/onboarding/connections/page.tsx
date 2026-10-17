'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { templateConfig } from '@/template.config';
type Connection = { id: string; name: string; scopes: string[] };
export default function ConnectionsPage() {
  const [items, setItems] = useState<Connection[]>([]); const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  useEffect(() => { void (async () => {
    try {
      const session = await authClient.getSession();
      const active = session.data?.session.activeOrganizationId;
      if (!active) { window.location.assign('/sign-in'); return; }
      setTenantId(active);
      const consents = await authClient.oauth2.getConsents();
      if (consents.error) throw new Error('load');
      const scoped = (consents.data ?? []).filter(consent => consent.referenceId === active).slice(0, 100);
      setItems(await Promise.all(scoped.map(async consent => {
        const client = await authClient.oauth2.publicClient({ query: { client_id: consent.clientId } });
        return { id: consent.id, name: client.data?.client_name || 'Agente conectado', scopes: [...consent.scopes] };
      })));
    } catch { setError('No pudimos cargar las conexiones. Recargá la página.'); } finally { setLoading(false); }
  })(); }, []);
  async function disconnect(id: string) {
    setBusy(id); setError('');
    try {
      const result = await authClient.oauth2.deleteConsent({ id });
      if (result.error) throw new Error('revoke');
      setItems(current => current.filter(item => item.id !== id));
    } catch { setError('No se pudo desconectar el agente. Intentá nuevamente.'); } finally { setBusy(''); }
  }
  return <main id="main-content" style={{ maxWidth: 760, margin: '60px auto', padding: 24 }}><Link href={templateConfig.kind === 'pos' ? '/' : '/admin'}>← Volver al negocio</Link><p style={{ marginTop: 40, color: '#6e6e73' }}>ACCESO Y PRIVACIDAD</p><h1 style={{ fontSize: 38 }}>Tus agentes conectados.</h1><p style={{ color: '#6e6e73', lineHeight: 1.6 }}>Estas aplicaciones tienen acceso a este negocio con tus permisos. Desconectarlas bloquea las nuevas solicitudes inmediatamente.</p>{loading && <p role="status">Cargando conexiones…</p>}{error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}<div style={{ display: 'grid', gap: 16, margin: '28px 0' }}>{items.map(item => <article key={item.id} style={{ border: '1px solid #e5e5e7', borderRadius: 20, padding: 24 }}><h2>{item.name}</h2><p style={{ color: '#6e6e73', overflowWrap: 'anywhere' }}>{item.scopes.join(' · ')}</p><button onClick={() => void disconnect(item.id)} disabled={!!busy} style={{ background: '#fff1f0', color: '#b42318', padding: '10px 18px', border: 0, borderRadius: 10 }}>{busy === item.id ? 'Desconectando…' : 'Desconectar agente'}</button></article>)}</div>{!loading && !items.length && !error && <p>No hay agentes conectados a este negocio.</p>}
    <section style={{ marginTop: 40, padding: 24, background: '#f5f5f7', borderRadius: 20 }}><h2 style={{ fontSize: 20 }}>Datos de conexión</h2><p>URL MCP: <code style={{ overflowWrap: 'anywhere' }}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp</code></p><p>Identificador del negocio: <code style={{ overflowWrap: 'anywhere' }}>{tenantId || '—'}</code></p><p style={{ color: '#6e6e73' }}>Tu implementador utiliza este identificador para configurar la tienda pública.</p></section>
  </main>;
}
