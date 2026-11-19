-- Ejecutar únicamente en una base Supabase aislada, tras las migraciones de correcciones y archivo.
-- Sustituir CONFIGURAR_CLUSTER_AISLADO por el system_identifier verificado de esa base.
-- Los fixtures se revierten dentro del bloque, también si alguna prueba falla.
do $duo_paid_archive$
declare
  v_cluster text;
  v_owner uuid := 'dededede-2222-4000-8000-000000000001';
  v_outsider uuid := 'dededede-2222-4000-8000-000000000002';
  v_space uuid;
  v_paid uuid := 'dededede-2222-4000-8000-000000000003';
  v_partial uuid := 'dededede-2222-4000-8000-000000000004';
  v_real uuid := 'dededede-2222-4000-8000-000000000005';
  v_payment uuid := 'dededede-2222-4000-8000-000000000006';
  v_rejected boolean;
  v_entries_before integer;
  v_net_before numeric;
begin
  select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  if v_cluster is distinct from 'CONFIGURAR_CLUSTER_AISLADO' then
    raise exception 'Base equivocada: no se crearon datos de prueba'; end if;
  begin
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
    values
      (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','archive-owner@example.test','',now()),
      (v_outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','archive-outsider@example.test','',now());
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    v_space:=public.create_finance_space('Archivo ficticio');
    insert into public.finance_receivables(space_id,id,owner_user_id,person,description,principal,currency)
    values(v_space,v_paid,v_owner,'Papá','Venta pagada',3000,'BOB'),
      (v_space,v_partial,v_owner,'Papá','Venta parcial',1000,'BOB'),
      (v_space,v_real,v_owner,'Papá','Préstamo recuperado',500,'BOB');
    perform public.record_finance_receivable_payment_v2(v_space,v_paid,v_payment,3000,'control',null,'Fuera del sistema');
    perform public.record_finance_receivable_payment_v2(v_space,v_partial,gen_random_uuid(),500,'control',null,'Parcial');
    perform public.record_finance_receivable_payment_v2(v_space,v_real,gen_random_uuid(),500,'account','BOB-efectivo','Recibido');
    select count(*),coalesce(sum(case when kind='income' then amount else -amount end),0)
      into v_entries_before,v_net_before from public.finance_entries where space_id=v_space;
    if v_entries_before<>1 or v_net_before<>500 then raise exception 'Fixture de saldos inválido'; end if;

    v_rejected:=false;
    begin
      perform public.archive_paid_finance_receivable(v_space,v_partial);
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Se archivó una deuda parcialmente pagada'; end if;
    -- Tampoco puede esquivarse la validación elevando el principal y archivando en una misma sentencia.
    v_rejected:=false;
    begin
      update public.finance_receivables set principal=500,archived_at=now()
        where space_id=v_space and id=v_partial;
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'El archivo permitió cambiar el monto original'; end if;

    perform public.archive_paid_finance_receivable(v_space,v_paid);
    perform public.archive_paid_finance_receivable(v_space,v_paid);
    perform public.archive_paid_finance_receivable(v_space,v_real);
    if (select count(*) from public.finance_receivables where space_id=v_space and archived_at is not null)<>2
       or (select count(*) from public.finance_receivables where space_id=v_space and archived_at is null)<>1
       or (select count(*) from public.finance_receivable_payments where space_id=v_space)<>3 then
      raise exception 'El archivo eliminó o mezcló deudas y pagos'; end if;
    if (select count(*) from public.finance_entries where space_id=v_space)<>v_entries_before
       or (select coalesce(sum(case when kind='income' then amount else -amount end),0)
           from public.finance_entries where space_id=v_space)<>v_net_before then
      raise exception 'El archivo alteró movimientos o saldos'; end if;
    v_rejected:=false;
    begin
      perform public.correct_finance_receivable_payment(v_space,v_payment,gen_random_uuid(),0,'void',v_paid,
        null,null,null,'');
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Se modificó un pago de una deuda archivada'; end if;

    perform set_config('request.jwt.claim.sub',v_outsider::text,true);
    if exists(select 1 from public.finance_receivables where space_id=v_space) then
      raise exception 'RLS reveló deudas archivadas ajenas'; end if;
    v_rejected:=false;
    begin
      perform public.archive_paid_finance_receivable(v_space,v_paid);
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'Un usuario ajeno archivó una deuda conocida'; end if;
    raise exception 'DUO_TEST_ROLLBACK';
  exception when others then
    if sqlerrm<>'DUO_TEST_ROLLBACK' then raise; end if;
    raise notice 'APROBADO: archivo pagado, saldos, otras deudas, historial y RLS; fixtures revertidos';
  end;
end $duo_paid_archive$;
