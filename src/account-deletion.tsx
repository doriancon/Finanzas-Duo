import { useEffect, useState } from 'react';
import type { SharedSpace } from './auth';
import { downloadSharedFinanceBackup } from './backup';
import { loadFinanceSpace } from './finance-remote';
import { supabase } from './supabase';

const CONFIRMATION = 'ELIMINAR MI CUENTA';

export function AccountDeletionSettings({ space }: { space: SharedSpace }) {
  const [otherMember, setOtherMember] = useState<string | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void client.auth.getUser().then(async ({ data, error }) => {
      if (error || !data.user) throw error || new Error('La sesión no es válida.');
      const members = await client.from('finance_space_members').select('user_id').eq('space_id', space.id);
      if (members.error) throw members.error;
      if (active) { setOtherMember(members.data.find(member => member.user_id !== data.user.id)?.user_id || null); setMembersLoaded(true); }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'No se pudieron comprobar los integrantes.'); });
    return () => { active = false; };
  }, [space.id]);

  const backup = async () => {
    if (!supabase) return;
    setBusy(true); setMessage('');
    try {
      const fresh = await loadFinanceSpace(supabase, space.id);
      downloadSharedFinanceBackup(fresh);
      setMessage('Respaldo descargado. Guardalo en un lugar seguro.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo descargar el respaldo.'); }
    finally { setBusy(false); }
  };

  const transfer = async () => {
    if (!supabase || !otherMember) return;
    setBusy(true); setMessage('');
    const result = await supabase.rpc('transfer_finance_space_owner', { p_space_id: space.id, p_new_owner: otherMember });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else location.reload();
  };

  const remove = async () => {
    if (!supabase || !membersLoaded || confirmation !== CONFIRMATION || !password) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error('Iniciá sesión nuevamente.');
      const response = await fetch('/api/delete-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ password, confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'No se pudo eliminar la cuenta.');
      setPassword('');
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* La cuenta ya fue eliminada. */ }
      location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo eliminar la cuenta.'); }
    finally { setBusy(false); }
  };

  return <section className="panel account-security"><h2>Seguridad</h2>
    <button className="small-add" onClick={() => setOpen(value => !value)} aria-expanded={open}>Eliminar mi cuenta</button>
    {open && <div className="account-deletion-flow">
      <p>Esta acción es definitiva. Podés descargar un respaldo actualizado antes de continuar.</p>
      <button className="small-add" disabled={busy} onClick={() => void backup()}>Descargar mis datos financieros</button>
      {!membersLoaded && <p>Comprobando integrantes del espacio…</p>}
      {membersLoaded && otherMember && space.role === 'owner' ? <>
        <p>Administrás un espacio compartido. Transferí primero la administración. Los movimientos y saldos del espacio permanecerán para la otra persona.</p>
        <button className="small-add" disabled={busy} onClick={() => void transfer()}>Transferir administración al otro integrante</button>
      </> : membersLoaded && <>
        <p>{otherMember
          ? 'Tu acceso y cuenta personal se eliminarán. El espacio y sus datos financieros quedarán para la otra persona.'
          : 'Sos el único integrante. Se eliminarán tu cuenta y el espacio completo, con sus cuentas, movimientos, metas y configuraciones.'}</p>
        <label>Escribí {CONFIRMATION}<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <label>Confirmá tu contraseña<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label>
        <button className="danger-button" disabled={busy || confirmation !== CONFIRMATION || !password} onClick={() => void remove()}>
          {busy ? 'Procesando…' : 'Eliminar mi cuenta definitivamente'}
        </button>
      </>}
      {message && <p role="status" className="form-hint">{message}</p>}
    </div>}
  </section>;
}
