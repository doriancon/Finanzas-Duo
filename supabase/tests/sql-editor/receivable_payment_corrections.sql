-- Ejecutar únicamente en una base Supabase aislada, tras aplicar la migración de correcciones.
-- Sustituir CONFIGURAR_CLUSTER_AISLADO por el system_identifier de esa base.
-- El bloque interno revierte todos los usuarios, espacios, pagos y movimientos ficticios.
do $duo_payment_corrections$
declare
  v_cluster text;
  v_owner uuid := 'dededede-1111-4000-8000-000000000001';
  v_outsider uuid := 'dededede-1111-4000-8000-000000000002';
  v_space uuid;
  v_other_space uuid;
  v_debt_a uuid := 'dededede-1111-4000-8000-000000000003';
  v_debt_b uuid := 'dededede-1111-4000-8000-000000000004';
  v_payment uuid := 'dededede-1111-4000-8000-000000000005';
  v_control uuid := 'dededede-1111-4000-8000-000000000006';
  v_legacy uuid := 'dededede-1111-4000-8000-000000000011';
  v_bob_debt uuid := 'dededede-1111-4000-8000-000000000010';
  v_edit uuid := 'dededede-1111-4000-8000-000000000007';
  v_move uuid := 'dededede-1111-4000-8000-000000000008';
  v_void uuid := 'dededede-1111-4000-8000-000000000009';
  v_rejected boolean;
  v_net numeric;
begin
  select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  if v_cluster is distinct from 'CONFIGURAR_CLUSTER_AISLADO' then
    raise exception 'Base equivocada: no se crearon datos de prueba'; end if;
  begin
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
    values
      (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','payments-owner@example.test','',now()),
      (v_outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','payments-outsider@example.test','',now());
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    v_space:=public.create_finance_space('Pagos ficticios');
    insert into public.finance_receivables(space_id,id,owner_user_id,person,description,principal,currency)
    values(v_space,v_debt_a,v_owner,'Cliente A','Prueba',500000,'ARS'),
      (v_space,v_debt_b,v_owner,'Cliente B','Prueba',300000,'ARS'),
      (v_space,v_bob_debt,v_owner,'Cliente C','Prueba',1000,'BOB');

    -- 300.000 recibido en cuenta se corrige a 220.000 con una sola salida de 80.000.
    perform public.record_finance_receivable_payment_v2(v_space,v_debt_a,v_payment,300000,
      'account','ARS-efectivo','Pago inicial');
    perform public.record_finance_receivable_payment_v2(v_space,v_debt_a,v_payment,300000,
      'account','ARS-efectivo','Pago inicial');
    if (select count(*) from public.finance_entries where space_id=v_space and scope='receivable')<>1 then
      raise exception 'El reintento del pago real duplicó el ingreso'; end if;
    perform public.correct_finance_receivable_payment(v_space,v_payment,v_edit,0,'edit',v_debt_a,
      220000,'account','ARS-efectivo','Importe correcto');
    perform public.correct_finance_receivable_payment(v_space,v_payment,v_edit,0,'edit',v_debt_a,
      220000,'account','ARS-efectivo','Importe correcto');
    if (select sum(amount) from public.finance_receivable_payments where space_id=v_space
        and receivable_id=v_debt_a and status='active')<>220000
       or (select count(*) from public.finance_receivable_payment_revisions
        where space_id=v_space and payment_id=v_payment)<>1 then
      raise exception 'Editar o reintentar el pago no conservó un total correcto'; end if;
    select coalesce(sum(case when kind='income' then amount else -amount end),0) into v_net
      from public.finance_entries where space_id=v_space and scope='receivable'
        and account_id='ARS-efectivo';
    if v_net<>220000 then raise exception 'La cuenta no refleja el importe corregido'; end if;

    -- Control puro: deuda menor, cuenta y movimientos intactos. Luego cambio a real y vuelta.
    perform public.record_finance_receivable_payment_v2(v_space,v_debt_b,v_control,30000,
      'control',null,'Pago fuera del sistema');
    -- La firma antigua debe rechazar ese mismo ID: no puede fingir un ingreso.
    v_rejected:=false;
    begin
      perform public.record_finance_receivable_payment(v_space,v_debt_b,v_control,30000,'ARS-efectivo');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'El cliente antiguo aceptó un pago solo control como cobro en cuenta'; end if;
    if (select count(*) from public.finance_entries where space_id=v_space and scope='receivable')<>2
       or (select account_id from public.finance_receivable_payments where space_id=v_space and id=v_control) is not null then
      raise exception 'Un pago de control afectó una cuenta'; end if;
    perform public.correct_finance_receivable_payment(v_space,v_control,gen_random_uuid(),0,'edit',v_debt_b,
      30000,'account','ARS-transferencia','Ingresó a cuenta');
    perform public.correct_finance_receivable_payment(v_space,v_control,gen_random_uuid(),1,'edit',v_debt_b,
      30000,'control',null,'Solo control');
    select coalesce(sum(case when kind='income' then amount else -amount end),0) into v_net
      from public.finance_entries where space_id=v_space and scope='receivable'
        and account_id='ARS-transferencia';
    if v_net<>0 then raise exception 'Cambiar entre control y cuenta duplicó el saldo'; end if;
    perform public.correct_finance_receivable_payment(v_space,v_control,gen_random_uuid(),2,'void',v_debt_b,
      null,null,null,'Pago de control equivocado');
    if (select status from public.finance_receivable_payments where space_id=v_space and id=v_control)<>'void'
       or (select count(*) from public.finance_entries where space_id=v_space and scope='receivable')<>4 then
      raise exception 'Anular un pago de control creó un movimiento'; end if;

    -- Mover el pago real a otra deuda de igual moneda no toca la cuenta.
    perform public.correct_finance_receivable_payment(v_space,v_payment,v_move,1,'move',v_debt_b,
      null,null,null,'Importe correcto');
    if (select coalesce(sum(amount),0) from public.finance_receivable_payments
        where space_id=v_space and receivable_id=v_debt_a and status='active')<>0
       or (select coalesce(sum(amount),0) from public.finance_receivable_payments
        where space_id=v_space and receivable_id=v_debt_b and status='active')<>220000 then
      raise exception 'Mover el pago alteró las deudas incorrectamente'; end if;
    select coalesce(sum(case when kind='income' then amount else -amount end),0) into v_net
      from public.finance_entries where space_id=v_space and scope='receivable'
        and account_id='ARS-efectivo';
    if v_net<>220000 then raise exception 'Mover el pago alteró el saldo real'; end if;
    v_rejected:=false;
    begin
      perform public.correct_finance_receivable_payment(v_space,v_payment,gen_random_uuid(),2,'move',v_bob_debt,
        null,null,null,'Importe correcto');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Se movió un pago a otra moneda'; end if;
    v_rejected:=false;
    begin
      perform public.correct_finance_receivable_payment(v_space,v_payment,gen_random_uuid(),2,'edit',v_debt_b,
        350000,'account','ARS-efectivo','Importe imposible');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Se admitió un pago superior a la deuda'; end if;
    v_rejected:=false;
    begin
      perform public.correct_finance_receivable_payment(v_space,v_payment,gen_random_uuid(),1,'void',v_debt_b,
        null,null,null,'');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Se aceptó una revisión obsoleta'; end if;
    perform public.correct_finance_receivable_payment(v_space,v_payment,v_void,2,'void',v_debt_b,
      null,null,null,'Nunca existió');
    select coalesce(sum(case when kind='income' then amount else -amount end),0) into v_net
      from public.finance_entries where space_id=v_space and scope='receivable'
        and account_id='ARS-efectivo';
    if v_net<>0 or (select status from public.finance_receivable_payments
        where space_id=v_space and id=v_payment)<>'void' then
      raise exception 'Anular el pago real no revirtió el saldo una sola vez'; end if;
    if (select count(*) from public.finance_receivable_payment_revisions
        where space_id=v_space and payment_id=v_payment)<>3
       or exists(select 1 from public.finance_entries where space_id=v_space
        and scope in ('everyday','business','giro')) then
      raise exception 'La auditoría o la separación de ingresos personales falló'; end if;
    -- Los reintentos legítimos de la firma antigua siguen siendo idempotentes.
    perform public.record_finance_receivable_payment(v_space,v_bob_debt,v_legacy,100,'BOB-efectivo');
    perform public.record_finance_receivable_payment(v_space,v_bob_debt,v_legacy,100,'BOB-efectivo');
    if (select count(*) from public.finance_entries
        where space_id=v_space and id='receivable:'||v_legacy::text)<>1 then
      raise exception 'El cliente antiguo duplicó un cobro real al reintentar'; end if;

    -- Un usuario ajeno no lee la auditoría ni corrige un ID conocido.
    perform set_config('request.jwt.claim.sub',v_outsider::text,true);
    v_other_space:=public.create_finance_space('Espacio ajeno ficticio');
    if exists(select 1 from public.finance_receivable_payment_revisions where space_id=v_space) then
      raise exception 'RLS reveló correcciones de otro espacio'; end if;
    if exists(select 1 from public.finance_receivable_payments where space_id=v_space) then
      raise exception 'RLS reveló pagos de otro espacio'; end if;
    v_rejected:=false;
    begin
      perform public.correct_finance_receivable_payment(v_space,v_payment,gen_random_uuid(),3,'move',v_debt_a,
        null,null,null,'');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Un usuario ajeno corrigió un pago conocido'; end if;
    if (select count(*) from public.finance_entries where space_id=v_other_space)<>0 then
      raise exception 'Se alteró otro espacio'; end if;
    raise exception 'DUO_TEST_ROLLBACK';
  exception when others then
    if sqlerrm<>'DUO_TEST_ROLLBACK' then raise; end if;
    raise notice 'APROBADO: correcciones, control, traslado, anulación, reintentos y RLS; fixtures revertidos';
  end;
end $duo_payment_corrections$;
