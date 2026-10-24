-- Solo lectura para la copia PostgreSQL local. PREPARADO, NO EJECUTADO.
-- Abortará si el destino no es exactamente 127.0.0.1:5433/duo_respaldo_verificacion.
do $local_guard$
begin
  if current_database() <> 'duo_respaldo_verificacion' or
     inet_server_addr() is distinct from inet '127.0.0.1' or
     inet_server_port() <> 5433 then
    raise exception 'Destino incorrecto: se requiere la base local de verificación';
  end if;
end
$local_guard$;

select
  (select count(*) from public.finance_entries) as movimientos,
  (select count(*) from public.finance_accounts) as cuentas,
  (select count(*) from public.finance_spaces) as espacios,
  (select count(*) from public.finance_space_members) as miembros,
  (select count(*) from auth.users) as usuarios,
  (select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.space_id,e.id)::text,'[]'))
     from public.finance_entries e) as movimientos_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.space_id,a.id)::text,'[]'))
     from public.finance_accounts a) as cuentas_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'[]'))
     from public.finance_spaces s) as espacios_sha_logico,
  (select md5(coalesce(jsonb_agg(to_jsonb(m) order by m.space_id,m.user_id)::text,'[]'))
     from public.finance_space_members m) as miembros_sha_logico;
