# Duo Finance — etapa 3 en `duo-finance-pruebas`

## Conectar el frontend existente

1. En el panel de Supabase abrí **solo** el proyecto `duo-finance-pruebas` (Project Ref `ueobsnszhtdcywppheoq`).
2. En **Project Settings → API Keys**, copiá la clave **publishable** o **anon**. No uses `service_role` ni una clave secreta. La URL del proyecto de pruebas está fijada en `src/supabase.ts`.
3. En la raíz del repositorio, copiá `.env.example` a `.env.local` y pegá la clave en `VITE_SUPABASE_PUBLISHABLE_KEY`. `.env.local` está ignorado por Git. No compartas este archivo.
4. Ejecutá `pnpm dev`. Si la app ya estaba abierta, reiniciá Vite para que lea `.env.local`.
5. En Supabase Auth, comprobá que el proveedor **Email** esté habilitado. Si se exige confirmar el correo, Dorian y Dani deben abrir sus enlaces de confirmación antes de iniciar sesión. Configurá las URL de redirección de Auth para la URL local donde abre Vite si querés que el enlace vuelva a la app.

En esta computadora, `.env.local` ya quedó configurado con la clave `anon` del Project Ref `ueobsnszhtdcywppheoq`; el valor no se muestra ni se versiona. Una consulta HTTPS anónima de solo lectura a `finance_accounts` devolvió `401 / 42501 permission denied`, que es el rechazo esperado para un usuario sin sesión.

Sin `VITE_SUPABASE_PUBLISHABLE_KEY`, la app conserva su modo local anterior. Con esa clave, el frontend se conecta **únicamente** a `https://ueobsnszhtdcywppheoq.supabase.co`, exige Auth y carga las tablas del espacio compartido. No copia automáticamente `duo-v4-data` a Supabase; el respaldo JSON local sigue disponible incluso en las pantallas de inicio de sesión y de creación del espacio, además de la barra lateral.

## Primer acceso de Dorian y Dani

1. Dorian crea su usuario e inicia sesión. Elige **Crear espacio para Dorian y Dani**. Esto crea un espacio nuevo y vacío con seis cuentas y los catálogos iniciales. No toca los datos locales.
2. Dorian pulsa **Invitar** en la barra superior y comparte el código solo con Dani. El código vence en siete días.
3. Dani crea su propio usuario e inicia sesión en otro navegador o dispositivo. En la pantalla inicial pega el código y pulsa **Unirme al espacio**. No debe crear otro espacio.
4. Ambos ven los mismos datos. El frontend consulta la base al abrir la app, al recuperar el foco y cada cinco segundos mientras está abierta.

## Pruebas de aceptación en el proyecto de pruebas

Hacelas en un espacio recién creado y vacío. No uses el proyecto principal ni importes todavía el respaldo.

1. **Invitación y acceso:** Dorian crea el espacio; Dani acepta el código. Ambos ven seis cuentas. Un tercer usuario, sin invitación, no ve ese espacio. La base ya pasó las 31 pruebas SQL, que incluyen RLS, invitación y límite de dos miembros.
2. **Sincronización:** Dorian crea una categoría y un movimiento pequeño. Dani los ve en un máximo de cinco segundos o al volver a la pestaña. Dani edita el movimiento; Dorian ve el mismo importe actualizado.
3. **Permisos:** Un tercer usuario que inicia sesión solo puede crear su propio espacio; no puede consultar ni editar el de Dorian y Dani. Una invitación solo se genera desde la cuenta dueña.
4. **Operaciones simultáneas:** En un espacio sin otros movimientos, configurá `ARS-efectivo` con saldo inicial 100. En dos dispositivos con el saldo visible en 100, intentá guardar a la vez un gasto de 80 ARS desde esa cuenta. Debe persistir un solo gasto; el otro debe mostrar rechazo por saldo insuficiente. El saldo final debe ser 20 ARS. Repetí la prueba con dos transferencias si querés comprobar ambas cuentas. Los RPC de la migración bloquean la fila del espacio y vuelven a validar el saldo antes de confirmar.
5. **Respaldo:** En el dispositivo que guarda `duo-v4-data`, pulsá **Descargar respaldo** y verificá el JSON antes de considerar una migración de datos. Esta etapa no importa ese archivo.

Las pruebas automatizadas locales se ejecutan con `node --test tests/*.test.mjs`; `pnpm run build` verifica TypeScript y Vite. La prueba automatizada del adaptador comprueba que dos envíos usan RPC e identificadores independientes, pero no sustituye la prueba real de concurrencia con dos sesiones sobre Supabase.
