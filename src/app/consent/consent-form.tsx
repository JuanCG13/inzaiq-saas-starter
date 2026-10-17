'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
const labels: Record<string, string> = { openid: 'Identificar tu cuenta', profile: 'Leer tu perfil básico', offline_access: 'Mantener la conexión cuando cierres esta ventana', 'products:read': 'Consultar productos', 'products:write': 'Crear y editar productos', 'stock:write': 'Ajustar inventario', 'orders:read': 'Consultar pedidos', 'orders:write': 'Registrar pedidos y ventas', 'dashboard:read': 'Consultar el resumen del negocio', 'audit:read': 'Consultar el registro de cambios', 'settings:read': 'Consultar la configuración del negocio', 'settings:write': 'Cambiar avisos y pausar o reanudar ventas' };
export function ConsentForm({ clientName, organizationName, scopes }: { clientName: string; organizationName: string; scopes: string[] }) {
  const [selected, setSelected] = useState(scopes.filter(scope => !scope.endsWith(':write')));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(accept: boolean) {
    setBusy(true); setError('');
    try {
      const result = await authClient.oauth2.consent({ accept, scope: selected.join(' ') });
      if (result.error || !result.data?.url) throw new Error('consent');
      window.location.assign(result.data.url);
    } catch { setError('No se pudo completar la conexión. Iniciala nuevamente desde tu agente.'); } finally { setBusy(false); }
  }
  return <main id="main-content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f5f7' }}><section style={{ width: '100%', maxWidth: 540, borderRadius: 28, background: 'white', padding: 36 }}><p style={{ color: '#6e6e73' }}>CONECTAR TU AGENTE</p><h1 style={{ fontSize: 30 }}>{clientName} quiere acceder a {organizationName}.</h1><p style={{ lineHeight: 1.6, color: '#6e6e73' }}>Elegí qué puede hacer. El acceso queda limitado a este negocio y a tus permisos actuales.</p><div style={{ display: 'grid', gap: 16, margin: '28px 0' }}>{scopes.map(scope => <label key={scope} style={{ display: 'flex', gap: 12, alignItems: 'start' }}><input type="checkbox" checked={selected.includes(scope)} onChange={event => setSelected(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))} /><span>{labels[scope] || scope}</span></label>)}</div>{error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}<div style={{ display: 'flex', gap: 12 }}><button disabled={busy} onClick={() => void submit(false)} style={{ flex: 1, border: 0, padding: 14, borderRadius: 12 }}>Cancelar</button><button disabled={busy || !selected.length} onClick={() => void submit(true)} style={{ flex: 1, background: '#0071e3', color: 'white', border: 0, padding: 14, borderRadius: 12 }}>{busy ? 'Conectando…' : 'Permitir acceso'}</button></div></section></main>;
}
