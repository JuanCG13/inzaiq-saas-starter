'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { RuntimeSettings } from './contracts';
import styles from './runtime.module.css';

function clientEvent(stage: 'viewed' | 'submitted' | 'saved' | 'reloaded', outcome: 'success' | 'rejected' | 'failure' = 'success') {
  try { window.dispatchEvent(new CustomEvent('app:telemetry', { detail: {
    'event.name': `ui.settings.${stage}`, 'event.schema_version': 1, 'event.outcome': outcome,
    'feature.name': 'settings', 'feature.stage': stage,
  } })); } catch { /* Browser diagnostic consumers cannot block settings. */ }
}

/** Public store or authenticated operational endpoint. No shared cross-tenant cache. */
export function useRuntimeSettings(endpoint = '/api/store/settings') {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const accept = useCallback((value: RuntimeSettings) => { sequence.current += 1; setSettings(value); setError(null); }, []);
  const reload = useCallback(async (): Promise<RuntimeSettings | null> => {
    const current = ++sequence.current;
    try {
      const result = await api<{ settings: RuntimeSettings }>(endpoint);
      if (current === sequence.current) { setSettings(result.settings); setError(null); }
      return result.settings;
    } catch (failure) {
      if (current === sequence.current) setError(failure instanceof Error ? failure.message : 'No se pudo actualizar el estado del negocio.');
      return null;
    }
  }, [endpoint]);
  useEffect(() => {
    setSettings(null); setError(null);
    void reload();
    const refresh = () => { if (document.visibilityState !== 'hidden') void reload(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('commerce:settings-changed', refresh);
    return () => { sequence.current += 1; window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('commerce:settings-changed', refresh); };
  }, [reload]);
  return { settings, error, reload, accept };
}

export function RuntimeNotice({ endpoint = '/api/store/settings', onSettingsChange }: { endpoint?: string; onSettingsChange?: (settings: RuntimeSettings) => void }) {
  const { settings } = useRuntimeSettings(endpoint);
  useEffect(() => { if (settings) onSettingsChange?.(settings); }, [settings, onSettingsChange]);
  if (!settings || (settings.acceptingOrders && !settings.notice)) return null;
  return <aside className={styles.notice} role="status" aria-live="polite">
    {!settings.acceptingOrders ? <strong>Las nuevas operaciones están pausadas.</strong> : null}
    {settings.notice ? <span>{settings.notice}</span> : null}
  </aside>;
}

export function AdminRuntimeSettings() {
  const { settings, error: readError, reload, accept } = useRuntimeSettings('/api/admin/settings');
  const [draft, setDraft] = useState<RuntimeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const id = useId();
  useEffect(() => { clientEvent('viewed'); }, []);
  useEffect(() => { if (settings) setDraft(current => current ?? settings); }, [settings]);
  const stale = conflict || Boolean(settings && draft && settings.version !== draft.version);

  async function reloadDraft() {
    setSaved(false);
    const current = await reload();
    if (current) { setDraft(current); setConflict(false); setError(null); }
    clientEvent('reloaded', current ? 'success' : 'failure');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving || stale) return;
    setSaving(true); setError(null); setSaved(false); clientEvent('submitted');
    try {
      const result = await api<{ settings: RuntimeSettings }>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(draft) });
      accept(result.settings); setDraft(result.settings); setConflict(false); setSaved(true);
      clientEvent('saved');
      window.dispatchEvent(new Event('commerce:settings-changed'));
    } catch (failure) {
      const isConflict = failure instanceof ApiError && failure.status === 409;
      setConflict(isConflict);
      setError(isConflict ? 'Otra persona cambió la configuración. Recargá los valores y revisalos antes de guardar.' : failure instanceof Error ? failure.message : 'No se pudo guardar.');
      clientEvent('saved', failure instanceof ApiError && failure.status < 500 ? 'rejected' : 'failure');
      if (isConflict) void reload();
    } finally { setSaving(false); }
  }

  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <div><h2 id={`${id}-title`}>Operación del negocio</h2><p className={styles.help}>Los cambios se aplican al guardar. El aviso y el estado se actualizan en las pantallas abiertas.</p></div>
    {error || readError ? <p className={styles.error} role="alert">{error || readError}</p> : null}
    {stale && !error ? <p className={styles.error} role="alert">Hay una versión más reciente. Recargá los valores antes de guardar.</p> : null}
    {!draft ? <div className={styles.actions}><span>{readError ? 'Configuración no disponible.' : 'Cargando configuración…'}</span>{readError ? <button type="button" onClick={() => void reloadDraft()}>Reintentar</button> : null}</div> : <form onSubmit={event => void save(event)} className={styles.form}>
      <label className={styles.toggle}><input type="checkbox" checked={draft.acceptingOrders} disabled={saving} onChange={event => { setDraft({ ...draft, acceptingOrders: event.target.checked }); setSaved(false); }} /><span><strong>Aceptar nuevas operaciones</strong><small>Al pausar, los pedidos y ventas existentes conservan su estado.</small></span></label>
      <label htmlFor={`${id}-notice`}>Aviso del negocio</label>
      <textarea id={`${id}-notice`} value={draft.notice} maxLength={200} rows={3} disabled={saving} aria-describedby={`${id}-notice-help`} placeholder="Por ejemplo: hoy cerramos a las 18:00." onChange={event => { setDraft({ ...draft, notice: event.target.value }); setSaved(false); }} />
      <small id={`${id}-notice-help`} className={styles.help}>Visible para quienes usan este negocio. {draft.notice.length}/200 caracteres.</small>
      <div className={styles.actions}><button type="submit" disabled={saving || stale}>{saving ? 'Guardando…' : 'Guardar configuración'}</button><button type="button" className={styles.secondary} disabled={saving} onClick={() => void reloadDraft()}>Recargar valores</button></div>
      {saved ? <p role="status" className={styles.success}>Configuración guardada.</p> : null}
    </form>}
  </section>;
}
