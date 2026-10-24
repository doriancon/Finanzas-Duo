# Duo Finance — base de datos (etapa 2)

Estas migraciones se prepararon para **el proyecto de Supabase ya existente**. No cambian el frontend, no leen `localStorage`, no importan el respaldo JSON y no contienen credenciales ni movimientos de ejemplo. Las tablas `finance_*` se crean vacías; las seis cuentas y los catálogos aparecen únicamente cuando un usuario autenticado llama a `create_finance_space`.

## Archivos

- `migrations/20261023000100_duo_finance_schema.sql`: tablas, claves compuestas por espacio, importes `numeric` y restricciones.
- `migrations/20261023000200_duo_finance_access.sql`: RLS, permisos, espacio compartido, invitaciones y catálogos iniciales.
- `migrations/20261023000300_duo_finance_ledger.sql`: escritura transaccional de movimientos, idempotencia y comprobación de saldos.
- `tests/database/finance_rls_and_balances.test.sql`: 31 pruebas pgTAP de permisos, datos iniciales y saldos; se revierten al terminar.

## Correspondencia con `FinanceData`

| Frontend | Base de datos |
| --- | --- |
| `accounts` | `finance_accounts` |
| `entries`, incluidos giros | `finance_entries` |
| `categories` | `finance_categories` |
| `incomeSources` | `finance_income_sources` |
| `goals`, `pasanaco` | `finance_funds`, distinguidos por `kind` |
| `budget` | `finance_budgets` (una fila por espacio) |
| `businessOpening` | `finance_business_openings` (ausencia de fila = sin configurar) |
| `incomeGoals`, `incomeGoal` | `finance_income_goals` (una fila por mes; `incomeGoal` se derivará al conectar el frontend) |
| `incomeQuotes` | `finance_income_quotes` |

Los campos de las tablas usan `snake_case`; la futura capa de acceso los convertirá a los nombres de `FinanceData`. `allocation` es histórico y no se admite como movimiento nuevo. Los importes se guardan como decimales exactos: dos posiciones para ARS, BOB y USD; seis para USDT. Las cotizaciones tienen precisión independiente. Los saldos se derivan de los saldos iniciales y del historial; no existe una columna de saldo que pueda desincronizarse.

## Acceso y escrituras

Cada usuario de Supabase Auth puede pertenecer a un espacio. El dueño llama a `create_finance_space`, crea un código con `create_finance_invite` y el segundo usuario autenticado lo acepta con `accept_finance_invite`. El espacio admite como máximo dos miembros. No se añade a nadie automáticamente al registrarse.

RLS y permisos limitan la lectura y edición de cada tabla a los miembros de su espacio. No hay políticas de escritura directa para `finance_entries`, `finance_accounts`, membresías ni invitaciones. Los movimientos se crean o editan con `apply_finance_entry(space_id, mode, entry, request_id)` y se eliminan con `delete_finance_entry(space_id, entry_id, request_id)`. `entry` usa los nombres actuales de `Entry` (`accountId`, `toAccountId`, `giroProfit`, etc.). `request_id` es un UUID nuevo por operación; repetir el mismo UUID y el mismo contenido devuelve el resultado original sin duplicar el movimiento. Reutilizarlo con otro contenido produce error.

Cada función de escritura comprueba pertenencia, bloquea la fila del espacio con `FOR UPDATE`, aplica la operación y valida todos los saldos de cuentas y fondos antes de confirmar. Esto serializa las operaciones simultáneas de los dos miembros. `set_finance_account_opening` usa el mismo bloqueo. La futura aplicación deberá usar estas RPC para el historial y los saldos iniciales; escribir directamente en tablas financieras eludiría parte de las reglas.

## Pruebas sin Docker ni WSL

Usar exclusivamente el proyecto remoto separado `duo-finance-pruebas.`. La CLI se instaló como dependencia de desarrollo (`pnpm exec supabase`, versión 2.121.0). Las migraciones ya se aplicaron allí; el procedimiento para ejecutar las pruebas en SQL Editor está en [PRUEBAS_EN_NUBE.md](PRUEBAS_EN_NUBE.md).

**Estado:** las 31 pruebas pgTAP están escritas, pero aún no se ejecutaron. `supabase test db`, incluso con `--linked`, ejecuta `pg_prove` dentro de un contenedor y no es el método para este equipo. Para SQL Editor se preparó un archivo separado en `tests/sql-editor/finance_rls_and_balances.sql`, que muestra un resumen único y revierte los datos ficticios mediante una subtransacción.

Estas migraciones no insertan movimientos ni importan el respaldo. El frontend y sus datos en `localStorage` siguen fuera de esta etapa.
