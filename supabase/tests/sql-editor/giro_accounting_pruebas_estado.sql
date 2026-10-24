-- SOLO LECTURA. Ejecutar archivo completo en duo-finance-pruebas
-- (Project Ref ueobsnszhtdcywppheoq) antes y después de la cuarta migración.
-- No usar en el proyecto principal. Guardar los resultados para compararlos.
do $duo_pruebas_guard$
declare v_cluster text;
begin
  select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  if v_cluster is distinct from '7692130048193495360' then
    raise exception 'Destino equivocado: se requiere duo-finance-pruebas';
  end if;
end
$duo_pruebas_guard$;

select
  (select system_identifier::text from pg_catalog.pg_control_system()) as cluster,
  to_regclass('public.finance_giro_links') is not null as tabla_vinculos_existe,
  to_regclass('public.finance_giro_results') is not null as tabla_resultados_existe,
  (select count(*) from auth.users) as usuarios,
  (select md5(coalesce(jsonb_agg(u.id order by u.id)::text,'[]'))
     from auth.users u) as usuarios_ids_sha_logico,
  (select count(*) from public.finance_spaces) as espacios,
  (select count(*) from public.finance_space_members) as miembros,
  (select count(*) from public.finance_accounts) as cuentas,
  (select count(*) from public.finance_entries) as movimientos,
  (select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.space_id,e.id)::text,'[]'))
     from public.finance_entries e) as movimientos_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.space_id,a.id)::text,'[]'))
     from public.finance_accounts a) as cuentas_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'[]'))
     from public.finance_spaces s) as espacios_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(m) order by m.space_id,m.user_id)::text,'[]'))
     from public.finance_space_members m) as miembros_sha_logico;
