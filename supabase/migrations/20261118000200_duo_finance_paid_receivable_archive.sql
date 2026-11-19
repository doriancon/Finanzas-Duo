-- Archivo no destructivo: preserva deudas, pagos, movimientos y saldos existentes.
-- Depende de 20261118000100_duo_finance_receivable_payment_corrections.sql.
alter table public.finance_receivables
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null;
create index finance_receivables_active_owner
  on public.finance_receivables(space_id,owner_user_id,created_on desc)
  where archived_at is null;

create function private.guard_paid_receivable_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_paid numeric;
begin
  if old.archived_at is not null then
    -- ON DELETE SET NULL de auth.users anonimiza al archivador sin tocar la deuda.
    if old.archived_by is not null and new.archived_by is null
       and not exists(select 1 from auth.users where id=old.archived_by)
       and (to_jsonb(new)-'archived_by')=(to_jsonb(old)-'archived_by') then
      return new; end if;
    if new.archived_at is distinct from old.archived_at
       or new.archived_by is distinct from old.archived_by
       or (new.principal,new.currency,new.status,new.cancellation_mode)
          is distinct from (old.principal,old.currency,old.status,old.cancellation_mode) then
      raise exception 'Una deuda archivada no puede cambiar su estado de archivo'; end if;
    return new;
  end if;
  if new.archived_at is null then
    if new.archived_by is not null then raise exception 'Archivo inválido'; end if;
    return new;
  end if;
  if (select auth.uid()) is null or new.owner_user_id is distinct from (select auth.uid())
     or not private.is_finance_member(new.space_id) then
    raise exception 'No podés archivar esta deuda'; end if;
  if new.status<>'open' or new.principal is distinct from old.principal
     or new.currency is distinct from old.currency
     or (to_jsonb(new)-'archived_at'-'archived_by'-'updated_at')
        is distinct from (to_jsonb(old)-'archived_at'-'archived_by'-'updated_at') then
    raise exception 'Solo se puede archivar una deuda pagada sin modificar otros datos'; end if;
  select coalesce(sum(amount),0) into v_paid from public.finance_receivable_payments
    where space_id=old.space_id and receivable_id=old.id and status='active';
  if v_paid<>old.principal then
    raise exception 'Solo se puede archivar una deuda completamente pagada'; end if;
  new.archived_by:=(select auth.uid());
  return new;
end $$;
create trigger finance_receivables_z_archive_guard
  before update on public.finance_receivables
  for each row execute function private.guard_paid_receivable_archive();

-- Una deuda archivada queda congelada: sus pagos no pueden volver a cambiar
-- el saldo pendiente mientras está fuera de la lista habitual.
create function private.guard_archived_receivable_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and exists(select 1 from public.finance_receivables r
      where r.space_id=old.space_id and r.id=old.receivable_id and r.archived_at is not null) then
    raise exception 'La deuda archivada conserva sus pagos sin cambios'; end if;
  if exists(select 1 from public.finance_receivables r
      where r.space_id=new.space_id and r.id=new.receivable_id and r.archived_at is not null) then
    raise exception 'La deuda archivada conserva sus pagos sin cambios'; end if;
  return new;
end $$;
create trigger finance_archived_receivable_payment_guard
  before insert or update on public.finance_receivable_payments
  for each row execute function private.guard_archived_receivable_payment();

create function public.archive_paid_finance_receivable(p_space_id uuid,p_receivable_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_debt public.finance_receivables%rowtype;v_paid numeric;
begin
  if (select auth.uid()) is null or not private.is_finance_member(p_space_id) then
    raise exception 'No pertenecés a este espacio'; end if;
  if p_receivable_id is null then raise exception 'Deuda inválida'; end if;
  perform 1 from public.finance_spaces where id=p_space_id for update;
  select * into v_debt from public.finance_receivables
    where space_id=p_space_id and id=p_receivable_id and owner_user_id=(select auth.uid()) for update;
  if not found then raise exception 'Deuda inexistente o sin permiso'; end if;
  if v_debt.archived_at is not null then return to_jsonb(v_debt); end if;
  if v_debt.status<>'open' then raise exception 'Una deuda anulada no puede archivarse como pagada'; end if;
  select coalesce(sum(amount),0) into v_paid from public.finance_receivable_payments
    where space_id=p_space_id and receivable_id=p_receivable_id and status='active';
  if v_paid<>v_debt.principal then
    raise exception 'La deuda todavía tiene saldo pendiente'; end if;
  update public.finance_receivables set archived_at=now()
    where space_id=p_space_id and id=p_receivable_id returning * into v_debt;
  return to_jsonb(v_debt);
end $$;

revoke all on function private.guard_paid_receivable_archive(),
  private.guard_archived_receivable_payment() from public,anon,authenticated;
revoke all on function public.archive_paid_finance_receivable(uuid,uuid) from public,anon;
grant execute on function public.archive_paid_finance_receivable(uuid,uuid) to authenticated;
