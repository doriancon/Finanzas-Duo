-- SOLO PARA EL SQL EDITOR DEL PROYECTO duo-finance-pruebas.
-- Ref comprobado por CLI: ueobsnszhtdcywppheoq.
-- NO ejecutar en duo-finance (ref dxlthumgvhaaazawygcg).
-- Guardia adicional: identificador interno del cluster de pruebas verificado en lectura.
-- Ejecutar el archivo COMPLETO, sin seleccionar solo algunas líneas.
-- La función anónima usa una subtransacción PL/pgSQL que revierte SIEMPRE
-- la extensión pgTAP (si se crea), usuarios, espacios y movimientos de prueba.
-- Solo queda una tabla TEMPORAL de sesión con el resumen; no hay datos persistentes.

create temp table if not exists duo_sql_editor_result_v2 (
  n bigint generated always as identity,
  total integer not null,
  aprobadas integer not null,
  fallidas integer not null,
  detalle text not null,
  diagnostico text not null
) on commit preserve rows;

do $duo_finance_sql_editor$
declare
  v_cluster text;
  v_space_id uuid;
  v_invite_token uuid;
  v_tap text[] := array[]::text[];
  v_finish text[] := array[]::text[];
begin
  begin
    select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
    if v_cluster is distinct from '7692130048193495360' then
      raise exception 'Base equivocada: no se ejecutaron pruebas ni se crearon usuarios';
    end if;
    create extension if not exists pgtap with schema extensions;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duo-a@example.test', '', now()),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duo-b@example.test', '', now()),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now());

    set local role authenticated;
    create temp table duo_editor_tap(n bigint generated always as identity, tap text not null) on commit drop;
    perform extensions.plan(31);
    insert into duo_editor_tap(tap) select extensions.is((
      select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname like 'finance\_%' escape '\' and c.relrowsecurity
    ), 13::bigint, 'RLS está activado en las trece tablas financieras');

    perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
    v_space_id := public.create_finance_space('Prueba Duo');

    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_accounts), 6::bigint, 'se crean seis cuentas fijas');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_categories), 16::bigint, 'se crean todas las categorías iniciales');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_income_sources), 5::bigint, 'se crean las fuentes iniciales');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries), 0::bigint, 'no se crean movimientos ficticios');

    v_invite_token := public.create_finance_invite(v_space_id);
    perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
    perform public.accept_finance_invite(v_invite_token);
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_accounts), 6::bigint, 'el segundo miembro ve las cuentas compartidas');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_space_members), 2::bigint, 'hay exactamente dos miembros');

    perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_accounts), 0::bigint, 'un tercero no puede leer las cuentas');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_space_members), 0::bigint, 'un tercero no puede leer miembros');
    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      'insert into public.finance_categories(space_id,id,name,color,icon) values (%L::uuid, %L, %L, %L, %L)',
      v_space_id, 'intruso', 'Intruso', '#aabbcc', 'layers'
    ), '42501', null, 'un tercero no puede insertar categorías en el espacio');
    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      'select public.create_finance_invite(%L::uuid)', v_space_id
    ), 'P0001', null, 'un tercero no puede invitar miembros');
    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      'select public.set_finance_account_opening(%L::uuid, %L, 100)',
      v_space_id, 'ARS-efectivo'
    ), 'P0001', null, 'un tercero no puede cambiar saldos');
    insert into duo_editor_tap(tap) select extensions.ok(not has_table_privilege('anon', 'public.finance_entries', 'SELECT'), 'anon no tiene acceso al historial');
    insert into duo_editor_tap(tap) select extensions.ok(not has_table_privilege('authenticated', 'public.finance_entries', 'INSERT'), 'las escrituras directas de movimientos están cerradas');

    perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
    perform public.set_finance_account_opening(v_space_id, 'ARS-efectivo', 100);
    insert into duo_editor_tap(tap) select extensions.is((select opening from public.finance_accounts where id = 'ARS-efectivo'), 100::numeric, 'el saldo inicial se guarda');

    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','gasto-1','kind','expense','scope','everyday','amount',30,
        'currency','ARS','accountId','ARS-efectivo','categoryId','otros',
        'description','Compra','date','2026-10-23'),
      '11111111-1111-4111-8111-111111111111');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries), 1::bigint, 'un gasto crea un solo movimiento');

    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','gasto-1','kind','expense','scope','everyday','amount',30,
        'currency','ARS','accountId','ARS-efectivo','categoryId','otros',
        'description','Compra','date','2026-10-23'),
      '11111111-1111-4111-8111-111111111111');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries), 1::bigint, 'repetir request_id no duplica el gasto');

    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      $fmt$select public.apply_finance_entry(%L::uuid, 'create',
        '{"id":"exceso","kind":"expense","scope":"everyday","amount":80,"currency":"ARS","accountId":"ARS-efectivo","description":"Exceso","date":"2026-10-23"}'::jsonb,
        '22222222-2222-4222-8222-222222222222'::uuid)$fmt$,
      v_space_id
    ), '23514', null, 'un gasto sin saldo suficiente se rechaza');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries), 1::bigint, 'el gasto rechazado no se persiste');

    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','traspaso-1','kind','transfer','scope','everyday','amount',40,
        'currency','ARS','accountId','ARS-efectivo','toAccountId','ARS-transferencia',
        'received',40,'description','Traspaso','date','2026-10-23'),
      '33333333-3333-4333-8333-333333333333');
    insert into duo_editor_tap(tap) select extensions.is(
      (select a.opening - (select sum(e.amount) from public.finance_entries e where e.account_id = a.id and e.space_id = a.space_id)
       from public.finance_accounts a where a.id = 'ARS-efectivo'),
      30::numeric, 'la cuenta de origen queda en 30');
    insert into duo_editor_tap(tap) select extensions.is(
      (select sum(received) from public.finance_entries where to_account_id = 'ARS-transferencia'),
      40::numeric, 'la cuenta de destino recibe 40 una sola vez');

    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','gasto-2','kind','expense','scope','everyday','amount',25,
        'currency','ARS','accountId','ARS-transferencia','description','Compra 2','date','2026-10-23'),
      '44444444-4444-4444-8444-444444444444');
    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      'select public.delete_finance_entry(%L::uuid, %L, %L::uuid)',
      v_space_id, 'traspaso-1', '55555555-5555-4555-8555-555555555555'
    ), '23514', null, 'no se puede borrar un traspaso si deja una cuenta negativa');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries), 3::bigint, 'el borrado rechazado conserva el historial');

    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      $fmt$select public.apply_finance_entry(%L::uuid, 'update',
        '{"id":"gasto-1","kind":"expense","scope":"everyday","amount":200,"currency":"ARS","accountId":"ARS-efectivo","description":"Corrección","date":"2026-10-23"}'::jsonb,
        '66666666-6666-4666-8666-666666666666'::uuid)$fmt$,
      v_space_id
    ), '23514', null, 'editar no puede dejar saldo negativo');
    insert into duo_editor_tap(tap) select extensions.is((select amount from public.finance_entries where id = 'gasto-1'), 30::numeric, 'la edición rechazada conserva el importe anterior');

    insert into public.finance_funds(space_id,id,kind,name,currency,target,icon,color)
      values (v_space_id,'meta-1','goal','Viaje','ARS',100,'plane','#aabbcc');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_funds), 1::bigint, 'la meta se guarda en el espacio');
    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','aporte-1','kind','reserve','scope','business','amount',20,
        'currency','ARS','accountId','ARS-efectivo','fundId','meta-1',
        'description','Aporte','date','2026-10-23'),
      '77777777-7777-4777-8777-777777777777');
    insert into duo_editor_tap(tap) select extensions.is((select sum(amount) from public.finance_entries where fund_id = 'meta-1' and kind = 'reserve'),
      20::numeric, 'el aporte aumenta el fondo una sola vez');
    insert into duo_editor_tap(tap) select extensions.throws_ok(format(
      $fmt$select public.apply_finance_entry(%L::uuid, 'create',
        '{"id":"retiro-excesivo","kind":"withdraw","scope":"business","amount":25,"currency":"ARS","accountId":"ARS-efectivo","fundId":"meta-1","description":"Retiro","date":"2026-10-23"}'::jsonb,
        '88888888-8888-4888-8888-888888888888'::uuid)$fmt$,
      v_space_id
    ), '23514', null, 'no se puede retirar más de lo reservado');
    insert into duo_editor_tap(tap) select extensions.is((select count(*) from public.finance_entries where fund_id = 'meta-1'), 1::bigint,
      'el retiro rechazado no altera el fondo');

    perform public.set_finance_account_opening(v_space_id, 'BOB-efectivo', 100);
    perform public.apply_finance_entry(v_space_id, 'create',
      jsonb_build_object('id','giro-1','kind','giro','scope','giro','amount',40,
        'currency','BOB','accountId','BOB-efectivo','toAccountId','ARS-transferencia',
        'received',30,'giroProfit',5,'giroProfitCurrency','ARS',
        'description','Giro','date','2026-10-23'),
      '99999999-9999-4999-8999-999999999999');
    insert into duo_editor_tap(tap) select extensions.is((select received from public.finance_entries where id = 'giro-1'), 30::numeric,
      'el total cobrado del giro se registra una sola vez');
    insert into duo_editor_tap(tap) select extensions.is((select giro_profit from public.finance_entries where id = 'giro-1'), 5::numeric,
      'la ganancia del giro queda incluida como desglose');

    select coalesce(array_agg(tap order by n), array[]::text[])
      into v_tap from duo_editor_tap;
    select coalesce(array_agg(line), array[]::text[])
      into v_finish from extensions.finish() as t(line);

    -- Este error intencional obliga a deshacer todos los cambios del bloque.
    raise exception using errcode = 'PT999', message = 'Revertir datos ficticios de Duo Finance';
  exception when sqlstate 'PT999' then
    insert into pg_temp.duo_sql_editor_result_v2(total, aprobadas, fallidas, detalle, diagnostico)
    select cardinality(v_tap),
      (select count(*) from unnest(v_tap) as t(line) where line ~ '^ok [0-9]+'),
      (select count(*) from unnest(v_tap) as t(line) where line !~ '^ok [0-9]+'),
      array_to_string(v_tap, E'\n'),
      array_to_string(v_finish, E'\n');
  end;
end
$duo_finance_sql_editor$;

-- Único resultado final visible en SQL Editor.
select
  case when total = 31 and aprobadas = 31 and fallidas = 0 and diagnostico = ''
    then 'APROBADO: 31 de 31; datos ficticios revertidos'
    else 'REVISAR: alguna prueba falló; datos ficticios revertidos' end as resultado,
  total, aprobadas, fallidas, detalle, diagnostico
from pg_temp.duo_sql_editor_result_v2
order by n desc
limit 1;

