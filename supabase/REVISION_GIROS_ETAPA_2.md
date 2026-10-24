# Revisión previa de la migración de giros

Estado: **preparado, no ejecutado**. No se aplicó la migración nueva en ninguna base.

## Alcance de la copia local

`127.0.0.1:5433/duo_respaldo_verificacion` contiene las tablas y filas financieras restauradas de forma selectiva, pero no contiene el entorno completo de Supabase Auth: faltan `auth.uid()`, `private.is_finance_member(uuid)`, los roles `anon` y `authenticated`, las políticas RLS y los permisos originales. La migración depende de esos objetos. Ejecutarla parcialmente o simularlos omitiendo RLS no validaría los permisos reales. Por ello **no aplicar la migración a esa base**.

El archivo [giro_accounting_baseline_readonly.sql](tests/database/giro_accounting_baseline_readonly.sql) está listo para obtener, cuando se decida, recuentos y huellas lógicas de las filas locales sin modificarlas. Debe mostrar 3 movimientos, 6 cuentas, 1 espacio, 2 miembros y 2 usuarios si la copia sigue como se informó. La huella lógica de cuentas y movimientos permite comparar exactamente el contenido antes y después de una prueba futura en otra copia completa. No es el SHA256 del archivo `.dump`.

## Revisión estática

La migración sólo crea dos tablas nuevas, dos índices, tres funciones de disparador, tres disparadores, políticas RLS y permisos. No ejecuta `INSERT`, `UPDATE` ni `DELETE` sobre `finance_entries` o `finance_accounts`. Los vínculos apuntan a movimientos ya existentes; no crean otro asiento ni vuelven a ajustar saldos. Una fila de resultado confirmada conserva su mes y ganancia, incluso si después se registran reposiciones. La escritura de vínculos toma un bloqueo de la fila `finance_spaces`, el mismo candado que usa `apply_finance_entry`; así se serializa el límite de asignación dentro de un espacio.

Se corrigió un permiso faltante: se revocan explícitamente los permisos iniciales de `PUBLIC`, `anon` y `authenticated` sobre ambas tablas antes de conceder sólo las operaciones necesarias a `authenticated`. Supabase puede conceder permisos iniciales a tablas nuevas en `public`; RLS por sí solo no retira esos permisos.

## Secuencia mínima con el proyecto de pruebas existente

El vínculo local `supabase/.temp/project-ref` apunta a `ueobsnszhtdcywppheoq` (`duo-finance-pruebas`). Las tres migraciones anteriores y sus 31 pruebas ya se ejecutaron allí. No es necesario volver a crear un proyecto, instalar herramientas ni repetir el respaldo.

El código de esta misma aplicación apunta a ese ref. Aunque se llame proyecto de pruebas, debe tratarse como una base activa si la versión publicada también usa esa compilación. La consulta previa y posterior protege la comparación; la autorización para aplicar la migración sigue pendiente.

1. **Antes de autorizar la cuarta migración:** abrir [giro_accounting_pruebas_estado.sql](tests/sql-editor/giro_accounting_pruebas_estado.sql) en el SQL Editor de `ueobsnszhtdcywppheoq`. Es de solo lectura, comprueba el identificador interno conocido del clúster y devuelve recuentos y huellas de usuarios, espacios, miembros, cuentas y movimientos. Guardar esa única fila. Si las tablas nuevas ya existen, detenerse y revisar el historial de migraciones. Mientras se toma esta referencia, no registrar movimientos nuevos; si los hay, repetir la referencia justo antes de migrar.
2. **Después de autorización expresa:** aplicar sólo `20261024000100_duo_finance_giro_accounting.sql` al proyecto de pruebas. No usar el proyecto principal ni desplegar el frontend todavía.
3. Repetir el archivo de solo lectura. Deben permanecer iguales los recuentos y huellas de usuarios, espacios, miembros, cuentas y movimientos. Sólo deben cambiar los indicadores de existencia de las dos tablas nuevas, de `false` a `true`.
4. Ejecutar completo en el SQL Editor [giro_accounting_pruebas.sql](tests/sql-editor/giro_accounting_pruebas.sql). Sus **27 comprobaciones** incluyen RLS y permisos, segundo miembro, aislamiento de otro espacio, vínculos compartidos y parciales, rechazo de sobreasignación, ganancia individual y mensual, inmutabilidad y ausencia de cambios en movimientos/cuentas. Usa usuarios y espacios aleatorios dentro de una subtransacción que siempre revierte; un error inesperado aborta la sentencia. Debe mostrar `APROBADO: 27 de 27; datos ficticios revertidos`. El script sólo acepta el identificador interno ya verificado de `duo-finance-pruebas` y no requiere que el proyecto esté vacío.

La nueva prueba SQL **no se ha ejecutado**; las 27 comprobaciones siguen pendientes. La consulta de referencia y la prueba de 27 casos son las verificaciones imprescindibles para este cambio antes de publicar. Las 31 pruebas anteriores ya cubrieron el esquema existente y no hace falta repetirlas para decidir sobre esta migración. Una carrera auténtica entre dos sesiones tampoco está demostrada por el script: el bloqueo común de `finance_spaces` y el rechazo de sobreasignación se revisaron en código, pero si se necesita demostrar concurrencia real, hay que probarla con dos conexiones al proyecto de pruebas después de aplicar la migración. No usar `supabase test db` sin Docker: usa la pila local de Supabase.
