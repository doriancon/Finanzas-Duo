-- Perfiles y preferencias por espacio. Los valores por defecto conservan el espacio actual.
create table public.finance_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80)
);

alter table public.finance_push_profiles
  drop constraint if exists finance_push_profiles_display_name_check;
alter table public.finance_push_profiles
  drop constraint if exists finance_push_profiles_space_id_display_name_key;
alter table public.finance_push_profiles
  add constraint finance_push_profiles_name_length check (length(btrim(display_name)) between 1 and 80);

insert into public.finance_user_profiles(user_id, display_name)
select distinct on (user_id) user_id, display_name
from public.finance_push_profiles
order by user_id, space_id
on conflict (user_id) do nothing;

create function private.valid_finance_currencies(p_currencies text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_currencies is not null and cardinality(p_currencies) between 1 and 4
    and p_currencies <@ array['ARS','BOB','USD','USDT']::text[]
    and cardinality(p_currencies) = (
      select count(distinct currency) from unnest(p_currencies) as currencies(currency)
    )
$$;

create table public.finance_space_settings (
  space_id uuid primary key references public.finance_spaces(id) on delete cascade,
  show_giros boolean not null default true,
  show_business boolean not null default true,
  enabled_currencies text[] not null default array['ARS','BOB','USD','USDT']::text[],
  check (private.valid_finance_currencies(enabled_currencies))
);

insert into public.finance_space_settings(space_id)
select id from public.finance_spaces;

-- Atribución solo para movimientos nuevos. Los históricos conservan sus datos
-- originales y se muestran sin autor cuando no había información de origen.
alter table public.finance_entries
  add column actor_user_id uuid references auth.users(id) on delete set null,
  add column actor_name text;

create function private.stamp_finance_entry_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.actor_user_id := auth.uid();
  if new.actor_user_id is not null then
    select display_name into new.actor_name from public.finance_user_profiles
      where user_id = new.actor_user_id;
  end if;
  return new;
end $$;
create trigger finance_entry_actor_insert before insert on public.finance_entries
  for each row execute function private.stamp_finance_entry_actor();

-- Los giros vinculados siguen siendo inmutables. La única actualización
-- adicional permitida es anonimizar exactamente los dos campos de autoría.
create or replace function private.guard_linked_finance_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (
      select 1 from public.finance_spaces where id = old.space_id
    ) then return old; end if;
  if tg_op = 'UPDATE' then
    if old.actor_user_id is not null and new.actor_user_id is null
        and new.actor_name = 'Miembro anterior'
        and (to_jsonb(new) - 'actor_user_id' - 'actor_name') =
            (to_jsonb(old) - 'actor_user_id' - 'actor_name') then
      return new;
    end if;
  end if;
  if exists(select 1 from public.finance_giro_links where space_id=old.space_id and
      (giro_id=old.id or transfer_id=old.id)) or
     exists(select 1 from public.finance_giro_results where space_id=old.space_id and giro_id=old.id) then
    raise exception 'Quitá los vínculos antes de editar o borrar este movimiento; las ganancias confirmadas son históricas';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- El borrado de resultados y movimientos vinculados solo se permite cuando
-- la eliminación del único integrante ya quitó el espacio padre.
create or replace function private.check_finance_giro_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_giro public.finance_entries%rowtype; v_currency text; v_linked_cost numeric;
begin
  if tg_op = 'DELETE' and not exists (
      select 1 from public.finance_spaces where id = old.space_id
    ) then return old; end if;
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

create or replace function private.guard_finance_giro_cash_plan_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_planned numeric;
begin
  if tg_op = 'DELETE' and not exists (
      select 1 from public.finance_spaces where id = old.space_id
    ) then return old; end if;
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

alter table public.finance_user_profiles enable row level security;
alter table public.finance_space_settings enable row level security;
revoke all on public.finance_user_profiles, public.finance_space_settings from public, anon, authenticated;
grant select, insert, update on public.finance_user_profiles to authenticated;
grant select on public.finance_space_settings to authenticated;

create policy finance_user_profiles_read on public.finance_user_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy finance_user_profiles_insert on public.finance_user_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_user_profiles_update on public.finance_user_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy finance_space_settings_read on public.finance_space_settings for select to authenticated
  using (private.is_finance_member(space_id));

-- Un solo RPC actualiza nombre y preferencias bajo el candado del espacio.
create function public.configure_finance_space(
  p_space_id uuid, p_name text, p_show_giros boolean,
  p_show_business boolean, p_enabled_currencies text[]
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_finance_owner(p_space_id) then
    raise exception 'Solo quien administra el espacio puede cambiar su configuración';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80
      or p_show_giros is null or p_show_business is null
      or not private.valid_finance_currencies(p_enabled_currencies) then
    raise exception 'Configuración inválida';
  end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  if not found then raise exception 'Espacio inexistente'; end if;
  if not private.is_finance_owner(p_space_id) then raise exception 'Acceso revocado'; end if;
  update public.finance_spaces set name = btrim(p_name) where id = p_space_id;
  insert into public.finance_space_settings
    (space_id, show_giros, show_business, enabled_currencies)
  values (p_space_id, p_show_giros, p_show_business, p_enabled_currencies)
  on conflict (space_id) do update set
    show_giros = excluded.show_giros,
    show_business = excluded.show_business,
    enabled_currencies = excluded.enabled_currencies;
end $$;

-- El dueño transfiere la administración antes de salir de un espacio compartido.
create function public.transfer_finance_space_owner(p_space_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old_owner uuid := auth.uid();
begin
  if not private.is_finance_owner(p_space_id) or p_new_owner = v_old_owner then
    raise exception 'No podés transferir este espacio';
  end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  if not private.is_finance_owner(p_space_id) then raise exception 'Acceso revocado'; end if;
  if not exists (select 1 from public.finance_space_members
      where space_id = p_space_id and user_id = p_new_owner) then
    raise exception 'La otra persona debe pertenecer a este espacio';
  end if;
  update public.finance_space_members set role = 'member'
    where space_id = p_space_id and user_id = v_old_owner and role = 'owner';
  update public.finance_space_members set role = 'owner'
    where space_id = p_space_id and user_id = p_new_owner;
  update public.finance_spaces set created_by = p_new_owner where id = p_space_id;
end $$;

-- Auth admin.deleteUser y este trigger comparten una transacción. No hay borrado
-- parcial: si una relación o permiso falla, tampoco desaparece auth.users.
create table private.finance_deletion_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid references public.finance_spaces(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  check (user_id is not null or space_id is not null)
);
revoke all on private.finance_deletion_holds from public, anon, authenticated;

create function private.cleanup_finance_deleted_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member record; v_members integer;
begin
  if exists (select 1 from private.finance_deletion_holds h
      where h.user_id = old.id or h.space_id in
        (select space_id from public.finance_space_members where user_id = old.id)) then
    raise exception 'La eliminación está bloqueada por una obligación de conservación';
  end if;
  for v_member in select space_id, role from public.finance_space_members
      where user_id = old.id loop
    perform 1 from public.finance_spaces where id = v_member.space_id for update;
    select count(*) into v_members from public.finance_space_members
      where space_id = v_member.space_id;
    if v_members = 1 then
      -- Esta tabla no tiene FK directa al espacio ni ON DELETE CASCADE.
      delete from public.finance_giro_cash_plans where space_id = v_member.space_id;
      delete from public.finance_spaces where id = v_member.space_id;
    elsif v_member.role = 'owner' then
      raise exception 'Transferí la administración antes de eliminar tu cuenta';
    else
      delete from public.finance_space_members
        where space_id = v_member.space_id and user_id = old.id;
    end if;
  end loop;
  -- Revocar invitaciones personales, incluso si el usuario ya dejó el espacio.
  delete from public.finance_space_invites
    where created_by = old.id or consumed_by = old.id;
  -- Solo se anonimizan filas atribuidas a esta cuenta. Ningún importe cambia.
  update public.finance_push_events
    set actor_user_id = null, actor_name = 'Miembro anterior'
    where actor_user_id = old.id;
  update public.finance_entries
    set actor_user_id = null, actor_name = 'Miembro anterior'
    where actor_user_id = old.id;
  -- Las respuestas de idempotencia también guardan una copia JSON del movimiento.
  update public.finance_entry_requests
    set result_entry = jsonb_set(
      jsonb_set(result_entry, '{actor_user_id}', 'null'::jsonb),
      '{actor_name}', to_jsonb('Miembro anterior'::text))
    where result_entry->>'actor_user_id' = old.id::text;
  return old;
end $$;

alter table public.finance_push_events alter column actor_user_id drop not null;
create trigger finance_auth_user_delete before delete on auth.users
  for each row execute function private.cleanup_finance_deleted_user();

-- Los nuevos avisos usan el perfil del usuario; los nombres antiguos se conservan.
create or replace function private.enqueue_personal_expense_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_name text;
  v_category text;
begin
  if v_user is null or not private.is_finance_member(new.space_id) then return new; end if;
  select p.display_name into v_name from public.finance_user_profiles p where p.user_id = v_user;
  if v_name is null then
    select p.display_name into v_name from public.finance_push_profiles p
      where p.space_id = new.space_id and p.user_id = v_user;
  end if;
  select c.name into v_category from public.finance_categories c
    where c.space_id = new.space_id and c.id = new.category_id;
  insert into public.finance_push_events
    (space_id, entry_id, actor_user_id, actor_name, amount, currency, category_name)
  values (new.space_id, new.id, v_user, coalesce(v_name, 'Un miembro'),
    new.amount, new.currency, left(coalesce(v_category, 'Sin categoría'), 120))
  on conflict (space_id, entry_id) do nothing;
  return new;
end $$;

revoke all on function private.valid_finance_currencies(text[]),
  private.cleanup_finance_deleted_user(), private.stamp_finance_entry_actor()
  from public, anon, authenticated;
revoke all on function public.configure_finance_space(uuid,text,boolean,boolean,text[]),
  public.transfer_finance_space_owner(uuid,uuid) from public, anon;
grant execute on function public.configure_finance_space(uuid,text,boolean,boolean,text[]),
  public.transfer_finance_space_owner(uuid,uuid) to authenticated;
