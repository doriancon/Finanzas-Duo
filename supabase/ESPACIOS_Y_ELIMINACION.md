# Espacios independientes y eliminación de cuentas

Todo está preparado localmente. La migración `20261024000400_duo_finance_spaces_and_account_deletion.sql` depende de las migraciones anteriores, incluida la de notificaciones `00300`. No se ejecutó en Supabase.

## Antes de habilitarlo

1. Revisar la migración y el respaldo actual. Aplicarla primero solo a `duo-finance-pruebas` (`ueobsnszhtdcywppheoq`).
2. En el SQL Editor de ese proyecto, ejecutar completo `supabase/tests/sql-editor/spaces_and_deletion.sql`. Comprueba el identificador interno del proyecto y revierte los usuarios y espacios ficticios; debe mostrar `APROBADO`.
3. Confirmar la política de conservación aplicable antes de activar las eliminaciones. Un administrador puede registrar bloqueos en `private.finance_deletion_holds` para una cuenta o espacio que deban conservarse. Mientras exista un bloqueo, el trigger rechaza la eliminación.
4. Configurar en Vercel **solo para el servidor** `DUO_ACCOUNT_DELETE_SUPABASE_SECRET_KEY` con una clave secreta `sb_secret_` del mismo proyecto. `VITE_SUPABASE_PUBLISHABLE_KEY` sigue siendo la clave pública actual; la clave secreta nunca debe llevar prefijo `VITE_`.
5. Mantener `DUO_ACCOUNT_DELETION_ENABLED` sin configurar mientras no se haya verificado lo anterior. Para habilitar la ruta después, establecerlo en `true` en Vercel.

## Comportamiento

- Una persona nueva crea un espacio propio con su nombre o acepta un código válido. La creación normal inicializa seis cuentas con saldo cero, categorías y presupuesto propios. Ningún registro de otro espacio se copia.
- Las políticas RLS existentes filtran datos por membresía; las nuevas tablas filtran el perfil por usuario y las preferencias por espacio. Solo quien administra el espacio puede cambiar nombre y preferencias o transferir administración.
- Los movimientos nuevos registran el nombre visible de quien los creó. Los movimientos anteriores permanecen intactos y aparecen sin autor si no existía ese dato. Al eliminar una cuenta, su nombre en movimientos y avisos compartidos se reemplaza por «Miembro anterior» sin cambiar importes, fechas ni saldos.
- Ocultar Giros, Lencería o monedas no borra registros. Una moneda oculta con saldo o historial sigue visible en las tarjetas y puede reactivarse.
- La eliminación requiere contraseña y la frase `ELIMINAR MI CUENTA`. La API verifica ambos en el servidor y llama a `auth.admin.deleteUser` con la clave secreta. El trigger asociado a `auth.users` decide en **esa misma transacción**: único integrante → espacio y datos financieros en cascada; integrante de espacio compartido → solo su membresía, suscripciones y perfil; administrador compartido → operación rechazada hasta transferir administración.
- Las invitaciones del usuario se revocan. Los avisos históricos conservados dentro de un espacio compartido dejan de almacenar su identificador y nombre. Los movimientos financieros compartidos siguen intactos.
- La eliminación de un espacio compartido completo es un procedimiento separado y no tiene botón ni API en esta implementación.

## Límites importantes

- Una copia de seguridad JSON no es una restauración automática. La descarga desde Configuración relee los datos financieros del espacio antes de generar el archivo.
- Supabase indica que un JWT de acceso ya emitido puede seguir siendo válido hasta expirar tras borrar un usuario. La eliminación de la membresía o del espacio impide consultar las tablas financieras mediante las políticas RLS.
- Supabase puede rechazar la eliminación de un usuario que sea propietario de objetos en Storage. Duo Finance actualmente no usa Storage; si se agregan archivos en el futuro, hay que resolver esa propiedad antes de habilitar la eliminación.
- La activación definitiva requiere comprobar las obligaciones de conservación que correspondan al uso del proyecto. La tabla de bloqueos permite impedir la eliminación, pero no determina por sí sola qué debe conservarse.
