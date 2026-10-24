# Duo Finance: verificar las 31 pruebas en Supabase SQL Editor

Las tres migraciones ya se aplicaron al proyecto de pruebas. Esta guía **no** contiene comandos para volver a aplicarlas. No usa Docker ni WSL.

## Destino comprobado

La CLI enumeró estos proyectos el 23 de octubre de 2026:

| Nombre mostrado por Supabase | Project Ref |
| --- | --- |
| `duo-finance-pruebas.` | `ueobsnszhtdcywppheoq` |
| `duo-finance` (principal) | `dxlthumgvhaaazawygcg` |

El vínculo local `supabase/.temp/project-ref` contiene `ueobsnszhtdcywppheoq`. Una consulta **de solo lectura** dirigida a ese ref encontró 13 tablas `finance_*`, todas con RLS activo. También encontró 0 usuarios con los tres correos ficticios de la prueba y confirmó que pgTAP aún no está instalado. No se consultó ni modificó la base principal.

El script SQL no puede leer de forma confiable el Project Ref del panel (la configuración `app.settings.project_ref` devuelve `NULL` en el proyecto de pruebas). Por eso **verificá la URL y el nombre en el panel antes de pulsar Run**. Si ves el ref `dxlthumgvhaaazawygcg`, cerrá esa pestaña. Como segunda protección, el script compara el identificador interno del clúster PostgreSQL obtenido en una consulta de solo lectura al proyecto de pruebas. Si no coincide, se detiene **antes** de crear pgTAP, usuarios o movimientos. Si Supabase reemplaza el clúster en el futuro, también se detendrá y habrá que revisar el identificador antes de reintentar.

## Ejecutar en SQL Editor

1. Abrí [el panel del proyecto de pruebas](https://supabase.com/dashboard/project/ueobsnszhtdcywppheoq). En la URL debe figurar `ueobsnszhtdcywppheoq`, y en el selector debe figurar `duo-finance-pruebas.`.
2. Entrá a **SQL Editor** y elegí una consulta nueva.
3. En tu computadora, abrí `supabase/tests/sql-editor/finance_rls_and_balances.sql`. Copiá **todo** su contenido, desde el comentario inicial hasta el `SELECT` final; pegalo en la consulta nueva. No copies el archivo original de `supabase/tests/database/` para este paso.
4. Sin seleccionar solo una parte del texto, pulsá **Run** una vez. Si el editor advierte que el SQL puede modificar datos, comprobá nuevamente el proyecto y aceptá únicamente para `duo-finance-pruebas.`.

El archivo de SQL Editor ejecuta las mismas 31 aserciones pgTAP del archivo original. Crea pgTAP si falta, tres usuarios ficticios, un espacio, cuentas y movimientos **dentro de un bloque con subtransacción**. Al terminar, provoca y captura un error intencional que revierte el bloque completo. Si una sentencia falla antes, PostgreSQL también revierte ese bloque. Solo queda una tabla temporal de sesión con el resumen, sin usuarios ni finanzas ficticias permanentes.

La versión actual no contiene `TRUNCATE` ni un `UPDATE` sin `WHERE`. Esas dos instrucciones actuaban sobre tablas temporales, pero podían generar las advertencias del editor y eran riesgosas si se ejecutaban aisladas. El editor puede seguir mostrando una advertencia general porque el bloque crea y modifica datos ficticios antes de revertirlos; su detector no comprueba la reversión. Ejecutá siempre el archivo completo y comprobá el Project Ref antes de confirmar.

## Interpretar el resultado

Debe aparecer **una fila** con:

- `resultado`: `APROBADO: 31 de 31; datos ficticios revertidos`
- `total`: `31`
- `aprobadas`: `31`
- `fallidas`: `0`
- `diagnostico`: vacío

La columna `detalle` contiene las 31 líneas de pgTAP. Si ves `REVISAR`, un error SQL o cualquier `not ok`, **las pruebas no pasaron**; conservá el texto del error o del detalle para corregir el archivo de pruebas. No vuelvas a ejecutar las migraciones.

Como comprobación adicional de solo lectura, desde PowerShell en la raíz del repositorio podés ejecutar:

```powershell
$refPruebas = 'ueobsnszhtdcywppheoq'
if ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -ne $refPruebas) { throw 'El vínculo no apunta al proyecto de pruebas' }
pnpm exec supabase db query --linked --project-ref $refPruebas "select (select count(*) from auth.users where email in ('duo-a@example.test','duo-b@example.test','outsider@example.test')) as usuarios_ficticios, (select count(*) from public.finance_spaces where name = 'Prueba Duo') as espacios_ficticios, exists(select 1 from pg_catalog.pg_extension where extname = 'pgtap') as pgtap_persistente"
```

Los dos recuentos deben ser **0** y `pgtap_persistente` debe ser **false**, igual que antes de la prueba. Esta consulta tampoco modifica datos. Las 31 pruebas cubren RLS básico, acceso de dos miembros, rechazo de un tercero, idempotencia y saldos de gastos, transferencias, ahorros y giros; todavía no simulan dos sesiones escribiendo al mismo tiempo.
