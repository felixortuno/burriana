# BURRIANA · GTR SOLUTIONS

Aplicación de coordinación e inventario para el almacén de cartón y cajas. Palets completos; un viaje transforma planchas en cajas para reponer stock.

## Primera fase

- **Pantalla sobre la puerta** (`/pantalla`): turno, almuerzo, avisos, viajes, pedidos, cargas/descargas y mantenimiento/limpieza. Solo lectura; consulta cada 10 segundos y rota las listas cada 15.
- **Encargado** (`/`, `/operaciones`, `/inventario`): organiza el trabajo, confirma avances y gestiona referencias, bloques y stock.
- **Administrador** (`/usuarios`): dashboard global, todas las operaciones y alta/desactivación de accesos.
- Completar un viaje consume planchas y registra cajas en un único guardado, con dos movimientos vinculados. Las cantidades de origen/destino pueden ser distintas y siempre son palets enteros.
- Mantenimiento y limpieza pueden repetirse tras su finalización. El encargado decide prioridades, urgencias e inicio.

Los pedidos, cargas y descargas son órdenes de trabajo. Sus entradas/salidas de stock se registran por separado; todavía no hay reservas ni líneas de pedido. Las tablets para confirmar trabajo por operarios son una fase futura.

Consulta la **[guía completa del backend y puesta en marcha](docs/BACKEND_Y_PUESTA_EN_MARCHA.md)** o su [versión HTML imprimible](docs/BACKEND_Y_PUESTA_EN_MARCHA.html). Describe campos, permisos, rutas, producción, copias y carga inicial. Los pendientes están en [TODO_APP.md](TODO_APP.md).

## Desarrollo seguro con datos locales

Node 22.13 o superior. Instalar con `npm ci`. Configurar `WAREHOUSE_ADMIN_USER` y `WAREHOUSE_ADMIN_PASSWORD` en `.env.local`.

```sh
WAREHOUSE_LOCAL_DATA_DIR=outputs/dev-data/mi-prueba npm run dev -- --webpack --hostname 127.0.0.1
```

El modo explícito local escribe `warehouse.json` y `users.json` en ese directorio y se rechaza en producción. Un directorio nuevo empieza sin inventario ni órdenes. La demostración de esta entrega está en `outputs/dev-data/refocus`, identificada como DEMO LOCAL.

**Sin `WAREHOUSE_LOCAL_DATA_DIR`, incluso en desarrollo, se usa Postgres**: `DATABASE_URL` tiene prioridad sobre `POSTGRES_URL`. No hacer ensayos de escritura con las variables de producción. No subir `.env` ni copias de datos.

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build -- --webpack
```

## Persistencia y acceso

Next.js sirve UI y API. Postgres conserva el estado del almacén en `public.warehouse` como JSON con revisión optimista; stock e histórico se guardan juntos. `public.warehouse_users` guarda cuentas individuales con contraseña scrypt, rol, estado activo y versión de sesión. La inicialización idempotente crea/protege las tablas con RLS y revoca acceso público. Los permisos de negocio se verifican en el servidor.

La cuenta principal procede del entorno y no se puede desactivar desde la interfaz. Las sesiones duran ocho horas; desactivar o modificar una cuenta revoca sus tokens anteriores. La pantalla tiene cuenta propia de consulta, sin acceso al inventario completo ni a escrituras.

La copia JSON incluye órdenes y horarios, pero **no cuentas**. El importador valida antes de restaurar:

```sh
node --experimental-strip-types scripts/import-state.mjs copia.json --check
```

La restauración escribe en la base definida por el entorno y reemplaza todo el estado; requiere `--force` si ya hay datos o configuración personalizada. Debe ensayarse con copia previa en una base aislada, incluyendo la recuperación de usuarios por separado. Consulta la guía antes de ejecutarla.

Esta revisión no despliega la nueva versión ni carga el inventario real. Antes del primer turno: validar con Postgres de pruebas, verificar recuperación, crear accesos reales, configurar el dispositivo de pantalla y conciliar un recuento físico.
