-- Cálculos de saldo equivalentes al historial de src/domain.ts.
create function private.assert_finance_balances(p_space_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_bad text;
begin
  select a.id into v_bad
  from public.finance_accounts a
  left join public.finance_entries e on e.space_id = a.space_id
    and (e.account_id = a.id or e.to_account_id = a.id)
  where a.space_id = p_space_id
  group by a.id, a.opening
  having a.opening + coalesce(sum(
    case
      when e.kind in ('income', 'withdraw') and e.account_id = a.id then e.amount
      when e.kind in ('expense', 'reserve') and e.account_id = a.id then -e.amount
      when e.kind in ('transfer', 'giro') then
        (case when e.to_account_id = a.id then e.received else 0 end)
        - (case when e.account_id = a.id then e.amount else 0 end)
      else 0
    end
  ), 0) < 0
  limit 1;
  if v_bad is not null then
    raise exception 'La operación dejaría un saldo negativo en la cuenta %', v_bad using errcode = '23514';
  end if;

  select f.id into v_bad
  from public.finance_funds f
  left join public.finance_entries e on e.space_id = f.space_id and e.fund_id = f.id
  where f.space_id = p_space_id
  group by f.id
  having coalesce(sum(case e.kind when 'reserve' then e.amount when 'withdraw' then -e.amount else 0 end), 0) < 0
  limit 1;
  if v_bad is not null then
    raise exception 'La operación dejaría un saldo negativo en el fondo %', v_bad using errcode = '23514';
  end if;
end $$;

revoke all on function private.assert_finance_balances(uuid) from public, anon, authenticated;

-- La fila del espacio es el candado común para todas las escrituras financieras.
-- Una segunda transacción del mismo espacio espera y valida contra el historial ya confirmado.
create function public.apply_finance_entry(
  p_space_id uuid, p_mode text, p_entry jsonb, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
  v_kind text;
  v_scope text;
  v_currency text;
  v_from_currency text;
  v_to_currency text;
  v_fund_currency text;
  v_amount numeric;
  v_received numeric;
  v_profit numeric;
  v_profit_currency text;
  v_hash text;
  v_previous public.finance_entry_requests%rowtype;
  v_result jsonb;
begin
  if not private.is_finance_member(p_space_id) then raise exception 'No pertenecés a este espacio'; end if;
  if p_mode not in ('create', 'update') or p_entry is null or jsonb_typeof(p_entry) <> 'object'
      or p_request_id is null then raise exception 'Solicitud de movimiento inválida'; end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  v_hash := md5(p_mode || ':' || p_entry::text);
  select * into v_previous from public.finance_entry_requests
    where space_id = p_space_id and request_id = p_request_id;
  if found then
    if v_previous.operation <> p_mode or v_previous.payload_hash <> v_hash then
      raise exception 'El identificador de solicitud ya se usó con otros datos';
    end if;
    return v_previous.result_entry;
  end if;

  v_id := nullif(btrim(p_entry->>'id'), '');
  v_kind := p_entry->>'kind';
  v_scope := p_entry->>'scope';
  v_currency := p_entry->>'currency';
  v_amount := (p_entry->>'amount')::numeric;
  v_received := (p_entry->>'received')::numeric;
  v_profit := (p_entry->>'giroProfit')::numeric;
  if v_id is null or length(v_id) > 120 or v_kind not in ('expense','income','transfer','reserve','withdraw','giro')
      or v_scope not in ('everyday','business','giro') or v_currency not in ('ARS','BOB','USD','USDT')
      or v_amount is null or v_amount <= 0 or not private.valid_money(v_amount,v_currency)
      or nullif(p_entry->>'date','') is null then
    raise exception 'Datos de movimiento inválidos';
  end if;
  if p_mode = 'create' and exists (
    select 1 from public.finance_entries where space_id = p_space_id and id = v_id
  ) then raise exception 'Ya existe un movimiento con este ID'; end if;
  if p_mode = 'update' and not exists (
    select 1 from public.finance_entries where space_id = p_space_id and id = v_id
  ) then raise exception 'No existe el movimiento que querés editar'; end if;

  select currency into v_from_currency from public.finance_accounts
    where space_id = p_space_id and id = p_entry->>'accountId';
  if v_from_currency is distinct from v_currency then
    raise exception 'La cuenta de origen no coincide con la moneda del movimiento';
  end if;

  if v_kind in ('transfer','giro') then
    select currency into v_to_currency from public.finance_accounts
      where space_id = p_space_id and id = p_entry->>'toAccountId';
    if v_to_currency is null or p_entry->>'accountId' = p_entry->>'toAccountId'
        or v_received is null or v_received <= 0 or not private.valid_money(v_received,v_to_currency) then
      raise exception 'Cuenta o importe recibido inválido';
    end if;
    if v_kind = 'transfer' and v_currency = v_to_currency and v_amount <> v_received then
      raise exception 'Entre cuentas de la misma moneda, ambos importes deben coincidir';
    end if;
  elsif p_entry ? 'toAccountId' and p_entry->>'toAccountId' is not null
      or v_received is not null then
    raise exception 'Este movimiento no tiene cuenta receptora';
  end if;

  if (v_kind = 'giro' and v_scope <> 'giro') or (v_kind <> 'giro' and v_scope = 'giro') then
    raise exception 'Ámbito inválido para este movimiento';
  end if;
  if v_kind = 'giro' then
    v_profit_currency := coalesce(p_entry->>'giroProfitCurrency', v_to_currency);
    if v_profit is not null and (v_profit < 0 or not private.valid_money(v_profit,v_profit_currency)
        or (v_profit_currency = v_to_currency and v_profit > v_received)) then
      raise exception 'La ganancia del giro es inválida';
    end if;
  elsif v_profit is not null or p_entry->>'giroReference' is not null
      or p_entry->>'giroProfitCurrency' is not null then
    raise exception 'Los campos de giro solo corresponden a giros';
  end if;

  if v_kind in ('reserve','withdraw') then
    select currency into v_fund_currency from public.finance_funds
      where space_id = p_space_id and id = p_entry->>'fundId';
    if v_fund_currency is distinct from v_currency then
      raise exception 'El fondo debe tener la moneda del movimiento';
    end if;
  elsif p_entry->>'fundId' is not null then
    raise exception 'Este movimiento no usa un fondo';
  end if;

  insert into public.finance_entries as e (
    space_id,id,kind,scope,amount,currency,account_id,to_account_id,received,rate,
    giro_reference,giro_profit,giro_profit_currency,fund_id,category_id,income_source_id,
    description,entry_date
  ) values (
    p_space_id,v_id,v_kind,v_scope,v_amount,v_currency,p_entry->>'accountId',
    p_entry->>'toAccountId',v_received,(p_entry->>'rate')::numeric,
    p_entry->>'giroReference',v_profit,
    case when v_profit is null then null else p_entry->>'giroProfitCurrency' end,
    p_entry->>'fundId',p_entry->>'categoryId',p_entry->>'incomeSourceId',
    coalesce(p_entry->>'description',''),(p_entry->>'date')::date
  )
  on conflict (space_id,id) do update set
    kind = excluded.kind, scope = excluded.scope, amount = excluded.amount,
    currency = excluded.currency, account_id = excluded.account_id,
    to_account_id = excluded.to_account_id, received = excluded.received,
    rate = excluded.rate, giro_reference = excluded.giro_reference,
    giro_profit = excluded.giro_profit, giro_profit_currency = excluded.giro_profit_currency,
    fund_id = excluded.fund_id, category_id = excluded.category_id,
    income_source_id = excluded.income_source_id, description = excluded.description,
    entry_date = excluded.entry_date, updated_at = now();

  perform private.assert_finance_balances(p_space_id);
  select to_jsonb(e) into v_result from public.finance_entries e
    where e.space_id = p_space_id and e.id = v_id;
  insert into public.finance_entry_requests(space_id,request_id,operation,payload_hash,result_entry)
    values (p_space_id,p_request_id,p_mode,v_hash,v_result);
  return v_result;
end $$;

create function public.delete_finance_entry(p_space_id uuid, p_entry_id text, p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_previous public.finance_entry_requests%rowtype;
begin
  if not private.is_finance_member(p_space_id) then raise exception 'No pertenecés a este espacio'; end if;
  if p_entry_id is null or p_request_id is null then raise exception 'Solicitud inválida'; end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  v_hash := md5('delete:' || p_entry_id);
  select * into v_previous from public.finance_entry_requests
    where space_id = p_space_id and request_id = p_request_id;
  if found then
    if v_previous.operation <> 'delete' or v_previous.payload_hash <> v_hash then
      raise exception 'El identificador de solicitud ya se usó con otros datos';
    end if;
    return true;
  end if;
  delete from public.finance_entries where space_id = p_space_id and id = p_entry_id;
  if not found then raise exception 'No existe el movimiento que querés eliminar'; end if;
  perform private.assert_finance_balances(p_space_id);
  insert into public.finance_entry_requests(space_id,request_id,operation,payload_hash)
    values (p_space_id,p_request_id,'delete',v_hash);
  return true;
end $$;

create function public.set_finance_account_opening(
  p_space_id uuid, p_account_id text, p_opening numeric
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_currency text;
begin
  if not private.is_finance_member(p_space_id) then raise exception 'No pertenecés a este espacio'; end if;
  perform 1 from public.finance_spaces where id = p_space_id for update;
  select currency into v_currency from public.finance_accounts
    where space_id = p_space_id and id = p_account_id;
  if v_currency is null or not private.valid_money(p_opening,v_currency) then
    raise exception 'Saldo inicial o cuenta inválidos';
  end if;
  update public.finance_accounts set opening = p_opening
    where space_id = p_space_id and id = p_account_id;
  perform private.assert_finance_balances(p_space_id);
  return p_opening;
end $$;

revoke all on function public.apply_finance_entry(uuid,text,jsonb,uuid),
  public.delete_finance_entry(uuid,text,uuid),
  public.set_finance_account_opening(uuid,text,numeric) from public, anon;
grant execute on function public.apply_finance_entry(uuid,text,jsonb,uuid),
  public.delete_finance_entry(uuid,text,uuid),
  public.set_finance_account_opening(uuid,text,numeric) to authenticated;
