import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { acceptFinanceInvite, findFinanceSpace } from './finance-remote';
import { supabase, supabaseConfigured, TEST_PROJECT_REF } from './supabase';
import { downloadFinanceBackup } from './backup';

export type SharedSpace = { id: string; role: 'owner' | 'member' };

export function AuthRoot({ children }: { children: (space: SharedSpace | null, email: string | null) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [space, setSpace] = useState<SharedSpace | null>(null);
  const [ready, setReady] = useState(!supabaseConfigured);
  const [error, setError] = useState('');
  const authUserId = useRef<string | null>(null);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((_event, current) => {
      if (!active) return;
      if (current?.user.id && current.user.id === authUserId.current) { setSession(current); return; }
      authUserId.current = current?.user.id || null;
      setSession(current);
      setSpace(null);
      setReady(false);
      setError('');
      if (!current) { setReady(true); return; }
      // Supabase recomienda diferir las consultas desde onAuthStateChange.
      setTimeout(() => {
        void findFinanceSpace(client, current.user.id)
          .then(found => { if (active && authUserId.current === current.user.id) { setSpace(found); setReady(true); } })
          .catch(cause => { if (active && authUserId.current === current.user.id) { setError(String(cause)); setReady(true); } });
      }, 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!supabaseConfigured) return children(null, null);
  if (!ready) return <div className="auth-page"><div className="auth-card"><strong>duo.</strong><p>Abriendo el espacio compartido…</p></div></div>;
  if (error) return <div className="auth-page"><div className="auth-card"><h1>No se pudo abrir el espacio</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>Reintentar</button></div></div>;
  if (!session) return <AuthForm />;
  if (!space) return <SpaceSetup onReady={setSpace} />;
  return children(space, session.user.email || null);
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage('');
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMessage(result.error?.message || (mode === 'signup' && !result.data.session
      ? 'Revisá tu correo para confirmar la cuenta y después iniciá sesión.' : ''));
  };
  return <div className="auth-page"><div className="auth-card"><strong className="auth-brand">duo<span>.</span> finance</strong>
    <h1>{mode === 'login' ? 'Entrar a nuestras finanzas' : 'Crear tu usuario'}</h1>
    <p>Dorian y Dani usan cuentas independientes dentro del mismo espacio.</p>
    <form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Contraseña<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {message && <p role="status" className="form-hint">{message}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : 'Crear usuario'}</button></form>
    <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
      {mode === 'login' ? '¿No tenés usuario? Crear uno' : 'Ya tengo usuario'}</button>
    <LocalBackupButton />
    <small>Proyecto de pruebas: {TEST_PROJECT_REF}</small></div></div>;
}

function SpaceSetup({ onReady }: { onReady: (space: SharedSpace) => void }) {
  const [token, setToken] = useState(new URLSearchParams(location.search).get('invite') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const join = async () => {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      const id = await acceptFinanceInvite(supabase, token.trim());
      history.replaceState(null, '', location.pathname);
      onReady({ id, role: 'member' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la invitación.'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!supabase) return;
    setBusy(true); setError('');
    const { data, error: failure } = await supabase.rpc('create_finance_space', { p_name: 'Dorian & Dani' });
    setBusy(false);
    if (failure) return setError(failure.message);
    onReady({ id: data as string, role: 'owner' });
  };
  return <div className="auth-page"><div className="auth-card"><strong className="auth-brand">duo<span>.</span> finance</strong>
    <h1>Elegí el espacio compartido</h1><p>Una persona crea el espacio. La otra entra con el código de invitación.</p>
    <button className="primary-button" onClick={create} disabled={busy}>Crear espacio para Dorian y Dani</button>
    <label>Código de invitación<input value={token} onChange={e => setToken(e.target.value)} placeholder="Pegá el código recibido" /></label>
    <button className="small-add" onClick={join} disabled={busy || !token.trim()}>Unirme al espacio</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    <LocalBackupButton />
    <button className="auth-switch" onClick={() => void supabase?.auth.signOut({ scope: 'local' })}>Cerrar sesión</button></div></div>;
}

function LocalBackupButton() {
  const [message, setMessage] = useState('');
  return <><button className="auth-switch" onClick={() => {
    try { downloadFinanceBackup(); setMessage('Respaldo JSON descargado. Guardalo en un lugar seguro.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'No se pudo descargar el respaldo.'); }
  }}>Descargar respaldo local antes de continuar</button>{message && <p role="status" className="form-hint">{message}</p>}</>;
}
