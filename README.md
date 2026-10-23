# Duo Finance

Aplicación financiera local para Dorian y Dani.

## Ejecutar

```bash
npm install
npm run dev
```

Abrí la dirección que muestra Vite, normalmente [http://localhost:5173/](http://localhost:5173/). Para verificar la compilación: `npm run build` y `node --test tests/domain.test.mjs`.

## Datos y cuentas

La aplicación comienza sin movimientos ficticios. Los datos se guardan en `localStorage` **solo en este navegador y dispositivo**. No existe todavía una base de datos compartida, autenticación, sincronización entre dispositivos ni conexión bancaria. Conviene conservar una copia del perfil del navegador antes de borrar sus datos. La migración lee los datos personales anteriores y conserva los registros originales en sus claves previas como respaldo técnico; la aplicación activa no tiene papelera.

ARS y BOB tienen Efectivo y Transferencia; USD solo Efectivo; USDT solo Billetera. Los saldos iniciales se configuran en **Administrar cuentas**. Todas las entradas y salidas, incluidas Lencería y Giros, afectan esas cuentas generales. Mover dinero usa los dos importes indicados y no crea ingreso ni gasto. Los aportes y retiros de Ahorros modifican la cuenta y el fondo sin contarse como consumo.

**Presupuesto** y los gráficos de gastos cotidianos usan únicamente gastos clasificados como Vida cotidiana. **Lencería** muestra un saldo atribuido con saldo inicial configurable, gastos por categoría y movimientos propios; el indicador no es una billetera. Los aportes a Ahorros pueden clasificarse como Lencería para que el saldo atribuido también refleje esa reserva, sin crear un gasto doméstico. Los cobros del negocio no se toman como utilidad personal. La antigua asignación interna ya no se crea ni cuenta como ingreso.

**Giros** guarda cada operación una sola vez. Descuenta lo entregado de la cuenta de origen y suma el total cobrado a la cuenta receptora. La ganancia opcional se anota dentro de lo cobrado y no se suma de nuevo al saldo. Se incluye una sola vez en el análisis de ingresos cuando se identifica, en su moneda registrada; el total cobrado no se trata como ingreso laboral.

**Movimientos** reúne todo el historial. Permite editar y eliminar definitivamente con confirmación, buscar, filtrar por mes, moneda, categoría, ámbito y tipo, y paginar con 10, 20 o 50 registros. Las modificaciones recalculan saldos y análisis a partir del único historial.

**Análisis → Nuestro crecimiento** consolida ingresos usando cotizaciones manuales guardadas por mes sin convertir los saldos reales.

