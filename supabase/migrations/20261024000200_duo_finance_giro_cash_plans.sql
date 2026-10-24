-- Decisiones informativas sobre el destino de los ARS cobrados en un giro.
-- No crea movimientos ni modifica cuentas, saldos o registros históricos.
create table public.finance_giro_cash_plans (
  space_id uuid not null,
  giro_id text not null,
  purpose text not null check (purpose in ('recover','keep','free')),
  amount_ars numeric(24,6) not null check (amount_ars > 0 and private.valid_money(amount_ars,'ARS')),
  target_currency text check (target_currency in ('ARS','BOB','USD','USDT')),
  created_at timestamptz not null default now(),
  primary key (space_id,giro_id,purpose),
  foreign key (space_id,giro_id) references public.finance_entries(space_id,id),
  check ((purpose='recover' and target_currency is not null) or
    (purpose<>'recover' and target_currency is null))
);

create function private.check_finance_giro_cash_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_giro public.finance_entries%rowtype; v_currency text; v_other numeric;
begin
  if not private.is_finance_member(new.space_id) then
    raise exception 'No pertenecés a este espacio';
  end if;
  perform 1 from public.finance_spaces where id=new.space_id for update;
  if tg_op='UPDATE' and (new.space_id,new.giro_id,new.purpose) is distinct from
      (old.space_id,old.giro_id,old.purpose) then
    raise exception 'No cambies la identidad del destino';
  end if;
  select * into v_giro from public.finance_entries
    where space_id=new.space_id and id=new.giro_id;
  select currency into v_currency from public.finance_accounts
    where space_id=new.space_id and id=v_giro.to_account_id;
  if v_giro.kind is distinct from 'giro' or v_currency is distinct from 'ARS' then
    raise exception 'El destino requiere un giro cobrado en ARS';
  end if;
  select coalesce(sum(amount_ars),0) into v_other from public.finance_giro_cash_plans
    where space_id=new.space_id and giro_id=new.giro_id and purpose<>new.purpose;
  if v_other+new.amount_ars>v_giro.received then
    raise exception 'Los destinos superan el importe cobrado';
  end if;
  return new;
end $$;

create function private.guard_finance_giro_cash_plan_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_planned numeric;
begin
  select coalesce(sum(amount_ars),0) into v_planned from public.finance_giro_cash_plans
    where space_id=old.space_id and giro_id=old.id;
  if v_planned>0 then
    if tg_op='DELETE' then
      raise exception 'Quitá el destino del cobro antes de borrar este giro';
    end if;
    if new.kind is distinct from 'giro' or new.to_account_id is distinct from old.to_account_id or
        new.received<v_planned then
      raise exception 'Quitá o ajustá el destino del cobro antes de modificar este giro';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Guarda las tres decisiones juntas para evitar estados parciales entre dispositivos.
create function public.set_finance_giro_cash_plans(p_space_id uuid,p_giro_id text,p_plans jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_giro public.finance_entries%rowtype; v_currency text; v_total numeric;
begin
  if not private.is_finance_member(p_space_id) then
    raise exception 'No pertenecés a este espacio';
  end if;
  perform 1 from public.finance_spaces where id=p_space_id for update;
  select * into v_giro from public.finance_entries
    where space_id=p_space_id and id=p_giro_id;
  select currency into v_currency from public.finance_accounts
    where space_id=p_space_id and id=v_giro.to_account_id;
  if v_giro.kind is distinct from 'giro' or v_currency is distinct from 'ARS' then
    raise exception 'El destino requiere un giro cobrado en ARS';
  end if;
  if jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'Destinos inválidos';
  end if;
  if jsonb_array_length(p_plans)>3 then
    raise exception 'Destinos inválidos';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_plans) as p(purpose text,amount_ars numeric,target_currency text)
      where p.purpose is null or p.purpose not in ('recover','keep','free') or
        p.amount_ars is null or p.amount_ars<=0 or not private.valid_money(p.amount_ars,'ARS') or
        (p.purpose='recover' and (p.target_currency is null or p.target_currency not in ('ARS','BOB','USD','USDT'))) or
        (p.purpose<>'recover' and p.target_currency is not null)) then
    raise exception 'Importes de destino inválidos';
  end if;
  select coalesce(sum(p.amount_ars),0) into v_total
    from jsonb_to_recordset(p_plans) as p(purpose text,amount_ars numeric);
  if v_total>v_giro.received then
    raise exception 'Los destinos superan el importe cobrado';
  end if;
  delete from public.finance_giro_cash_plans where space_id=p_space_id and giro_id=p_giro_id;
  insert into public.finance_giro_cash_plans(space_id,giro_id,purpose,amount_ars,target_currency)
    select p_space_id,p_giro_id,p.purpose,p.amount_ars,p.target_currency
    from jsonb_to_recordset(p_plans) as p(purpose text,amount_ars numeric,target_currency text);
end $$;

create trigger finance_giro_cash_plans_guard before insert or update on public.finance_giro_cash_plans
  for each row execute function private.check_finance_giro_cash_plan();
create trigger finance_entries_cash_plan_guard before update or delete on public.finance_entries
  for each row execute function private.guard_finance_giro_cash_plan_entry();

alter table public.finance_giro_cash_plans enable row level security;
create policy finance_giro_cash_plans_read on public.finance_giro_cash_plans for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_giro_cash_plans_insert on public.finance_giro_cash_plans for insert to authenticated
  with check (private.is_finance_member(space_id));
create policy finance_giro_cash_plans_update on public.finance_giro_cash_plans for update to authenticated
  using (private.is_finance_member(space_id)) with check (private.is_finance_member(space_id));
create policy finance_giro_cash_plans_delete on public.finance_giro_cash_plans for delete to authenticated
  using (private.is_finance_member(space_id));
revoke all on public.finance_giro_cash_plans from public,anon,authenticated;
grant select,insert,update,delete on public.finance_giro_cash_plans to authenticated;
revoke all on function private.check_finance_giro_cash_plan(),
  private.guard_finance_giro_cash_plan_entry() from public,anon,authenticated;
revoke all on function public.set_finance_giro_cash_plans(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_finance_giro_cash_plans(uuid,text,jsonb) to authenticated;
