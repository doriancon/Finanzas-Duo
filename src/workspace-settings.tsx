import { useEffect, useState } from 'react';
import type { SharedSpace } from './auth';
import { CURRENCIES } from './domain';
import { supabase } from './supabase';
import { saveWorkspacePreferences, type WorkspacePreferences } from './workspace';

export function WorkspaceSettings({ space, userId, preferences, onSaved }:
  { space: SharedSpace; userId: string; preferences: WorkspacePreferences; onSaved: (next: WorkspacePreferences) => void }) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setDraft(preferences), [preferences]);
  const owner = space.role === 'owner';
  const save = async () => {
    if (!supabase) return;
    setBusy(true); setMessage('');
    try {
      await saveWorkspacePreferences(supabase, space.id, userId, preferences, draft, owner);
      onSaved({ ...draft, name: draft.name.trim(), displayName: draft.displayName.trim() });
      setMessage('Configuración guardada.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.'); }
    finally { setBusy(false); }
  };
  return <section className="panel workspace-settings"><h2>Personalizar mi espacio</h2>
    <label>Mi nombre<input maxLength={80} value={draft.displayName}
      onChange={event => setDraft(old => ({ ...old, displayName: event.target.value }))} /></label>
    <label>Nombre del espacio<input maxLength={80} value={draft.name} disabled={!owner}
      onChange={event => setDraft(old => ({ ...old, name: event.target.value }))} /></label>
    {!owner && <p>Solo quien administra el espacio puede cambiar su nombre y las preferencias compartidas.</p>}
    {owner && <>
      <fieldset><legend>Funciones visibles</legend>
        <label><input type="checkbox" checked={draft.showGiros}
          onChange={event => setDraft(old => ({ ...old, showGiros: event.target.checked }))} /> Giros de dinero</label>
        <label><input type="checkbox" checked={draft.showBusiness}
          onChange={event => setDraft(old => ({ ...old, showBusiness: event.target.checked }))} /> Lencería / negocio</label>
      </fieldset>
      <fieldset><legend>Monedas para nuevas operaciones</legend>
        {CURRENCIES.map(currency => <label key={currency}><input type="checkbox"
          checked={draft.enabledCurrencies.includes(currency)}
          onChange={event => setDraft(old => ({ ...old, enabledCurrencies: event.target.checked
            ? CURRENCIES.filter(item => old.enabledCurrencies.includes(item) || item === currency)
            : old.enabledCurrencies.filter(item => item !== currency) }))} /> {currency}</label>)}
        <small>Ocultar una moneda no elimina sus cuentas ni su historial.</small>
      </fieldset>
    </>}
    <button className="primary-button" disabled={busy || !draft.displayName.trim() || (owner && (!draft.name.trim() || !draft.enabledCurrencies.length))}
      onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar preferencias'}</button>
    {message && <p role="status" className="form-hint">{message}</p>}
  </section>;
}
