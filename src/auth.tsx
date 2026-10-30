import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, TEST_PROJECT_REF } from './supabase';

export type SharedSpace = { id: string; role: 'owner' | 'member' };

export function LoadingScreen() {
  return <div className="loading-screen" role="status" aria-label="Cargando Duo Finance">
    <img className="loading-logo" src="/dyd-192.png" width="144" height="144" alt="Duo Finance" />
    <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>
  </div>;
}

async function findFinanceSpace(userId: string): Promise<SharedSpace | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('finance_space_members')
    .select('space_id,role').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? { id: data.space_id, role: data.role } : null;
}

export function AuthRoot({ children }: { children: (space: SharedSpace | null, email: string | null, userId: string | null) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [space, setSpace] = useState<SharedSpace | null>(null);
  const [ready, setReady] = useState(!supabaseConfigured);
  const [error, setError] = useState('');
  const authUserId = useRef<string | null>(null);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    let checkingMembership = false;
    const checkMembership = async () => {
      const userId = authUserId.current;
      if (!active || !userId || checkingMembership) return;
      checkingMembership = true;
      try {
        const found = await findFinanceSpace(userId);
        if (active && authUserId.current === userId) {
          setSpace(previous => previous?.id === found?.id && previous?.role === found?.role ? previous : found);
          setReady(true);
        }
      } catch {
        // Un fallo de red no elimina la sesión. RLS sigue controlando el acceso.
      } finally { checkingMembership = false; }
    };
    const { data: listener } = client.auth.onAuthStateChange((_event, current) => {
      if (!active) return;
      if (current?.user.id && current.user.id === authUserId.current) { setSession(current); return; }
      authUserId.current = current?.user.id || null;
      setSession(current);
      setSpace(null);
      setReady(false);
      setError('');
      if (!current) { setReady(true); return; }
      // Descarga la interfaz mientras se comprueba la pertenencia al espacio.
      void import('./main').catch(() => {});
      // Supabase recomienda diferir las consultas desde onAuthStateChange.
      setTimeout(() => {
        if (!active || authUserId.current !== current.user.id) return;
        void findFinanceSpace(current.user.id)
          .then(found => { if (active && authUserId.current === current.user.id) { setSpace(found); setReady(true); } })
          .catch(cause => { if (active && authUserId.current === current.user.id) { setError(String(cause)); setReady(true); } });
      }, 0);
    });
    const timer = window.setInterval(() => { void checkMembership(); }, 5000);
    window.addEventListener('focus', checkMembership);
    return () => {
      active = false; authUserId.current = null; listener.subscription.unsubscribe();
      window.clearInterval(timer); window.removeEventListener('focus', checkMembership);
    };
  }, []);

  if (!supabaseConfigured) return children(null, null, null);
  if (!ready) return <LoadingScreen />;
  if (error) return <div className="auth-page"><div className="auth-card"><h1>No se pudo abrir el espacio</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>Reintentar</button></div></div>;
  if (!session) return <AuthForm />;
  if (!space) return <SpaceSetup onReady={setSpace} />;
  return children(space, session.user.email || null, session.user.id);
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
    <p>Entrá a tu espacio financiero o creá uno propio.</p>
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
  const [spaceName, setSpaceName] = useState('Mis finanzas');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const result = await client.from('finance_user_profiles').select('display_name').eq('user_id', data.user.id).maybeSingle();
      if (active && result.data?.display_name) setDisplayName(result.data.display_name);
    });
    return () => { active = false; };
  }, []);
  const saveName = async () => {
    const client = supabase;
    if (!client || !displayName.trim()) throw new Error('Escribí tu nombre para continuar.');
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data.user) throw new Error('Iniciá sesión nuevamente.');
    const result = await client.from('finance_user_profiles').upsert(
      { user_id: data.user.id, display_name: displayName.trim() }, { onConflict: 'user_id' });
    if (result.error) throw result.error;
  };
  const join = async () => {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      await saveName();
      const { acceptFinanceInvite } = await import('./finance-remote');
      const id = await acceptFinanceInvite(supabase, token.trim());
      history.replaceState(null, '', location.pathname);
      onReady({ id, role: 'member' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la invitación.'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      await saveName();
      const { data, error: failure } = await supabase.rpc('create_finance_space', { p_name: spaceName.trim() });
      if (failure) throw failure;
      onReady({ id: data as string, role: 'owner' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el espacio.'); }
    finally { setBusy(false); }
  };
  return <div className="auth-page"><div className="auth-card"><strong className="auth-brand">duo<span>.</span> finance</strong>
    <h1>Elegí tu espacio</h1><p>Creá un espacio independiente o unite a uno con una invitación.</p>
    <label>Tu nombre visible<input value={displayName} maxLength={80} onChange={event => setDisplayName(event.target.value)} /></label>
    <label>Nombre de tu espacio<input value={spaceName} maxLength={80} onChange={event => setSpaceName(event.target.value)} /></label>
    <button className="primary-button" onClick={() => void create()} disabled={busy || !displayName.trim() || !spaceName.trim()}>Crear mi espacio financiero</button>
    <label>Código de invitación<input value={token} onChange={e => setToken(e.target.value)} placeholder="Pegá el código recibido" /></label>
    <button className="small-add" onClick={() => void join()} disabled={busy || !token.trim() || !displayName.trim()}>Unirme mediante invitación</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    <LocalBackupButton />
    <button className="auth-switch" onClick={() => void supabase?.auth.signOut({ scope: 'local' })}>Cerrar sesión</button></div></div>;
}

function LocalBackupButton() {
  const [message, setMessage] = useState('');
  return <><button className="auth-switch" onClick={() => { void (async () => {
    try { const { downloadFinanceBackup } = await import('./backup'); downloadFinanceBackup(); setMessage('Respaldo JSON descargado. Guardalo en un lugar seguro.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'No se pudo descargar el respaldo.'); }
  })(); }}>Descargar respaldo local antes de continuar</button>{message && <p role="status" className="form-hint">{message}</p>}</>;
}
