-- Preparación de Web Push. No modifica movimientos ni saldos existentes.
-- Aplicar solo después de revisar el destino Supabase; el webhook se configura aparte.

create table public.finance_push_profiles (
  space_id uuid not null,
  user_id uuid not null,
  display_name text not null check (display_name in ('Dorian', 'Dani')),
  primary key (space_id, user_id),
  unique (space_id, display_name),
  foreign key (space_id, user_id)
    references public.finance_space_members(space_id, user_id) on delete cascade
);

create table public.finance_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  user_id uuid not null,
  endpoint text not null unique check (length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
  p256dh text not null check (length(p256dh) between 20 and 256),
  auth_key text not null check (length(auth_key) between 8 and 256),
  created_at timestamptz not null default now(),
  foreign key (space_id, user_id)
    references public.finance_space_members(space_id, user_id) on delete cascade
);
create index finance_push_subscriptions_space on public.finance_push_subscriptions(space_id);

-- Registro inmutable del alta. La clave (space_id, entry_id) evita repetir el aviso.
create table public.finance_push_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  entry_id text not null,
  actor_user_id uuid not null,
  actor_name text not null,
  amount numeric(24,6) not null check (amount > 0),
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  category_name text not null,
  created_at timestamptz not null default now(),
  unique (space_id, entry_id)
);

-- Un intento por dispositivo y evento. Evita repetir envíos si el webhook reintenta.
create table public.finance_push_deliveries (
  event_id uuid not null references public.finance_push_events(id) on delete cascade,
  subscription_id uuid not null references public.finance_push_subscriptions(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  error_status text,
  primary key (event_id, subscription_id)
);

alter table public.finance_push_profiles enable row level security;
alter table public.finance_push_subscriptions enable row level security;
alter table public.finance_push_events enable row level security;
alter table public.finance_push_deliveries enable row level security;

revoke all on public.finance_push_profiles, public.finance_push_subscriptions,
  public.finance_push_events, public.finance_push_deliveries from public, anon, authenticated;
grant select, insert, update on public.finance_push_profiles to authenticated;
grant select, insert, update, delete on public.finance_push_subscriptions to authenticated;
grant all on public.finance_push_events, public.finance_push_deliveries to service_role;
grant all on public.finance_push_profiles, public.finance_push_subscriptions to service_role;

create policy finance_push_profiles_read on public.finance_push_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_finance_member(space_id));
create policy finance_push_profiles_insert on public.finance_push_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_finance_member(space_id));
create policy finance_push_profiles_update on public.finance_push_profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_finance_member(space_id))
  with check (user_id = (select auth.uid()) and private.is_finance_member(space_id));

create policy finance_push_subscriptions_read on public.finance_push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_finance_member(space_id));
create policy finance_push_subscriptions_insert on public.finance_push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_finance_member(space_id));
create policy finance_push_subscriptions_update on public.finance_push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_finance_member(space_id))
  with check (user_id = (select auth.uid()) and private.is_finance_member(space_id));
create policy finance_push_subscriptions_delete on public.finance_push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_finance_member(space_id));

-- Sin políticas para authenticated en eventos ni entregas: solo servicio y trigger.
create function private.enqueue_personal_expense_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_name text;
  v_category text;
begin
  if v_user is null or not private.is_finance_member(new.space_id) then
    return new;
  end if;
  select p.display_name into v_name from public.finance_push_profiles p
    where p.space_id = new.space_id and p.user_id = v_user;
  select c.name into v_category from public.finance_categories c
    where c.space_id = new.space_id and c.id = new.category_id;
  insert into public.finance_push_events
    (space_id, entry_id, actor_user_id, actor_name, amount, currency, category_name)
  values
    (new.space_id, new.id, v_user, coalesce(v_name, 'Un miembro'),
     new.amount, new.currency, left(coalesce(v_category, 'Sin categoría'), 120))
  on conflict (space_id, entry_id) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_personal_expense_push() from public, anon, authenticated;

create trigger finance_personal_expense_push_insert
after insert on public.finance_entries
for each row when (new.kind = 'expense' and new.scope = 'everyday')
execute function private.enqueue_personal_expense_push();
