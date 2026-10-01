# Acceso privado al inventario

La aplicación accede a `public.warehouse` mediante una conexión Postgres del
propietario de la tabla. El Data API de Supabase no forma parte de este flujo.

La inicialización de `db/supabase-warehouse.ts` aplica, dentro de la misma
transacción y después del bloqueo de inicialización:

1. Creación de `public.warehouse`, solo si no existe.
2. Activación de Row Level Security.
3. Revocación de todos los permisos de tabla de `anon`, `authenticated` y `PUBLIC`.

Las sentencias están versionadas en `db/postgres-warehouse.ts` y son idempotentes.
Se aplican también sobre una tabla existente, sin sustituir su contenido ni
alterar la revisión. La lectura o escritura no continúa si falla cualquiera de
ellas. El importador utiliza el mismo almacén y pasa por esta inicialización.
No se usa `FORCE ROW LEVEL SECURITY`: el propietario conserva acceso directo.
No se conceden políticas al cliente ni se cambian permisos de otras tablas.

## Verificación de un despliegue

Tras desplegar, realizar una lectura autenticada para ejecutar la inicialización.
Comprobar con acceso administrativo que `public.warehouse` tiene RLS activada,
que los roles `anon`, `authenticated` y `PUBLIC` carecen de permisos sobre ella,
y que su revisión y contenido se conservan. Comprobar además que el Data API
rechaza la lectura anónima y que `/api/warehouse` sigue siendo accesible con una
sesión válida y rechaza peticiones sin sesión. Repetir la lectura autenticada
para verificar que la inicialización sigue funcionando sobre la tabla protegida.

Las pruebas de `tests/postgres-store.test.mjs` comprueban la espera y el cierre
ante fallos de inicialización con un adaptador aislado. No sustituyen una prueba
de permisos real en Postgres ni una comprobación del Data API desplegado.

## Trabajo posterior

Esta corrección mantiene el mecanismo de inicialización existente. Queda
pendiente mover el DDL a migraciones de despliegue y usar un rol de ejecución con
permisos mínimos. La revocación se limita a esta tabla: no desactiva el Data API
ni cambia los permisos por defecto de futuras tablas. No se debe volver a una
versión que restaure concesiones públicas al inventario.
