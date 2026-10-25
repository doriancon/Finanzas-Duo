# Avisos Web Push de gastos personales

El destino del código está fijado a `ueobsnszhtdcywppheoq` (`duo-finance-pruebas`).
Esta preparación local no aplica SQL, no crea webhooks y no envía avisos.

## Qué se preparó

- La migración `20261024000300_duo_finance_expense_push.sql` agrega perfiles,
  suscripciones por dispositivo, eventos de gastos e intentos de entrega.
- Un trigger inserta un evento **solo** para un `INSERT` confirmado en
  `finance_entries` con `kind = 'expense'` y `scope = 'everyday'`. Una edición,
  un giro o un cambio con Mover dinero no generan un evento.
- El webhook de Supabase debe invocar `/api/push-expense` en la misma página de
  Vercel. Esa función valida un secreto, consulta el evento real con una clave
  de servicio guardada solo en Vercel y envía Web Push. No usa el navegador
  como emisor, por lo que funciona cuando la página está cerrada.
- Cada evento y dispositivo admite un único intento de envío. Si el proveedor
  responde con error o deja de reconocer la suscripción, se registra el fallo.
  Para evitar duplicados, un fallo transitorio no se reenvía automáticamente.

## Activación, cuando autorices migración y publicación

1. Confirmá en Supabase que estás en **duo-finance-pruebas** con Project Ref
   `ueobsnszhtdcywppheoq`. Revisá la migración nueva y ejecutá **solo ese
   archivo** desde SQL Editor; `db push` podría incluir migraciones antiguas
   pendientes que no corresponden a estas notificaciones. No hay backfill:
   los movimientos existentes permanecen intactos y no producen avisos.
2. Generá **una sola vez** las claves VAPID en tu PowerShell con
   `pnpm exec web-push generate-vapid-keys --json`. Guardá la clave privada
   únicamente en las variables de Vercel; no la pegues en Git, SQL, mensajes
   ni archivos del frontend.
3. En **el proyecto Vercel de esta misma página**, configurá:

   | Variable | Valor |
   | --- | --- |
   | `VITE_PUSH_VAPID_PUBLIC_KEY` | Clave VAPID pública |
   | `DUO_PUSH_VAPID_PRIVATE_KEY` | Clave VAPID privada |
   | `DUO_PUSH_VAPID_SUBJECT` | Dirección de contacto real con formato `mailto:...` |
   | `DUO_PUSH_SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio del proyecto **de pruebas**, solo servidor |
   | `DUO_PUSH_WEBHOOK_SECRET` | Secreto aleatorio largo para autenticar el webhook |

   Conservá la variable existente `VITE_SUPABASE_PUBLISHABLE_KEY`. Nunca
   agregues la clave de servicio o VAPID privada a variables `VITE_*`.
   Elegí Production en Vercel y volvé a desplegar cuando corresponda.
4. Tras publicar el código y configurar Vercel, en Supabase Dashboard del
   proyecto **de pruebas** abrí **Database → Webhooks → Create a new hook**:
   tabla `public.finance_push_events`, evento **INSERT** solamente,
   método `POST`, URL
   `https://finanzas-duo-liard.vercel.app/api/push-expense`, encabezado
   `x-duo-push-secret` igual a `DUO_PUSH_WEBHOOK_SECRET`. No actives UPDATE o
   DELETE. El webhook de Dashboard guarda el secreto en la definición del
   trigger; mantené el archivo de respaldo privado y rotá ese secreto si se
   comparte. No incluyas el secreto en el archivo de migración.
5. Dorian y Dani deben entrar cada uno con su propia cuenta. En
   **Configuración → Notificaciones de gastos**, elegir su nombre y tocar
   **Activar notificaciones** en cada dispositivo. También pueden desactivarlas
   allí. Elegir el nombre lo guarda aunque no activen avisos en ese dispositivo;
   conviene que ambos lo hagan para que los mensajes indiquen quién gastó.
   Al cerrar sesión se elimina la suscripción del dispositivo antes de
   salir, para que no siga mostrando datos compartidos a otra persona.
6. En iPhone compatible, abrí la página en Safari, elegí **Compartir → Añadir
   a pantalla de inicio**, abrí el ícono DyD instalado y activá las
   notificaciones desde esa app. En Chrome, Edge y Android basta un navegador
   compatible sobre HTTPS y permitir las notificaciones al tocar el botón.

## Verificación posterior

- Registrá un gasto personal real de prueba autorizado en el espacio
  compartido. El otro dispositivo activado debe recibir importe, moneda,
  categoría y nombre, incluso con la página cerrada. El dispositivo emisor
  también recibe el aviso si está activado.
- Editar el gasto no debe generar otro aviso. Crear un giro o usar Mover
  dinero tampoco debe generar avisos.
- Si falta un aviso, revisá los registros de la función de Vercel, el
  historial del webhook en Supabase y `finance_push_deliveries` con acceso de
  administrador. Ninguna de esas comprobaciones modifica los saldos.
- La entrega final depende del navegador, del sistema operativo y del servicio
  push. El registro de un intento evita que nuestro servidor envíe el mismo
  evento dos veces al mismo dispositivo; no puede garantizar que el sistema
  operativo muestre cada aviso.
