-- PREPARADO, NO EJECUTADO. Solo para duo-finance-pruebas (ueobsnszhtdcywppheoq).
-- Ejecutar ÚNICAMENTE después de aplicar la cuarta migración autorizada.
-- El cluster está verificado contra las 31 pruebas anteriores.
-- Nunca usar en el proyecto principal duo-finance.
-- El bloque interior revierte usuarios, espacios, movimientos, vínculos y resultados.

create temp table if not exists duo_giro_test_result (
  n bigint generated always as identity,
  total integer not null,
  aprobadas integer not null,
  fallidas integer not null,
  detalle text not null,
  diagnostico text not null
) on commit preserve rows;

do $duo_giro_test$
declare
  v_cluster text;
  v_space uuid;
  v_other_space uuid;
  v_invite uuid;
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_c uuid := gen_random_uuid();
  v_entries_before text;
  v_accounts_before text;
  v_tap text[] := array[]::text[];
  v_finish text[] := array[]::text[];
begin
  begin
    select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
    if v_cluster is distinct from '7692130048193495360' then
      raise exception 'Destino no autorizado: no se crearon datos de prueba';
    end if;
    create extension if not exists pgtap with schema extensions;
    create temp table duo_giro_tap(n bigint generated always as identity, tap text not null) on commit drop;
grant all on table pg_temp.duo_giro_tap to authenticated;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values
      (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_user_a::text || '@example.test', '', now()),
      (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_user_b::text || '@example.test', '', now()),
      (v_user_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_user_c::text || '@example.test', '', now());

    set local role authenticated;
    perform extensions.plan(27);
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('finance_giro_links','finance_giro_results')
        and c.relrowsecurity), 2::bigint, 'RLS activo en ambas tablas nuevas');
    insert into duo_giro_tap(tap) select extensions.ok(not has_table_privilege('anon','public.finance_giro_links','SELECT'),
      'anon no puede leer vínculos');
    insert into duo_giro_tap(tap) select extensions.ok(not has_table_privilege('anon','public.finance_giro_results','SELECT'),
      'anon no puede leer resultados');
    insert into duo_giro_tap(tap) select extensions.ok(not has_table_privilege('authenticated','public.finance_giro_results','UPDATE'),
      'los miembros no pueden editar ganancias confirmadas');
    insert into duo_giro_tap(tap) select extensions.ok(not has_table_privilege('authenticated','public.finance_giro_results','DELETE'),
      'los miembros no pueden borrar ganancias confirmadas');

    perform set_config('request.jwt.claim.sub',v_user_a::text,true);
    v_space := public.create_finance_space('Espacio giro aislado');
    perform public.set_finance_account_opening(v_space,'BOB-transferencia',900);
    perform public.set_finance_account_opening(v_space,'ARS-transferencia',90000);
    v_invite := public.create_finance_invite(v_space);
    perform set_config('request.jwt.claim.sub',v_user_b::text,true);
    perform public.accept_finance_invite(v_invite);
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_space_members where space_id=v_space),2::bigint,
      'dos miembros comparten el mismo espacio');

    perform set_config('request.jwt.claim.sub',v_user_a::text,true);
    perform public.apply_finance_entry(v_space,'create',jsonb_build_object(
      'id','giro-a','kind','giro','scope','giro','amount',600,'currency','BOB',
      'accountId','BOB-transferencia','toAccountId','ARS-transferencia','received',100000,
      'description','Giro A','date','2026-10-10'),gen_random_uuid());
    perform public.apply_finance_entry(v_space,'create',jsonb_build_object(
      'id','giro-b','kind','giro','scope','giro','amount',300,'currency','BOB',
      'accountId','BOB-transferencia','toAccountId','ARS-transferencia','received',50000,
      'description','Giro B','date','2026-10-10'),gen_random_uuid());
    perform public.apply_finance_entry(v_space,'create',jsonb_build_object(
      'id','ars-usdt','kind','transfer','scope','everyday','amount',90000,'currency','ARS',
      'accountId','ARS-transferencia','toAccountId','USDT-billetera','received',8,
      'description','Cambio ARS a USDT','date','2026-10-11'),gen_random_uuid());
    perform public.apply_finance_entry(v_space,'create',jsonb_build_object(
      'id','usdt-bob','kind','transfer','scope','everyday','amount',8,'currency','USDT',
      'accountId','USDT-billetera','toAccountId','BOB-transferencia','received',600,
      'description','Cambio USDT a BOB','date','2026-10-11'),gen_random_uuid());
    select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'[]')) into v_entries_before
      from public.finance_entries e where e.space_id=v_space;
    select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'[]')) into v_accounts_before
      from public.finance_accounts a where a.space_id=v_space;
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_entries where space_id=v_space),4::bigint,
      'dos giros y dos cambios son cuatro movimientos reales');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_entries where space_id=v_space and kind='income'),0::bigint,
      'los giros no generan ingresos personales');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_entries where space_id=v_space and kind='giro' and scope='giro'),2::bigint,
      'los giros conservan su ámbito separado');

    -- Ambos giros pueden compartir el mismo cambio, pero nunca gastar más que el total.
    insert into public.finance_giro_links(space_id,giro_id,transfer_id,from_amount,to_amount)
      values (v_space,'giro-a','usdt-bob',4,300);
    insert into duo_giro_tap(tap) select extensions.throws_ok(format(
      'insert into public.finance_giro_links(space_id,giro_id,transfer_id,from_amount,to_amount) values (%L::uuid,%L,%L,5,375)',
      v_space,'giro-b','usdt-bob'), 'P0001', null, 'no puede asignarse 9 USDT de un cambio de 8');
    insert into public.finance_giro_links(space_id,giro_id,transfer_id,from_amount,to_amount)
      values (v_space,'giro-b','usdt-bob',4,300);
    insert into public.finance_giro_links(space_id,giro_id,transfer_id,from_amount,to_amount)
      values (v_space,'giro-a','ars-usdt',45000,4),(v_space,'giro-b','ars-usdt',45000,4);
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_links where space_id=v_space),4::bigint,
      'dos cambios se distribuyen entre dos giros sin duplicar movimientos');
    insert into duo_giro_tap(tap) select extensions.is((select sum(from_amount) from public.finance_giro_links
      where space_id=v_space and transfer_id='ars-usdt'),90000::numeric,'el costo ARS se asigna una sola vez');
    insert into duo_giro_tap(tap) select extensions.is((select sum(to_amount) from public.finance_giro_links
      where space_id=v_space and transfer_id='usdt-bob'),600::numeric,'la reposición BOB no supera el cambio original');

    -- B puede ver y confirmar el giro creado por A, aun con reposición parcial en A.
    perform set_config('request.jwt.claim.sub',v_user_b::text,true);
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_links where space_id=v_space),4::bigint,
      'el segundo miembro ve todos los vínculos');
    insert into public.finance_giro_results(space_id,giro_id,cost_ars,fees_ars,profit_ars,evidence,recognized_month)
      values (v_space,'giro-b',45000,1000,999999,'Cambios reales vinculados','2000-01');
    insert into duo_giro_tap(tap) select extensions.is((select profit_ars from public.finance_giro_results
      where space_id=v_space and giro_id='giro-b'),4000::numeric,'la ganancia es cobro menos costo y comisión');
    insert into duo_giro_tap(tap) select extensions.is((select recognized_month from public.finance_giro_results
      where space_id=v_space and giro_id='giro-b'),to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM'),
      'el mes se fija en la fecha real de confirmación');
    insert into duo_giro_tap(tap) select extensions.is((select sum(profit_ars) from public.finance_giro_results
      where space_id=v_space and recognized_month=to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM')),
      4000::numeric,'el balance mensual suma sólo ganancias confirmadas');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_results where space_id=v_space),1::bigint,
      'el otro giro sigue con ganancia pendiente');
    insert into duo_giro_tap(tap) select extensions.throws_ok(format(
      'insert into public.finance_giro_results(space_id,giro_id,cost_ars,fees_ars,profit_ars,evidence,recognized_month) values (%L::uuid,%L,45000,1000,0,%L,%L)',
      v_space,'giro-b','Intento de ganancia duplicada','2000-01'), '23505', null,
      'un giro no puede tener dos ganancias confirmadas');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_results where space_id=v_space),1::bigint,
      'el intento duplicado deja un único resultado');
    insert into duo_giro_tap(tap) select extensions.throws_ok(format(
      'update public.finance_giro_links set from_amount=4 where space_id=%L::uuid and giro_id=%L and transfer_id=%L',
      v_space,'giro-b','usdt-bob'), 'P0001', null, 'un vínculo confirmado no se puede editar');
    insert into duo_giro_tap(tap) select extensions.throws_ok(format(
      'select public.apply_finance_entry(%L::uuid,%L,%L::jsonb,%L::uuid)',
      v_space,'update',jsonb_build_object('id','giro-b','kind','giro','scope','giro',
        'amount',300,'currency','BOB','accountId','BOB-transferencia',
        'toAccountId','ARS-transferencia','received',50000,'description','Cambio indebido',
        'date','2026-10-10')::text,gen_random_uuid()), 'P0001', null,
      'un giro confirmado no puede reescribirse');

    perform set_config('request.jwt.claim.sub',v_user_c::text,true);
    v_other_space := public.create_finance_space('Otro espacio aislado');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_links),0::bigint,
      'un usuario de otro espacio no ve vínculos');
    insert into duo_giro_tap(tap) select extensions.is((select count(*) from public.finance_giro_results),0::bigint,
      'un usuario de otro espacio no ve ganancias');
    insert into duo_giro_tap(tap) select extensions.throws_ok(format(
      'insert into public.finance_giro_links(space_id,giro_id,transfer_id,from_amount,to_amount) values (%L::uuid,%L,%L,1,75)',
      v_space,'giro-a','usdt-bob'), 'P0001', null, 'un tercero no puede vincular cambios ajenos');

    perform set_config('request.jwt.claim.sub',v_user_a::text,true);
    insert into duo_giro_tap(tap) select extensions.is((select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'[]'))
      from public.finance_entries e where e.space_id=v_space),v_entries_before,
      'vincular y confirmar no reescribe ni duplica movimientos');
    insert into duo_giro_tap(tap) select extensions.is((select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'[]'))
      from public.finance_accounts a where a.space_id=v_space),v_accounts_before,
      'vincular y confirmar no cambia cuentas ni saldos iniciales');

    select coalesce(array_agg(tap order by n),array[]::text[]) into v_tap from duo_giro_tap;
    select coalesce(array_agg(line),array[]::text[]) into v_finish from extensions.finish() as t(line);
    raise exception using errcode='PT999',message='Revertir prueba aislada de giros';
  exception when sqlstate 'PT999' then
    insert into pg_temp.duo_giro_test_result(total,aprobadas,fallidas,detalle,diagnostico)
      select cardinality(v_tap),
        (select count(*) from unnest(v_tap) t(line) where line ~ '^ok [0-9]+'),
        (select count(*) from unnest(v_tap) t(line) where line !~ '^ok [0-9]+'),
        array_to_string(v_tap,E'\n'),array_to_string(v_finish,E'\n');
  end;
end
$duo_giro_test$;

select case when total=27 and aprobadas=27 and fallidas=0 and diagnostico=''
  then 'APROBADO: 27 de 27; datos ficticios revertidos'
  else 'REVISAR: pruebas fallidas; datos ficticios revertidos' end as resultado,
  total,aprobadas,fallidas,detalle,diagnostico
from pg_temp.duo_giro_test_result order by n desc limit 1;
