-- Correcciones auditables de pagos. No modifica pagos, deudas ni movimientos existentes.
alter table public.finance_receivable_payments
  drop constraint if exists finance_receivable_payments_amount_check;
alter table public.finance_receivable_payments
  alter column account_id drop not null,
  alter column entry_id drop not null,
  add column mode text not null default 'account' check (mode in ('account','control')),
  add column status text not null default 'active' check (status in ('active','void')),
  add column note text not null default '' check (length(note)<=500),
  add column revision integer not null default 0 check (revision>=0),
  add column updated_at timestamptz not null default now(),
  add constraint finance_receivable_payment_amount_status_check
    check ((status='active' and amount>0) or (status='void' and amount=0)),
  add constraint finance_receivable_payment_mode_account_check
    check (status='void' or (mode='account' and account_id is not null) or
      (mode='control' and account_id is null));

-- Una revisión conserva los valores anteriores y posteriores, incluso tras anular.
create table public.finance_receivable_payment_revisions (
  space_id uuid not null,
  id uuid not null,
  payment_id uuid not null,
  revision integer not null,
  action text not null check (action in ('edit','void','move')),
  request_payload jsonb not null,
  old_receivable_id uuid not null,
  new_receivable_id uuid not null,
  old_amount numeric(24,6) not null,
  new_amount numeric(24,6) not null,
  old_mode text not null,
  new_mode text not null,
  old_account_id text,
  new_account_id text,
  old_note text not null,
  new_note text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (space_id,id),
  unique (space_id,payment_id,revision),
  foreign key (space_id,payment_id) references public.finance_receivable_payments(space_id,id) on delete cascade
);
create index finance_payment_revisions_payment on public.finance_receivable_payment_revisions(space_id,payment_id,revision);

-- Cada movimiento compensatorio queda ligado a un pago y protegido contra edición aislada.
create table public.finance_receivable_payment_postings (
  space_id uuid not null,
  payment_id uuid not null,
  entry_id text not null,
  revision_id uuid not null,
  primary key (space_id,entry_id),
  foreign key (space_id,payment_id) references public.finance_receivable_payments(space_id,id) on delete cascade,
  foreign key (space_id,revision_id) references public.finance_receivable_payment_revisions(space_id,id) on delete cascade,
  foreign key (space_id,entry_id) references public.finance_entries(space_id,id) deferrable initially deferred
);
alter table public.finance_receivable_payment_revisions enable row level security;
alter table public.finance_receivable_payment_postings enable row level security;
revoke all on public.finance_receivable_payment_revisions,public.finance_receivable_payment_postings from public,anon,authenticated;
grant select on public.finance_receivable_payment_revisions to authenticated;
grant all on public.finance_receivable_payment_revisions,public.finance_receivable_payment_postings to service_role;
create policy finance_payment_revisions_read on public.finance_receivable_payment_revisions
  for select to authenticated using (exists (
    select 1 from public.finance_receivable_payments p
    join public.finance_receivables r on r.space_id=p.space_id and r.id=p.receivable_id
    where p.space_id=finance_receivable_payment_revisions.space_id
      and p.id=finance_receivable_payment_revisions.payment_id
      and r.owner_user_id=(select auth.uid()) and private.is_finance_member(p.space_id)));

create or replace function private.guard_finance_receivable_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.finance_spaces where id=old.space_id)
     and (exists(select 1 from public.finance_receivable_payments p
       where p.space_id=old.space_id and p.entry_id=old.id)
       or exists(select 1 from public.finance_receivable_payment_postings p
       where p.space_id=old.space_id and p.entry_id=old.id)
       or exists(select 1 from public.finance_receivables r
       where r.space_id=old.space_id and r.origin_entry_id=old.id)) then
    if tg_op='UPDATE' and old.actor_user_id is not null and new.actor_user_id is null
       and new.actor_name='Miembro anterior'
       and (to_jsonb(new)-'actor_user_id'-'actor_name')=(to_jsonb(old)-'actor_user_id'-'actor_name')
      then return new; end if;
    raise exception 'Este movimiento está vinculado a una deuda y no puede modificarse por separado';
  end if;
  if tg_op='UPDATE' then return new; end if;
  return old;
end $$;

-- Los clientes ya publicados siguen usando esta firma. Su comparación previa
-- con <> aceptaba un pago de control porque NULL <> cuenta produce NULL.
create or replace function public.record_finance_receivable_payment(
  p_space_id uuid,p_receivable_id uuid,p_payment_id uuid,p_amount numeric,
  p_account_id text,p_existing_entry_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_debt public.finance_receivables%rowtype;v_previous public.finance_receivable_payments%rowtype;
  v_account_currency text;v_paid numeric;v_entry public.finance_entries%rowtype;v_entry_id text;
begin
  if (select auth.uid()) is null or not private.is_finance_member(p_space_id) then
    raise exception 'No pertenecés a este espacio'; end if;
  if p_receivable_id is null or p_payment_id is null or p_account_id is null then
    raise exception 'Solicitud de cobro inválida'; end if;
  perform 1 from public.finance_spaces where id=p_space_id for update;
  select * into v_debt from public.finance_receivables
    where space_id=p_space_id and id=p_receivable_id and owner_user_id=(select auth.uid()) for update;
  if not found then raise exception 'Deuda inexistente o sin permiso'; end if;
  select * into v_previous from public.finance_receivable_payments
    where space_id=p_space_id and id=p_payment_id;
  if found then
    if v_previous.receivable_id is distinct from p_receivable_id
       or v_previous.amount is distinct from p_amount
       or v_previous.account_id is distinct from p_account_id
       or v_previous.mode is distinct from 'account'
       or v_previous.status is distinct from 'active'
       or v_previous.linked_existing is distinct from (p_existing_entry_id is not null)
       or v_previous.payment_reason is distinct from 'collection'
       or (p_existing_entry_id is not null
           and v_previous.entry_id is distinct from p_existing_entry_id) then
      raise exception 'El identificador del cobro ya se usó con otros datos'; end if;
    return to_jsonb(v_previous);
  end if;
  if v_debt.status<>'open' then raise exception 'La deuda está anulada'; end if;
  if p_amount is null or p_amount<=0 or not private.valid_money(p_amount,v_debt.currency) then
    raise exception 'Importe de cobro inválido'; end if;
  select currency into v_account_currency from public.finance_accounts
    where space_id=p_space_id and id=p_account_id;
  if v_account_currency is distinct from v_debt.currency then
    raise exception 'La cuenta debe tener la moneda de la deuda'; end if;
  select coalesce(sum(amount),0) into v_paid from public.finance_receivable_payments
    where space_id=p_space_id and receivable_id=p_receivable_id;
  if v_paid+p_amount>v_debt.principal then raise exception 'El cobro supera el saldo pendiente'; end if;
  if p_existing_entry_id is not null then
    select * into v_entry from public.finance_entries where space_id=p_space_id and id=p_existing_entry_id;
    if not found or v_entry.kind<>'income' or v_entry.scope not in ('everyday','business')
       or v_entry.actor_user_id is distinct from (select auth.uid())
       or v_entry.currency<>v_debt.currency or v_entry.account_id<>p_account_id or v_entry.amount<>p_amount then
      raise exception 'El ingreso existente no corresponde a este cobro'; end if;
    if v_debt.debt_type='loan' then
      update public.finance_entries set scope='receivable',updated_at=now()
        where space_id=p_space_id and id=p_existing_entry_id;
    end if;
    v_entry_id:=p_existing_entry_id;
  else
    v_entry_id:='receivable:'||p_payment_id::text;
    insert into public.finance_entries(space_id,id,kind,scope,amount,currency,account_id,description,entry_date)
      values(p_space_id,v_entry_id,'income','receivable',p_amount,v_debt.currency,p_account_id,
        'Cobro de deuda',current_date);
    perform private.assert_finance_balances(p_space_id);
  end if;
  insert into public.finance_receivable_payments(space_id,id,receivable_id,amount,currency,account_id,entry_id,linked_existing)
    values(p_space_id,p_payment_id,p_receivable_id,p_amount,v_debt.currency,p_account_id,v_entry_id,
      p_existing_entry_id is not null)
    returning * into v_previous;
  return to_jsonb(v_previous);
end $$;

-- API nueva: la función anterior sigue disponible para clientes ya publicados.
create function public.record_finance_receivable_payment_v2(
  p_space_id uuid,p_receivable_id uuid,p_payment_id uuid,p_amount numeric,
  p_mode text,p_account_id text default null,p_note text default '',p_existing_entry_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_debt public.finance_receivables%rowtype;v_payment public.finance_receivable_payments%rowtype;
  v_paid numeric;v_currency text;
begin
  if (select auth.uid()) is null or not private.is_finance_member(p_space_id) then
    raise exception 'No pertenecés a este espacio'; end if;
  if p_receivable_id is null or p_payment_id is null or p_mode is null
     or p_mode not in ('account','control')
     or length(coalesce(p_note,''))>500 then raise exception 'Solicitud de pago inválida'; end if;
  perform 1 from public.finance_spaces where id=p_space_id for update;
  select * into v_debt from public.finance_receivables
    where space_id=p_space_id and id=p_receivable_id and owner_user_id=(select auth.uid()) for update;
  if not found then raise exception 'Deuda inexistente o sin permiso'; end if;
  select * into v_payment from public.finance_receivable_payments
    where space_id=p_space_id and id=p_payment_id;
  if found then
    if v_payment.receivable_id<>p_receivable_id or v_payment.status<>'active'
       or v_payment.payment_reason<>'collection' or v_payment.amount<>p_amount
       or v_payment.mode<>p_mode or v_payment.account_id is distinct from p_account_id
       or v_payment.note<>coalesce(p_note,'')
       or v_payment.linked_existing<>(p_existing_entry_id is not null)
       or (p_existing_entry_id is not null and v_payment.entry_id<>p_existing_entry_id) then
      raise exception 'El identificador del pago ya se usó con otros datos'; end if;
    return to_jsonb(v_payment);
  end if;
  if v_debt.status<>'open' then raise exception 'La deuda está anulada'; end if;
  if p_amount is null or p_amount<=0 or not private.valid_money(p_amount,v_debt.currency) then
    raise exception 'Importe de pago inválido'; end if;
  if p_mode='account' then
    if p_account_id is null then raise exception 'Elegí una cuenta receptora'; end if;
    select currency into v_currency from public.finance_accounts
      where space_id=p_space_id and id=p_account_id;
    if v_currency is distinct from v_debt.currency then
      raise exception 'La cuenta debe tener la moneda de la deuda'; end if;
    perform public.record_finance_receivable_payment(p_space_id,p_receivable_id,p_payment_id,
      p_amount,p_account_id,p_existing_entry_id);
    update public.finance_receivable_payments set note=coalesce(p_note,'')
      where space_id=p_space_id and id=p_payment_id returning * into v_payment;
  else
    if p_account_id is not null or p_existing_entry_id is not null then
      raise exception 'Un pago de control no usa cuentas ni movimientos'; end if;
    select coalesce(sum(amount),0) into v_paid from public.finance_receivable_payments
      where space_id=p_space_id and receivable_id=p_receivable_id and status='active';
    if v_paid+p_amount>v_debt.principal then raise exception 'El pago supera el saldo pendiente'; end if;
    insert into public.finance_receivable_payments
      (space_id,id,receivable_id,amount,currency,account_id,entry_id,mode,note)
      values(p_space_id,p_payment_id,p_receivable_id,p_amount,v_debt.currency,null,null,'control',coalesce(p_note,''))
      returning * into v_payment;
  end if;
  return to_jsonb(v_payment);
end $$;

create function public.correct_finance_receivable_payment(
  p_space_id uuid,p_payment_id uuid,p_request_id uuid,p_expected_revision integer,
  p_action text,p_target_receivable_id uuid,p_amount numeric,p_mode text,
  p_account_id text default null,p_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payment public.finance_receivable_payments%rowtype;v_source public.finance_receivables%rowtype;
  v_target public.finance_receivables%rowtype;v_prior public.finance_receivable_payment_revisions%rowtype;
  v_paid numeric;v_currency text;v_next_amount numeric;v_next_mode text;v_next_account text;
  v_next_debt uuid;v_next_note text;v_payload jsonb;v_old_balance numeric;v_new_balance numeric;
  v_entry_id text;
begin
  if (select auth.uid()) is null or not private.is_finance_member(p_space_id) then
    raise exception 'No pertenecés a este espacio'; end if;
  if p_payment_id is null or p_request_id is null or p_action is null
     or p_action not in ('edit','void','move')
     or p_expected_revision is null or p_expected_revision<0 or length(coalesce(p_note,''))>500 then
    raise exception 'Solicitud de corrección inválida'; end if;
  perform 1 from public.finance_spaces where id=p_space_id for update;
  select p.* into v_payment from public.finance_receivable_payments p
    join public.finance_receivables r on r.space_id=p.space_id and r.id=p.receivable_id
    where p.space_id=p_space_id and p.id=p_payment_id
      and r.owner_user_id=(select auth.uid()) for update of p;
  if not found then raise exception 'Pago inexistente o sin permiso'; end if;
  select * into v_source from public.finance_receivables
    where space_id=p_space_id and id=v_payment.receivable_id and owner_user_id=(select auth.uid()) for update;
  if not found then raise exception 'Pago inexistente o sin permiso'; end if;
  if v_payment.payment_reason<>'collection' then
    raise exception 'La devolución de una anulación no puede corregirse como pago'; end if;
  v_payload:=jsonb_build_object('payment',p_payment_id,'revision',p_expected_revision,'action',p_action,
    'target',p_target_receivable_id,'amount',p_amount,'mode',p_mode,'account',p_account_id,'note',coalesce(p_note,''));
  select * into v_prior from public.finance_receivable_payment_revisions
    where space_id=p_space_id and id=p_request_id;
  if found then
    if v_prior.payment_id<>p_payment_id or v_prior.request_payload<>v_payload then
      raise exception 'El identificador de corrección ya se usó con otros datos'; end if;
    return to_jsonb(v_payment);
  end if;
  if v_source.status<>'open' or v_payment.status<>'active' then
    raise exception 'Este pago ya está anulado o la deuda está cerrada'; end if;
  if v_payment.revision<>p_expected_revision then
    raise exception 'El pago cambió. Actualizá el historial antes de corregirlo'; end if;
  v_next_debt:=v_payment.receivable_id;
  v_next_amount:=v_payment.amount;
  v_next_mode:=v_payment.mode;
  v_next_account:=v_payment.account_id;
  v_next_note:=v_payment.note;
  if p_action='edit' then
    if p_target_receivable_id is distinct from v_payment.receivable_id then
      raise exception 'Para cambiar de deuda usá Mover pago'; end if;
    if p_amount is null or p_amount<=0 or not private.valid_money(p_amount,v_source.currency)
       or p_mode is null or p_mode not in ('account','control') then
      raise exception 'Importe o tipo de pago inválido'; end if;
    v_next_amount:=p_amount;v_next_mode:=p_mode;v_next_account:=p_account_id;
    v_next_note:=coalesce(p_note,'');
  elsif p_action='void' then
    if p_target_receivable_id is distinct from v_payment.receivable_id or p_amount is not null
       or p_mode is not null or p_account_id is not null then
      raise exception 'La anulación no acepta otros cambios'; end if;
    v_next_amount:=0;v_next_note:=coalesce(p_note,'');
  else
    if p_target_receivable_id is null or p_target_receivable_id=v_payment.receivable_id
       or p_amount is not null or p_mode is not null or p_account_id is not null then
      raise exception 'Elegí otra deuda para trasladar el pago'; end if;
    select * into v_target from public.finance_receivables
      where space_id=p_space_id and id=p_target_receivable_id
        and owner_user_id=(select auth.uid()) for update;
    if not found or v_target.status<>'open' or v_target.currency<>v_source.currency then
      raise exception 'La deuda de destino debe ser tuya, estar abierta y usar la misma moneda'; end if;
    v_next_debt:=p_target_receivable_id;
  end if;
  if p_action<>'void' then
    select coalesce(sum(amount),0) into v_paid from public.finance_receivable_payments
      where space_id=p_space_id and receivable_id=v_next_debt and status='active' and id<>p_payment_id;
    if v_paid+v_next_amount>(case when p_action='move' then v_target.principal else v_source.principal end) then
      raise exception 'El pago supera el saldo pendiente de la deuda'; end if;
    if v_next_mode='account' then
      if v_next_account is null then raise exception 'Elegí una cuenta receptora'; end if;
      select currency into v_currency from public.finance_accounts
        where space_id=p_space_id and id=v_next_account;
      if v_currency is distinct from v_source.currency then
        raise exception 'La cuenta debe tener la moneda de la deuda'; end if;
    elsif v_next_account is not null then
      raise exception 'Un pago de control no usa cuenta receptora';
    end if;
  end if;
  if p_action='edit' and (v_next_amount,v_next_mode,v_next_account,v_next_note)
      is not distinct from (v_payment.amount,v_payment.mode,v_payment.account_id,v_payment.note) then
    raise exception 'No hay cambios para guardar'; end if;
  v_old_balance:=case when v_payment.mode='account' then v_payment.amount else 0 end;
  v_new_balance:=case when p_action<>'void' and v_next_mode='account' then v_next_amount else 0 end;
  insert into public.finance_receivable_payment_revisions
    (space_id,id,payment_id,revision,action,request_payload,old_receivable_id,new_receivable_id,
      old_amount,new_amount,old_mode,new_mode,old_account_id,new_account_id,old_note,new_note,actor_user_id)
    values(p_space_id,p_request_id,p_payment_id,v_payment.revision+1,p_action,v_payload,
      v_payment.receivable_id,v_next_debt,v_payment.amount,v_next_amount,v_payment.mode,v_next_mode,
      v_payment.account_id,v_next_account,v_payment.note,v_next_note,(select auth.uid()));
  if v_old_balance>0 and v_payment.account_id is not distinct from v_next_account then
    v_old_balance:=greatest(v_old_balance-v_new_balance,0);
    v_new_balance:=greatest(v_new_balance-v_payment.amount,0);
  end if;
  if v_old_balance>0 then
    v_entry_id:='receivable-correction:'||p_request_id::text||':out';
    insert into public.finance_entries(space_id,id,kind,scope,amount,currency,account_id,description,entry_date)
      values(p_space_id,v_entry_id,'expense','receivable',v_old_balance,v_source.currency,
        v_payment.account_id,'Corrección de pago de deuda',current_date);
    insert into public.finance_receivable_payment_postings(space_id,payment_id,entry_id,revision_id)
      values(p_space_id,p_payment_id,v_entry_id,p_request_id);
  end if;
  if v_new_balance>0 then
    v_entry_id:='receivable-correction:'||p_request_id::text||':in';
    insert into public.finance_entries(space_id,id,kind,scope,amount,currency,account_id,description,entry_date)
      values(p_space_id,v_entry_id,'income','receivable',v_new_balance,v_source.currency,
        v_next_account,'Corrección de pago de deuda',current_date);
    insert into public.finance_receivable_payment_postings(space_id,payment_id,entry_id,revision_id)
      values(p_space_id,p_payment_id,v_entry_id,p_request_id);
  end if;
  perform private.assert_finance_balances(p_space_id);
  update public.finance_receivable_payments set receivable_id=v_next_debt,amount=v_next_amount,
    mode=v_next_mode,account_id=case when p_action='void' then account_id else v_next_account end,
    entry_id=case when entry_id is null and v_new_balance>0 then v_entry_id else entry_id end,
    status=case when p_action='void' then 'void' else 'active' end,
    note=v_next_note,revision=revision+1,updated_at=now()
    where space_id=p_space_id and id=p_payment_id returning * into v_payment;
  return to_jsonb(v_payment);
end $$;

revoke all on function public.record_finance_receivable_payment_v2(uuid,uuid,uuid,numeric,text,text,text,text)
  from public,anon;
grant execute on function public.record_finance_receivable_payment_v2(uuid,uuid,uuid,numeric,text,text,text,text)
  to authenticated;
revoke all on function public.correct_finance_receivable_payment(uuid,uuid,uuid,integer,text,uuid,numeric,text,text,text)
  from public,anon;
grant execute on function public.correct_finance_receivable_payment(uuid,uuid,uuid,integer,text,uuid,numeric,text,text,text)
  to authenticated;
