-- Duo Finance, etapa 2. Esquema vacío: no importa datos del navegador.
create schema if not exists private;

create function private.valid_money(p_amount numeric, p_currency text)
returns boolean language sql immutable set search_path = '' as $$
  select p_amount is not null
    and p_currency in ('ARS', 'BOB', 'USD', 'USDT')
    and p_amount = round(p_amount, case when p_currency = 'USDT' then 6 else 2 end)
$$;

create function private.valid_month(p_month text)
returns boolean language sql immutable set search_path = '' as $$
  select p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
$$;

create table public.finance_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.finance_space_members (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id),
  unique (user_id)
);
create unique index finance_one_owner_per_space on public.finance_space_members(space_id) where role = 'owner';

create table public.finance_space_invites (
  token uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index finance_invites_space on public.finance_space_invites(space_id);

create table public.finance_accounts (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null,
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  method text not null check (method in ('Efectivo', 'Transferencia', 'Billetera')),
  name text not null check (length(btrim(name)) > 0),
  opening numeric(24,6) not null default 0,
  primary key (space_id, id),
  unique (space_id, currency, method),
  check (private.valid_money(opening, currency)),
  check ((id, currency, method) in (
    ('ARS-efectivo', 'ARS', 'Efectivo'),
    ('ARS-transferencia', 'ARS', 'Transferencia'),
    ('BOB-efectivo', 'BOB', 'Efectivo'),
    ('BOB-transferencia', 'BOB', 'Transferencia'),
    ('USD-efectivo', 'USD', 'Efectivo'),
    ('USDT-billetera', 'USDT', 'Billetera')
  ))
);

create table public.finance_categories (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null,
  archived boolean not null default false,
  primary key (space_id, id)
);
create unique index finance_categories_name on public.finance_categories(space_id, lower(name));

create table public.finance_income_sources (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  archived boolean not null default false,
  primary key (space_id, id)
);
create unique index finance_income_sources_name on public.finance_income_sources(space_id, lower(name));

-- Goal y Pasanaco comparten un registro de fondo para que fund_id tenga FK real.
create table public.finance_funds (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('goal', 'pasanaco')),
  name text not null check (length(btrim(name)) > 0),
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  target numeric(24,6),
  target_date date,
  icon text,
  color text,
  archived boolean not null default false,
  amount numeric(24,6),
  frequency text,
  start_date date,
  source_account_id text,
  primary key (space_id, id),
  foreign key (space_id, source_account_id) references public.finance_accounts(space_id, id),
  check (target is null or (target >= 0 and private.valid_money(target, currency))),
  check (amount is null or (amount > 0 and private.valid_money(amount, currency))),
  check (
    (kind = 'goal' and target is not null and icon is not null and color is not null
      and color ~ '^#[0-9A-Fa-f]{6}$'
      and amount is null and frequency is null and start_date is null and source_account_id is null)
    or
    (kind = 'pasanaco' and amount is not null and frequency in ('weekly', 'biweekly')
      and start_date is not null and source_account_id is not null and target_date is null)
  )
);
create unique index finance_one_pasanaco_per_space on public.finance_funds(space_id) where kind = 'pasanaco';

create table public.finance_budgets (
  space_id uuid primary key references public.finance_spaces(id) on delete cascade,
  amount numeric(24,6) not null default 0,
  currency text not null default 'ARS' check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  check (amount >= 0 and private.valid_money(amount, currency))
);

-- Ausencia de fila significa "sin saldo inicial de Lencería", distinta de cero.
create table public.finance_business_openings (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  amount numeric(24,6) not null,
  primary key (space_id, currency),
  check (private.valid_money(amount, currency))
);

create table public.finance_income_goals (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  month text not null check (private.valid_month(month)),
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  view text not null check (view in ('available', 'business', 'combined')),
  previous numeric(24,6) not null,
  target numeric(24,6) not null,
  growth_type text not null check (growth_type in ('percent', 'fixed')),
  growth numeric(24,6) not null,
  include_converted boolean not null default false,
  rates jsonb not null default '{}'::jsonb check (jsonb_typeof(rates) = 'object'),
  baseline_manual boolean not null default false,
  primary key (space_id, month),
  check (previous >= 0 and target >= 0 and private.valid_money(previous, currency) and private.valid_money(target, currency))
);

create table public.finance_income_quotes (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null,
  month text not null check (private.valid_month(month)),
  from_currency text not null check (from_currency in ('ARS', 'BOB', 'USD', 'USDT')),
  to_currency text not null check (to_currency in ('ARS', 'BOB', 'USD', 'USDT')),
  rate numeric(30,12) not null check (rate > 0),
  quote_date date not null,
  primary key (space_id, id),
  unique (space_id, month, from_currency, to_currency),
  check (from_currency <> to_currency),
  check (to_char(quote_date, 'YYYY-MM') = month)
);

create table public.finance_entries (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  id text not null check (length(btrim(id)) between 1 and 120),
  kind text not null check (kind in ('expense', 'income', 'transfer', 'reserve', 'withdraw', 'giro')),
  scope text not null check (scope in ('everyday', 'business', 'giro')),
  amount numeric(24,6) not null,
  currency text not null check (currency in ('ARS', 'BOB', 'USD', 'USDT')),
  account_id text not null,
  to_account_id text,
  received numeric(24,6),
  rate numeric(30,12),
  giro_reference text,
  giro_profit numeric(24,6),
  giro_profit_currency text check (giro_profit_currency in ('ARS', 'BOB', 'USD', 'USDT')),
  fund_id text,
  category_id text,
  income_source_id text,
  description text not null,
  entry_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, id),
  foreign key (space_id, account_id) references public.finance_accounts(space_id, id),
  foreign key (space_id, to_account_id) references public.finance_accounts(space_id, id),
  foreign key (space_id, fund_id) references public.finance_funds(space_id, id),
  foreign key (space_id, category_id) references public.finance_categories(space_id, id),
  foreign key (space_id, income_source_id) references public.finance_income_sources(space_id, id),
  check (amount > 0 and private.valid_money(amount, currency)),
  check (received is null or received > 0),
  check (rate is null or rate > 0),
  check (giro_profit is null or giro_profit >= 0),
  check ((kind in ('transfer', 'giro') and to_account_id is not null and received is not null)
      or (kind not in ('transfer', 'giro') and to_account_id is null and received is null)),
  check ((kind in ('reserve', 'withdraw') and fund_id is not null)
      or (kind not in ('reserve', 'withdraw') and fund_id is null)),
  check ((kind = 'giro' and scope = 'giro') or (kind <> 'giro' and scope <> 'giro')),
  check (kind = 'giro' or (giro_reference is null and giro_profit is null and giro_profit_currency is null)),
  check (giro_profit is not null or giro_profit_currency is null)
);
create index finance_entries_date on public.finance_entries(space_id, entry_date desc, id);
create index finance_entries_account on public.finance_entries(space_id, account_id);
create index finance_entries_to_account on public.finance_entries(space_id, to_account_id);
create index finance_entries_fund on public.finance_entries(space_id, fund_id);

create table public.finance_entry_requests (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  payload_hash text not null,
  result_entry jsonb,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id)
);
