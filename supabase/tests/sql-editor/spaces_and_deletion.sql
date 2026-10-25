-- Ejecutar COMPLETO únicamente en el SQL Editor de duo-finance-pruebas
-- (ref ueobsnszhtdcywppheoq), después de aplicar la migración 00400.
-- Una subtransacción revierte SIEMPRE los tres usuarios y ambos espacios ficticios.
do $duo_spaces_test$
declare
  v_cluster text;
  v_space_a uuid;
  v_space_b uuid;
  v_token uuid;
  v_other_invite uuid;
  v_a uuid := 'dededede-0000-4000-8000-000000000001';
  v_b uuid := 'dededede-0000-4000-8000-000000000002';
  v_c uuid := 'dededede-0000-4000-8000-000000000003';
  v_rejected boolean;
  v_changed integer;
begin
  select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  if v_cluster is distinct from '7692130048193495360' then
    raise exception 'Base equivocada: no se crearon datos de prueba';
  end if;
  begin
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values
      (v_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','delete-a@example.test','',now()),
      (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','delete-b@example.test','',now()),
      (v_c,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','delete-c@example.test','',now());

    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_a::text,true);
    v_space_a := public.create_finance_space('Espacio A ficticio');
    insert into public.finance_user_profiles(user_id,display_name) values(v_a,'Persona A');
    insert into public.finance_push_subscriptions(space_id,user_id,endpoint,p256dh,auth_key)
      values(v_space_a,v_a,'https://push.example.test/fixture-a',repeat('a',32),repeat('b',16));
    v_token := public.create_finance_invite(v_space_a);
    perform set_config('request.jwt.claim.sub',v_b::text,true);
    perform public.accept_finance_invite(v_token);
    insert into public.finance_user_profiles(user_id,display_name) values(v_b,'Persona B');
    if (select count(*) from public.finance_accounts where space_id=v_space_a) <> 6 then
      raise exception 'Falló la creación de cuentas aisladas';
    end if;
    if (select count(*) from public.finance_user_profiles where user_id=v_a) <> 0 then
      raise exception 'Un miembro leyó el perfil privado del otro';
    end if;

    perform set_config('request.jwt.claim.sub',v_c::text,true);
    v_space_b := public.create_finance_space('Espacio B ficticio');
    insert into public.finance_user_profiles(user_id,display_name) values(v_c,'Persona C');
    perform public.apply_finance_entry(v_space_b, 'create', jsonb_build_object(
      'id','fixture-prior-income', 'kind','income', 'scope','everyday', 'amount',10,
      'currency','ARS', 'accountId','ARS-efectivo',
      'description','Movimiento propio de B', 'date',current_date::text), gen_random_uuid());
    v_other_invite := public.create_finance_invite(v_space_b);
    if (select count(*) from public.finance_accounts where space_id=v_space_a) <> 0 then
      raise exception 'El otro espacio pudo leer cuentas ajenas';
    end if;
    update public.finance_categories set name = 'Intrusión'
      where space_id = v_space_a and id = 'gasolina';
    get diagnostics v_changed = row_count;
    if v_changed <> 0 then
      raise exception 'El otro espacio pudo modificar categorías ajenas';
    end if;
    v_rejected := false;
    begin
      perform public.configure_finance_space(v_space_a,'Intrusión',true,true,array['USD']);
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'El otro espacio pudo cambiar configuraciones ajenas'; end if;

    perform set_config('request.jwt.claim.sub',v_a::text,true);
    perform public.configure_finance_space(v_space_a,'Dorian y Dani',false,true,array['BOB','USD']);
    if (select enabled_currencies from public.finance_space_settings where space_id=v_space_a)
       is distinct from array['BOB','USD']::text[] then
      raise exception 'No se guardaron monedas por espacio';
    end if;
    perform public.apply_finance_entry(v_space_a, 'create', jsonb_build_object(
      'id','fixture-income', 'kind','income', 'scope','everyday', 'amount',1000,
      'currency','ARS', 'accountId','ARS-efectivo',
      'description','Ingreso ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_a, 'create', jsonb_build_object(
      'id','fixture-bob-income', 'kind','income', 'scope','everyday', 'amount',600,
      'currency','BOB', 'accountId','BOB-efectivo',
      'description','Capital ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_a, 'create', jsonb_build_object(
      'id','fixture-giro', 'kind','giro', 'scope','giro', 'amount',600,
      'currency','BOB', 'accountId','BOB-efectivo',
      'toAccountId','ARS-efectivo', 'received',1000,
      'description','Giro ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_a, 'create', jsonb_build_object(
      'id','fixture-transfer', 'kind','transfer', 'scope','everyday', 'amount',900,
      'currency','ARS', 'accountId','ARS-efectivo',
      'toAccountId','BOB-efectivo', 'received',600,
      'description','Reposición ficticia', 'date',current_date::text), gen_random_uuid());
    insert into public.finance_giro_links
      (space_id,giro_id,transfer_id,from_amount,to_amount)
      values(v_space_a,'fixture-giro','fixture-transfer',900,600);
    insert into public.finance_giro_results
      (space_id,giro_id,cost_ars,fees_ars,evidence)
      values(v_space_a,'fixture-giro',900,0,'Comprobante ficticio de reposición');
    if not exists(select 1 from public.finance_entries where space_id=v_space_a
       and id='fixture-income' and actor_user_id=v_a and actor_name='Persona A') then
      raise exception 'No se registró la autoría del movimiento ficticio';
    end if;
    v_rejected := false;
    begin
      perform public.apply_finance_entry(v_space_a, 'update', jsonb_build_object(
        'id','fixture-giro', 'kind','giro', 'scope','giro', 'amount',599,
        'currency','BOB', 'accountId','BOB-efectivo',
        'toAccountId','ARS-efectivo', 'received',1000,
        'description','Alteración prohibida', 'date',current_date::text), gen_random_uuid());
    exception when others then v_rejected := true;
    end;
    if not v_rejected or not exists(select 1 from public.finance_entries
      where space_id=v_space_a and id='fixture-giro' and amount=600) then
      raise exception 'La protección financiera permitió alterar un giro vinculado';
    end if;
    v_rejected := false;
    begin
      perform public.transfer_finance_space_owner(v_space_a,v_c);
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'Se pudo transferir administración a alguien de otro espacio'; end if;

    perform set_config('request.jwt.claim.sub',v_c::text,true);
    if (select count(*) from public.finance_entries where space_id=v_space_a) <> 0
       or (select count(*) from public.finance_giro_links where space_id=v_space_a) <> 0
       or (select count(*) from public.finance_giro_results where space_id=v_space_a) <> 0 then
      raise exception 'Otro espacio pudo leer movimientos o contabilidad ajenos';
    end if;
    delete from public.finance_categories where space_id=v_space_a and id='gasolina';
    get diagnostics v_changed = row_count;
    if v_changed <> 0 then raise exception 'Otro espacio pudo borrar una categoría ajena'; end if;
    delete from public.finance_giro_links where space_id=v_space_a;
    get diagnostics v_changed = row_count;
    if v_changed <> 0 then raise exception 'Otro espacio pudo borrar un vínculo ajeno'; end if;
    v_rejected := false;
    begin
      perform public.delete_finance_entry(v_space_a,'fixture-giro',gen_random_uuid());
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'Otro espacio pudo borrar un giro mediante RPC'; end if;

    reset role;
    insert into public.finance_push_events
      (space_id,entry_id,actor_user_id,actor_name,amount,currency,category_name)
      values(v_space_a,'fixture-a',v_a,'Persona A',10,'ARS','Prueba');
    v_rejected := false;
    begin
      delete from public.finance_giro_results
        where space_id=v_space_a and giro_id='fixture-giro';
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'Se pudieron borrar ganancias confirmadas de un espacio activo'; end if;
    v_rejected := false;
    begin
      delete from public.finance_entries
        where space_id=v_space_a and id='fixture-giro';
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'Se pudo borrar un giro vinculado de un espacio activo'; end if;
    v_rejected := false;
    begin
      delete from auth.users where id=v_a;
    exception when others then v_rejected := true;
    end;
    if not v_rejected or not exists(select 1 from auth.users where id=v_a) then
      raise exception 'Se eliminó un administrador compartido sin transferir';
    end if;

    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_a::text,true);
    perform public.transfer_finance_space_owner(v_space_a,v_b);
    reset role;
    delete from auth.users where id=v_a;
    if not exists(select 1 from public.finance_spaces where id=v_space_a)
       or (select count(*) from public.finance_accounts where space_id=v_space_a) <> 6
       or (select count(*) from public.finance_entries where space_id=v_space_a) <> 4
       or (select count(*) from public.finance_giro_links where space_id=v_space_a) <> 1
       or (select count(*) from public.finance_giro_results where space_id=v_space_a) <> 1
       or not exists(select 1 from public.finance_space_members where space_id=v_space_a and user_id=v_b and role='owner') then
      raise exception 'Eliminar un exintegrante afectó las finanzas compartidas';
    end if;
    if not exists(select 1 from public.finance_entries where space_id=v_space_a
        and id='fixture-giro' and amount=600 and received=1000
        and actor_user_id is null and actor_name='Miembro anterior')
       or not exists(select 1 from public.finance_entries where space_id=v_space_a
        and id='fixture-transfer' and amount=900 and received=600
        and actor_user_id is null and actor_name='Miembro anterior')
       or not exists(select 1 from public.finance_entries where space_id=v_space_a
        and id='fixture-income' and amount=1000)
       or not exists(select 1 from public.finance_entries where space_id=v_space_a
        and id='fixture-bob-income' and amount=600)
       or exists(select 1 from public.finance_accounts where space_id=v_space_a
        and opening<>0)
       or not exists(select 1 from public.finance_giro_results where space_id=v_space_a
        and giro_id='fixture-giro' and profit_ars=100) then
      raise exception 'La anonimización alteró giros, reposiciones o ganancias';
    end if;
    if not exists(select 1 from public.finance_entries where space_id=v_space_a
      and id='fixture-income' and actor_user_id is null and actor_name='Miembro anterior') then
      raise exception 'La atribución personal no se anonimizó';
    end if;
    if exists(select 1 from public.finance_user_profiles where user_id=v_a) then
      raise exception 'Quedó el perfil de la cuenta eliminada';
    end if;
    if exists(select 1 from public.finance_push_subscriptions where user_id=v_a)
       or exists(select 1 from public.finance_push_events where space_id=v_space_a and actor_user_id=v_a)
       or exists(select 1 from public.finance_entry_requests where space_id=v_space_a
         and result_entry->>'actor_user_id'=v_a::text) then
      raise exception 'Quedaron suscripciones o identificadores personales';
    end if;
    if not exists(select 1 from public.finance_space_invites where token=v_other_invite
       and space_id=v_space_b and created_by=v_c)
       or not exists(select 1 from public.finance_spaces where id=v_space_b)
       or not exists(select 1 from public.finance_entries where space_id=v_space_b
          and id='fixture-prior-income' and actor_user_id=v_c
          and actor_name='Persona C' and amount=10)
       or not exists(select 1 from public.finance_entry_requests where space_id=v_space_b
          and result_entry->>'actor_user_id'=v_c::text) then
      raise exception 'Eliminar al integrante A afectó invitaciones o autoría de B';
    end if;

    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_c::text,true);
    perform public.apply_finance_entry(v_space_b, 'create', jsonb_build_object(
      'id','fixture-income', 'kind','income', 'scope','everyday', 'amount',1000,
      'currency','ARS', 'accountId','ARS-efectivo',
      'description','Ingreso individual ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_b, 'create', jsonb_build_object(
      'id','fixture-bob-income', 'kind','income', 'scope','everyday', 'amount',600,
      'currency','BOB', 'accountId','BOB-efectivo',
      'description','Capital individual ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_b, 'create', jsonb_build_object(
      'id','fixture-giro', 'kind','giro', 'scope','giro', 'amount',600,
      'currency','BOB', 'accountId','BOB-efectivo',
      'toAccountId','ARS-efectivo', 'received',1000,
      'description','Giro individual ficticio', 'date',current_date::text), gen_random_uuid());
    perform public.apply_finance_entry(v_space_b, 'create', jsonb_build_object(
      'id','fixture-transfer', 'kind','transfer', 'scope','everyday', 'amount',900,
      'currency','ARS', 'accountId','ARS-efectivo',
      'toAccountId','BOB-efectivo', 'received',600,
      'description','Reposición individual ficticia', 'date',current_date::text), gen_random_uuid());
    insert into public.finance_giro_links
      (space_id,giro_id,transfer_id,from_amount,to_amount)
      values(v_space_b,'fixture-giro','fixture-transfer',900,600);
    insert into public.finance_giro_results
      (space_id,giro_id,cost_ars,fees_ars,evidence)
      values(v_space_b,'fixture-giro',900,0,'Comprobante ficticio individual');
    perform public.set_finance_giro_cash_plans(v_space_b,'fixture-giro',
      '[{"purpose":"recover","amount_ars":100,"target_currency":"BOB"}]'::jsonb);
    if (select count(*) from public.finance_giro_cash_plans where space_id=v_space_b) <> 1 then
      raise exception 'No se preparó el plan del giro individual';
    end if;
    reset role;

    insert into private.finance_deletion_holds(user_id,reason)
      values(v_c,'Prueba de conservación');
    v_rejected := false;
    begin
      delete from auth.users where id=v_c;
    exception when others then v_rejected := true;
    end;
    if not v_rejected or not exists(select 1 from auth.users where id=v_c) then
      raise exception 'No se respetó el bloqueo de conservación';
    end if;
    delete from private.finance_deletion_holds where user_id=v_c;
    delete from auth.users where id=v_c;
    if exists(select 1 from public.finance_spaces where id=v_space_b)
       or exists(select 1 from public.finance_accounts where space_id=v_space_b)
       or exists(select 1 from public.finance_entries where space_id=v_space_b)
       or exists(select 1 from public.finance_giro_links where space_id=v_space_b)
       or exists(select 1 from public.finance_giro_results where space_id=v_space_b)
       or exists(select 1 from public.finance_giro_cash_plans where space_id=v_space_b) then
      raise exception 'El espacio del único integrante no se eliminó por completo';
    end if;
    if not exists(select 1 from public.finance_spaces where id=v_space_a)
       or (select count(*) from public.finance_entries where space_id=v_space_a) <> 4
       or (select count(*) from public.finance_giro_links where space_id=v_space_a) <> 1
       or (select count(*) from public.finance_giro_results where space_id=v_space_a) <> 1
       or not exists(select 1 from public.finance_space_members
          where space_id=v_space_a and user_id=v_b and role='owner') then
      raise exception 'Se alteraron los registros financieros del espacio compartido';
    end if;
    raise exception 'DUO_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'DUO_TEST_ROLLBACK' then raise; end if;
    raise notice 'APROBADO: aislamiento RLS, transferencia y eliminación selectiva; fixtures revertidos';
  end;
end $duo_spaces_test$;
