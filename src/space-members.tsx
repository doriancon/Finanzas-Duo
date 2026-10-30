import { useCallback, useEffect, useState } from 'react';
import type { SharedSpace } from './auth';
import { listFinanceSpaceMembers, removeFinanceSpaceMember, type FinanceSpaceMember } from './finance-remote';
import { supabase } from './supabase';

export function SpaceMembers({ space, userId }: { space: SharedSpace; userId: string }) {
  const [members, setMembers] = useState<FinanceSpaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const rows = await listFinanceSpaceMembers(supabase, space.id);
    setMembers(rows);
  }, [space.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (supabase) void listFinanceSpaceMembers(supabase, space.id)
      .then(rows => { if (active) setMembers(rows); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los integrantes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [space.id]);

  const remove = async (member: FinanceSpaceMember) => {
    if (!supabase || space.role !== 'owner' || member.role !== 'member' || member.userId === userId) return;
    if (!window.confirm(`¿Quitar a ${member.displayName} de este espacio? Perderá el acceso, pero conservará su cuenta. Los datos financieros del espacio permanecerán aquí.`)) return;
    setBusyId(member.userId); setError(''); setMessage('');
    try {
      await removeFinanceSpaceMember(supabase, space.id, member.userId);
      setMessage(`${member.displayName} ya no tiene acceso a este espacio.`);
      setMembers(previous => previous.filter(item => item.userId !== member.userId));
      try { await refresh(); }
      catch { setError('Se quitó al integrante, pero no se pudo actualizar la lista. Volvé a abrir Configuración.'); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo quitar al integrante.');
    } finally { setBusyId(null); }
  };

  return <section className="panel space-members"><div className="section-head"><div><h2>Integrantes</h2>
    <p>Personas que pueden acceder a este espacio financiero.</p></div></div>
    {loading && <p className="form-hint">Cargando integrantes…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-hint" role="status">{message}</p>}
    <div className="space-member-list">{members.map(member => <div className="space-member-row" key={member.userId}>
      <div><strong>{member.displayName}{member.userId === userId ? ' · Vos' : ''}</strong>
        <span>{member.role === 'owner' ? 'Propietario' : 'Integrante'}</span></div>
      {space.role === 'owner' && member.role === 'member' && member.userId !== userId &&
        <button type="button" className="text-link" disabled={busyId !== null}
          onClick={() => void remove(member)}>{busyId === member.userId ? 'Quitando…' : 'Quitar integrante'}</button>}
    </div>)}</div>
  </section>;
}
