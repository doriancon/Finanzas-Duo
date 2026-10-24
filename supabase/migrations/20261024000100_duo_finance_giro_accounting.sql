-- Etapa 2: vínculos contables; no mueve dinero ni reescribe finance_entries.
create table public.finance_giro_links (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  giro_id text not null,
  transfer_id text not null,
  from_amount numeric(24,6) not null check (from_amount > 0),
  to_amount numeric(24,6) not null check (to_amount > 0),
  created_at timestamptz not null default now(),
  primary key (space_id,id),
  unique (space_id,giro_id,transfer_id),
  foreign key (space_id,giro_id) references public.finance_entries(space_id,id),
  foreign key (space_id,transfer_id) references public.finance_entries(space_id,id)
);
create index finance_giro_links_giro on public.finance_giro_links(space_id,giro_id);
create index finance_giro_links_transfer on public.finance_giro_links(space_id,transfer_id);

create table public.finance_giro_results (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  giro_id text not null,
  cost_ars numeric(24,6) not null check (cost_ars > 0 and private.valid_money(cost_ars,'ARS')),
  fees_ars numeric(24,6) not null check (fees_ars >= 0 and private.valid_money(fees_ars,'ARS')),
  profit_ars numeric(24,6) not null,
  evidence text not null check (length(btrim(evidence)) between 8 and 500),
  confirmed_at timestamptz not null default now(),
  recognized_month text not null check (private.valid_month(recognized_month)),
  primary key (space_id,giro_id),
  foreign key (space_id,giro_id) references public.finance_entries(space_id,id)
);

create function private.check_finance_giro_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_giro public.finance_entries%rowtype; v_move public.finance_entries%rowtype;
  v_target text; v_used_from numeric; v_used_to numeric; v_confirmed_cost numeric; v_ars_cost numeric; v_recovered numeric;
  v_tolerance numeric;
begin
  if not private.is_finance_member(new.space_id) then raise exception 'No pertenecés a este espacio'; end if;
  perform 1 from public.finance_spaces where id=new.space_id for update;
  if tg_op='UPDATE' and (new.space_id,new.id,new.giro_id,new.transfer_id) is distinct from
      (old.space_id,old.id,old.giro_id,old.transfer_id) then raise exception 'No cambies la identidad del vínculo'; end if;
  select * into v_giro from public.finance_entries where space_id=new.space_id and id=new.giro_id;
  select * into v_move from public.finance_entries where space_id=new.space_id and id=new.transfer_id;
  if v_giro.kind is distinct from 'giro' or v_move.kind is distinct from 'transfer' then
    raise exception 'El vínculo requiere un giro y un movimiento de cambio'; end if;
  select cost_ars into v_confirmed_cost from public.finance_giro_results
    where space_id=new.space_id and giro_id=new.giro_id;
  if tg_op='UPDATE' and v_confirmed_cost is not null then
    raise exception 'Una asignación de un giro confirmado no se puede editar'; end if;
  select currency into v_target from public.finance_accounts where space_id=new.space_id and id=v_move.to_account_id;
  if v_target is null or v_target=v_move.currency or
      not private.valid_money(new.from_amount,v_move.currency) or not private.valid_money(new.to_amount,v_target) then
    raise exception 'Importes o monedas del cambio inválidos'; end if;
  v_tolerance := case when v_target='USDT' then 0.000001 else 0.01 end;
  if abs(new.to_amount - round(v_move.received * new.from_amount / v_move.amount,
      case when v_target='USDT' then 6 else 2 end)) > v_tolerance then
    raise exception 'La parte recibida no corresponde a la parte entregada'; end if;
  select coalesce(sum(from_amount),0),coalesce(sum(to_amount),0) into v_used_from,v_used_to
    from public.finance_giro_links where space_id=new.space_id and transfer_id=new.transfer_id
      and id<>new.id;
  if v_used_from+new.from_amount>v_move.amount or v_used_to+new.to_amount>v_move.received then
    raise exception 'El cambio ya está asignado a otros giros'; end if;
  if v_target=v_giro.currency then
    select coalesce(sum(l.to_amount),0) into v_recovered from public.finance_giro_links l
      join public.finance_entries e on e.space_id=l.space_id and e.id=l.transfer_id
      join public.finance_accounts a on a.space_id=e.space_id and a.id=e.to_account_id
      where l.space_id=new.space_id and l.giro_id=new.giro_id and a.currency=v_giro.currency and l.id<>new.id;
    if v_recovered+new.to_amount>v_giro.amount then
      raise exception 'La reposición supera el capital entregado en este giro'; end if;
  end if;
  if v_confirmed_cost is not null and v_move.currency='ARS' then
    select coalesce(sum(l.from_amount),0) into v_ars_cost from public.finance_giro_links l
      join public.finance_entries e on e.space_id=l.space_id and e.id=l.transfer_id
      where l.space_id=new.space_id and l.giro_id=new.giro_id and e.currency='ARS' and l.id<>new.id;
    if v_ars_cost+new.from_amount>v_confirmed_cost then
      raise exception 'La reposición supera el costo ARS ya confirmado'; end if;
  end if;
  return new;
end $$;

create function private.check_finance_giro_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_giro public.finance_entries%rowtype; v_currency text; v_linked_cost numeric;
begin
  if tg_op<>'INSERT' then raise exception 'Una ganancia confirmada no se puede alterar'; end if;
  if not private.is_finance_member(new.space_id) then raise exception 'No pertenecés a este espacio'; end if;
  perform 1 from public.finance_spaces where id=new.space_id for update;
  select * into v_giro from public.finance_entries where space_id=new.space_id and id=new.giro_id;
  select currency into v_currency from public.finance_accounts where space_id=new.space_id and id=v_giro.to_account_id;
  if v_giro.kind is distinct from 'giro' or v_currency is distinct from 'ARS' then
    raise exception 'Solo se confirma una ganancia de un giro cobrado en ARS'; end if;
  select coalesce(sum(l.from_amount),0) into v_linked_cost from public.finance_giro_links l
    join public.finance_entries e on e.space_id=l.space_id and e.id=l.transfer_id
    where l.space_id=new.space_id and l.giro_id=new.giro_id and e.currency='ARS';
  if new.cost_ars<v_linked_cost then raise exception 'El costo declarado no cubre los ARS vinculados'; end if;
  new.profit_ars:=v_giro.received-new.cost_ars-new.fees_ars;
  new.confirmed_at:=now();
  new.recognized_month:=to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM');
  return new;
end $$;

create function private.guard_linked_finance_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.finance_giro_links where space_id=old.space_id and
      (giro_id=old.id or transfer_id=old.id)) or
     exists(select 1 from public.finance_giro_results where space_id=old.space_id and giro_id=old.id) then
    raise exception 'Quitá los vínculos antes de editar o borrar este movimiento; las ganancias confirmadas son históricas';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger finance_giro_links_guard before insert or update on public.finance_giro_links
  for each row execute function private.check_finance_giro_link();
create trigger finance_giro_results_guard before insert or update or delete on public.finance_giro_results
  for each row execute function private.check_finance_giro_result();
create trigger finance_entries_link_guard before update or delete on public.finance_entries
  for each row execute function private.guard_linked_finance_entry();

alter table public.finance_giro_links enable row level security;
alter table public.finance_giro_results enable row level security;
create policy finance_giro_links_read on public.finance_giro_links for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_giro_links_insert on public.finance_giro_links for insert to authenticated
  with check (private.is_finance_member(space_id));
create policy finance_giro_links_update on public.finance_giro_links for update to authenticated
  using (private.is_finance_member(space_id)) with check (private.is_finance_member(space_id));
create policy finance_giro_links_delete on public.finance_giro_links for delete to authenticated
  using (private.is_finance_member(space_id) and not exists
    (select 1 from public.finance_giro_results r where r.space_id=public.finance_giro_links.space_id
      and r.giro_id=public.finance_giro_links.giro_id));
create policy finance_giro_results_read on public.finance_giro_results for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_giro_results_insert on public.finance_giro_results for insert to authenticated
  with check (private.is_finance_member(space_id));
-- Supabase puede conceder permisos iniciales sobre tablas nuevas en public.
-- Revocarlos explícitamente mantiene el mismo criterio que la migración de acceso.
revoke all on public.finance_giro_links, public.finance_giro_results from public, anon, authenticated;
grant select,insert,update,delete on public.finance_giro_links to authenticated;
grant select,insert on public.finance_giro_results to authenticated;
revoke all on function private.check_finance_giro_link(),private.check_finance_giro_result(),
  private.guard_linked_finance_entry() from public,anon,authenticated;
