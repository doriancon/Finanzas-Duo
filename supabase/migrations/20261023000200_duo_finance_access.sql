-- Todas las tablas expuestas quedan cerradas por defecto.
alter table public.finance_spaces enable row level security;
alter table public.finance_space_members enable row level security;
alter table public.finance_space_invites enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_income_sources enable row level security;
alter table public.finance_funds enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_business_openings enable row level security;
alter table public.finance_income_goals enable row level security;
alter table public.finance_income_quotes enable row level security;
alter table public.finance_entries enable row level security;
alter table public.finance_entry_requests enable row level security;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.valid_money(numeric,text), private.valid_month(text) to authenticated;

create function private.is_finance_member(p_space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.finance_space_members m
    where m.space_id = p_space_id and m.user_id = (select auth.uid())
  )
$$;

create function private.is_finance_owner(p_space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.finance_space_members m
    where m.space_id = p_space_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  )
$$;

revoke all on function private.is_finance_member(uuid) from public, anon;
revoke all on function private.is_finance_owner(uuid) from public, anon;
grant execute on function private.is_finance_member(uuid), private.is_finance_owner(uuid) to authenticated;

-- Supabase puede conceder permisos de tabla por defecto al esquema public.
-- Se revocan por nombre, sin tocar tablas ajenas que ya existan en el proyecto.
do $$
declare t text;
begin
  foreach t in array array[
    'finance_spaces', 'finance_space_members', 'finance_space_invites',
    'finance_accounts', 'finance_categories', 'finance_income_sources',
    'finance_funds', 'finance_budgets', 'finance_business_openings',
    'finance_income_goals', 'finance_income_quotes', 'finance_entries',
    'finance_entry_requests'
  ] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant select on public.finance_spaces, public.finance_space_members, public.finance_accounts,
  public.finance_categories, public.finance_income_sources, public.finance_funds,
  public.finance_budgets, public.finance_business_openings, public.finance_income_goals,
  public.finance_income_quotes, public.finance_entries to authenticated;
grant select, insert, update, delete on public.finance_categories, public.finance_income_sources,
  public.finance_funds, public.finance_business_openings, public.finance_income_goals,
  public.finance_income_quotes to authenticated;
grant select, update on public.finance_budgets to authenticated;
grant select on public.finance_space_invites to authenticated;

create policy finance_spaces_read on public.finance_spaces for select to authenticated
  using (private.is_finance_member(id));
create policy finance_members_read on public.finance_space_members for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_invites_owner_read on public.finance_space_invites for select to authenticated
  using (private.is_finance_owner(space_id));
create policy finance_accounts_read on public.finance_accounts for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_entries_read on public.finance_entries for select to authenticated
  using (private.is_finance_member(space_id));

do $$
declare t text;
begin
  foreach t in array array[
    'finance_categories', 'finance_income_sources', 'finance_funds',
    'finance_business_openings', 'finance_income_goals', 'finance_income_quotes'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_finance_member(space_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_finance_member(space_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_finance_member(space_id)) with check (private.is_finance_member(space_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.is_finance_member(space_id))', t || '_delete', t);
  end loop;
end $$;
create policy finance_budgets_read on public.finance_budgets for select to authenticated
  using (private.is_finance_member(space_id));
create policy finance_budgets_update on public.finance_budgets for update to authenticated
  using (private.is_finance_member(space_id)) with check (private.is_finance_member(space_id));

-- Un fondo con movimientos conserva la moneda. El Pasanaco usa una cuenta de su moneda.
create function private.check_finance_fund()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_currency text;
begin
  perform 1 from public.finance_spaces where id = new.space_id for update;
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id or new.id <> old.id or new.kind <> old.kind then
      raise exception 'No se puede cambiar la identidad de un fondo';
    end if;
    if new.currency <> old.currency and exists (
      select 1 from public.finance_entries e where e.space_id = old.space_id and e.fund_id = old.id
    ) then
      raise exception 'No se puede cambiar la moneda de un fondo con movimientos';
    end if;
  end if;
  if new.kind = 'pasanaco' then
    select a.currency into v_currency from public.finance_accounts a
    where a.space_id = new.space_id and a.id = new.source_account_id;
    if v_currency is distinct from new.currency then
      raise exception 'La cuenta habitual debe tener la moneda del Pasanaco';
    end if;
  end if;
  return new;
end $$;
create trigger finance_funds_guard before insert or update on public.finance_funds
  for each row execute function private.check_finance_fund();
revoke all on function private.check_finance_fund() from public, anon, authenticated;

-- El dueño crea un único espacio y se generan los mismos catálogos iniciales del frontend.
create function public.create_finance_space(p_name text default 'Dorian & Dani')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_space uuid;
begin
  if v_user is null then raise exception 'Iniciá sesión para crear el espacio'; end if;
  if exists (select 1 from public.finance_space_members where user_id = v_user) then
    raise exception 'Este usuario ya pertenece a un espacio financiero';
  end if;
  insert into public.finance_spaces(name, created_by) values (p_name, v_user) returning id into v_space;
  insert into public.finance_space_members(space_id, user_id, role) values (v_space, v_user, 'owner');
  insert into public.finance_accounts(space_id, id, currency, method, name) values
    (v_space,'ARS-efectivo','ARS','Efectivo','Efectivo'),
    (v_space,'ARS-transferencia','ARS','Transferencia','Transferencia'),
    (v_space,'BOB-efectivo','BOB','Efectivo','Efectivo'),
    (v_space,'BOB-transferencia','BOB','Transferencia','Transferencia'),
    (v_space,'USD-efectivo','USD','Efectivo','Efectivo'),
    (v_space,'USDT-billetera','USDT','Billetera','Billetera');
  insert into public.finance_categories(space_id,id,name,color,icon) values
    (v_space,'gasolina','Gasolina','#8c5cf6','fuel'),
    (v_space,'alimentacion','Alimentación','#ffad72','food'),
    (v_space,'compras','Compras','#82c9e9','shopping'),
    (v_space,'otros','Otros','#eadc8e','layers'),
    (v_space,'vivienda','Vivienda','#b1a5f4','house'),
    (v_space,'transporte','Transporte','#9edfc2','car'),
    (v_space,'servicios','Servicios','#f4a6bd','bolt'),
    (v_space,'entretenimiento','Entretenimiento','#83b6fb','sparkles'),
    (v_space,'salud','Salud','#b7d5a4','heart'),
    (v_space,'materiales','Materiales','#e6a3c8','shopping'),
    (v_space,'confeccion','Confección','#c79ae8','sparkles'),
    (v_space,'operativos','Operativos','#ecc486','layers'),
    (v_space,'telas','Telas','#d58bd1','shopping'),
    (v_space,'insumos','Insumos','#9a86e9','layers'),
    (v_space,'empaques','Empaques','#d8b57c','layers'),
    (v_space,'elasticos','Elásticos','#86bfca','layers');
  insert into public.finance_income_sources(space_id,id,name) values
    (v_space,'sueldo','Sueldo fijo'),
    (v_space,'emprendimiento','Emprendimiento'),
    (v_space,'independiente','Trabajo independiente'),
    (v_space,'adicional','Ingreso adicional'),
    (v_space,'otro','Otro');
  insert into public.finance_budgets(space_id) values (v_space);
  return v_space;
end $$;

create function public.create_finance_invite(p_space_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  if not private.is_finance_owner(p_space_id) then raise exception 'Solo el dueño puede invitar'; end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  if (select count(*) from public.finance_space_members where space_id = p_space_id) >= 2 then
    raise exception 'El espacio ya tiene dos miembros';
  end if;
  insert into public.finance_space_invites(space_id, created_by)
    values (p_space_id, auth.uid()) returning token into v_token;
  return v_token;
end $$;

create function public.accept_finance_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_invite public.finance_space_invites%rowtype;
begin
  if v_user is null then raise exception 'Iniciá sesión para aceptar la invitación'; end if;
  if exists (select 1 from public.finance_space_members where user_id = v_user) then
    raise exception 'Este usuario ya pertenece a un espacio financiero';
  end if;
  select * into v_invite from public.finance_space_invites where token = p_token for update;
  if not found or v_invite.consumed_by is not null or v_invite.expires_at <= now() then
    raise exception 'La invitación no existe o venció';
  end if;
  perform 1 from public.finance_spaces where id = v_invite.space_id for update;
  if (select count(*) from public.finance_space_members where space_id = v_invite.space_id) >= 2 then
    raise exception 'El espacio ya tiene dos miembros';
  end if;
  insert into public.finance_space_members(space_id,user_id,role)
    values (v_invite.space_id,v_user,'member');
  update public.finance_space_invites set consumed_by = v_user where token = p_token;
  return v_invite.space_id;
end $$;

revoke all on function public.create_finance_space(text), public.create_finance_invite(uuid),
  public.accept_finance_invite(uuid) from public, anon;
grant execute on function public.create_finance_space(text), public.create_finance_invite(uuid),
  public.accept_finance_invite(uuid) to authenticated;
