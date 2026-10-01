# Backend de Burriana y puesta en marcha

Guía técnica y operativa · Nuevo enfoque del almacén

Revisión del 1 de octubre de 2026 · GTR Solutions · Implementación local pendiente de despliegue

Esta guía describe el código después del cambio de enfoque. Sustituye la propuesta inicial de dos perfiles «oficina y operarios». Ahora existen **administrador, encargado y pantalla**. Los operarios consultan una pantalla sobre la puerta; durante la primera fase, el encargado registra los avances. El administrador también puede operar. Las tablets para que el equipo confirme trabajos quedan para una segunda fase.

Un **viaje** es la transformación de planchas en cajas para reponer stock. No significa transporte de camión. Tanto el consumo como la producción y el resto del inventario se cuentan en **palets completos**.

La app local contiene una demostración identificada como «DEMO LOCAL», con referencias y órdenes ficticias. No representa el inventario de la nave. En esta implementación no se ha desplegado la nueva versión ni se han escrito operaciones en la base publicada.

## 1. Qué hay implementado y qué falta

| Área | Implementado en el código local | Pendiente para el uso real |
| --- | --- | --- |
| Pantalla del almacén | Reloj de Madrid, turno, almuerzo, aviso, trabajo destacado, producción/pedidos, muelle y mantenimiento/limpieza; actualización automática | Probar tamaño, distancia de lectura, conexión y arranque en el televisor real |
| Encargado | Crear, editar, empezar, pausar, completar y cancelar órdenes; horarios; stock, movimientos, ubicaciones y cierre | Alta de referencias, bloques, capacidades y recuento inicial reales |
| Administrador | Dashboard global, todas las operaciones y alta/desactivación de cuentas | Crear cuentas individuales y una cuenta exclusiva para la pantalla en el entorno definitivo |
| Viajes | Consumo de planchas y producción de cajas en un único guardado, vinculados a la orden | Definir los SKU reales de planchas/cajas y confirmar las cantidades de cada viaje |
| Mantenimiento y limpieza | Programación manual y repetición tras completar; el encargado decide inicio y cierre | Concretar máquinas, trabajos, frecuencias y responsables |
| Pedidos y camiones | Órdenes con referencia, instrucciones, matrícula y hora prevista; estados e historial | Si se necesita, añadir líneas de pedido, reservas y vínculo automático con entradas/salidas |
| Datos y seguridad | Roles comprobados en servidor, identidades, revocación, hashes de contraseña, control de revisión | Ensayo del nuevo esquema de usuarios, concurrencia y restauración en Postgres de pruebas |
| Copias | JSON del estado completo; importador con validación local `--check` | Copia de la tabla de usuarios, copias automáticas y ensayo de recuperación |
| Tablets | La identidad y los eventos permiten ampliación | Interfaz de operario, permisos, identificación y confirmación desde las columnas |

La primera fase funcional está implementada y ensayada localmente. Eso no equivale a acreditar una puesta en producción con datos reales: las pruebas de base remota, dispositivos físicos y recuperación siguen pendientes.

## 2. Perfiles y pantallas

| Capacidad | Administrador | Encargado | Pantalla |
| --- | --- | --- | --- |
| Dashboard, stock e inventario completo | Sí | Sí | No |
| Crear y organizar órdenes | Sí | Sí | No |
| Marcar inicio, pausa, finalización o cancelación | Sí | Sí | No |
| Configurar turno, almuerzo y aviso | Sí | Sí | No |
| Dar de alta referencias y ubicaciones | Sí | Sí | No |
| Entradas, salidas, traslados y cierre | Sí | Sí | No |
| Descargar CSV y copia JSON del almacén | Sí | Sí | No |
| Crear o desactivar cuentas | Sí | No | No |
| Consultar la pantalla de trabajo | Sí | Sí | Sí |

Las rutas son `/` para el dashboard, `/operaciones` para organizar el turno, `/inventario` para existencias y movimientos, `/usuarios` para accesos y `/pantalla` para el dispositivo sobre la puerta. Una cuenta de pantalla se dirige a `/pantalla`; el servidor deniega su acceso al inventario y a las mutaciones, aunque intente invocar la API directamente.

El administrador y el encargado ven los mismos datos del almacén. La diferencia está en la gestión de accesos y en el contexto de su portada. No hay almacenes separados por usuario ni permisos por pasillo. La pantalla recibe una proyección de órdenes y horarios; no recibe el inventario completo ni las contraseñas.

En «Personas y accesos», eliminar se realiza como **desactivación**. Se revoca la sesión y se conserva el registro para mantener la autoría. No se reutiliza el mismo nombre de usuario. La cuenta principal definida en el servidor no se puede desactivar desde la app; tampoco se permite desactivar la propia cuenta.

## 3. Arquitectura y archivos

La aplicación es Next.js con React. El mismo proyecto sirve la interfaz y las rutas HTTP; no hay un servidor Express aparte. La persistencia de producción es Postgres alojado en Supabase, conectado desde el servidor con `postgres`. No se usa Supabase Auth ni Realtime para estos flujos.

```text
Navegador: administrador / encargado / pantalla
    │ cookie firmada + petición HTTP
    ▼
proxy.ts: comprobar firma y vencimiento
    ▼
API: resolver usuario activo y rol en servidor
    │ comprobar origen y validar la petición
    ▼
applyAction: copiar estado y aplicar reglas
    ▼
WarehouseStore: guardar solo si coincide revision
    ▼
Postgres privado
    ├── public.warehouse: inventario, órdenes y turno
    └── public.warehouse_users: cuentas individuales
```

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `app/components/management.tsx` y `.css` | Dashboard, órdenes, horarios y administración de cuentas |
| `app/components/management-user.ts` | Resolver identidad y proteger las páginas de gestión |
| `app/inventario/inventory-client.tsx` | Catálogo, bloques, movimientos, plan 5S, cierre y exportaciones |
| `app/pantalla/board.tsx` y `.css` | Panel de lectura, reloj, avisos, refresco y rotación de listas |
| `hooks/use-warehouse.ts` | Lectura común, sincronización, guardado y tratamiento de conflictos |
| `lib/identity.ts` | Roles y tipos públicos de identidad, sin contraseñas |
| `lib/warehouse.ts` | Estado, inventario, movimientos, cierre y producción atómica |
| `lib/operations.ts` | Órdenes, estados, prioridades, recurrencia, turno y almuerzo |
| `lib/server/warehouse-api.ts` | Contrato de lectura/escritura y revisión optimista |
| `lib/server/warehouse-handlers.ts` | Conectar API con permisos, identidad y almacenamiento |
| `lib/server/store.ts` | Elegir Postgres o almacenamiento local explícito de desarrollo |
| `db/postgres-warehouse.ts` | SQL del estado y escritura condicional |
| `db/supabase-warehouse.ts` | Conexión privada e inicialización del almacén |
| `lib/server/session.ts` | Credenciales principales, firma HMAC y cookies |
| `lib/server/access.ts` | Resolver identidad actual y comprobar permisos/origen |
| `lib/server/users.ts` y `users-store.ts` | Hash de contraseñas, altas, cambios, desactivaciones y persistencia de cuentas |
| `lib/server/users-api.ts` | API administrativa de cuentas |
| `app/api/board/route.ts` | Proyección limitada de órdenes y horarios para la pantalla |
| `scripts/import-state.mjs` | Validar o restaurar el estado del almacén |

## 4. Cómo se guarda la información

### Estado único del almacén

La tabla operativa tiene una única fila posible:

```sql
CREATE TABLE IF NOT EXISTS public.warehouse (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL CHECK (revision >= 0),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);
```

`revision` cuenta cambios del estado; no es la versión del formato. `data` contiene seis colecciones y un objeto de configuración:

```json
{
  "products": [],
  "locations": [],
  "movements": [],
  "tasks": [],
  "closures": [],
  "workOrders": [],
  "shift": {
    "startTime": "07:00",
    "endTime": "15:00",
    "lunchStart": "",
    "lunchEnd": "",
    "announcement": ""
  }
}
```

El ejemplo explica la estructura; no es una copia para importar. El estado inicial también propone nueve tareas 5S. Los documentos antiguos, sin `workOrders` o `shift`, se normalizan al leer: se añaden órdenes vacías y el turno por defecto, con el almuerzo sin fijar. La lectura por sí sola no inventa pedidos, viajes ni existencias.

Cada escritura sustituye el JSON completo y aumenta la revisión en uno. No existen tablas independientes de pedidos, líneas, palets o movimientos. Las relaciones internas se comprueban en TypeScript; Postgres protege la fila y el control de revisión. Este diseño simplifica el arranque, pero exige medir el crecimiento del histórico y la contención cuando aumente el número de dispositivos.

### Cuentas separadas

`public.warehouse_users` guarda `id`, `username` único en minúsculas, `name`, `role`, `password_hash`, `active`, `session_version`, `created_at` y `updated_at`. El rol está limitado a administrador, encargado o pantalla. La contraseña nunca se devuelve en las APIs de consulta.

La cuenta principal es virtual: procede de `WAREHOUSE_ADMIN_USER` y `WAREHOUSE_ADMIN_PASSWORD`, tiene ID `bootstrap` y rol administrador. Permite gestionar las primeras cuentas sin depender de que ya exista otro administrador.

### Conexión y protección

La conexión usa `DATABASE_URL`, o `POSTGRES_URL` si la primera no está definida. La inicialización crea las tablas si faltan, activa RLS y revoca permisos de `anon`, `authenticated` y `PUBLIC`. Se serializa con bloqueos de transacción distintos para almacén y usuarios. El servidor conecta con su credencial privada; el navegador no recibe esa conexión.

Los roles de negocio se comprueban en la API, no mediante políticas de Supabase Auth. RLS cierra el acceso público directo a las tablas; no convierte la cuenta SQL del servidor en un usuario encargado o pantalla. La inicialización necesita permisos DDL apropiados y debe ensayarse en una base de pruebas antes del despliegue.

## 5. Diccionario de inventario

| Colección | Campos | Qué representa |
| --- | --- | --- |
| `products` | `id`, `sku`, `name`, `family`, `minimum` | Catálogo. SKU único en mayúsculas e inmutable; mínimo global de palets por referencia |
| `locations` | `id`, `code`, `area`, `zone`, `capacity`, `sku`, `qty` | Bloque físico de suelo y saldo actual. Una referencia por bloque; al quedar a cero se vacía el SKU |
| `movements` | `id`, `date`, `kind`, `sku`, `qty`, `location`, `destination`, `operator`, `actorId?`, `document`, `notes`, `stacked`, `workOrderId?` | Histórico de cambios de palets; los de producción se enlazan con un viaje |
| `tasks` | `id`, `title`, `zone`, `owner`, `due`, `done` | Plan 5S heredado de puesta en marcha; no es la cola de trabajo que se publica en la pantalla |
| `closures` | `id`, `day`, `date`, `operator`, `actorId?`, `checks`, `notes` | Un cierre global por día de Madrid con las cinco comprobaciones completas |

Las áreas permitidas son `carton` y `montaje`. Esta última incluye montaje y almacenaje de cajas. El muelle identifica trabajo logístico, no un bloque de stock en la aplicación. Cerámica, oficinas y otros espacios quedan fuera de estas ubicaciones.

Los saldos mostrados se calculan sumando `locations.qty`, no reproduciendo el histórico. `minimum` admite cero; capacidades y cantidades de movimiento son enteros positivos, con límite de 1.000.000. No hay palets parciales, unidades interiores ni lotes. Los SKU de planchas y cajas deben distinguirse, pero la familia es texto libre: la app no deduce el material a partir del nombre.

Las entradas suman stock; las salidas restan; los traslados restan en origen y suman en destino. Se exige capacidad suficiente y no mezclar SKU. Una salida requiere albarán y doble comprobación; entrada, traslado y producción exigen etiquetado confirmado. Si se declara apilado, se exige revisión adicional. Esas confirmaciones se validan al guardar; no todas se conservan como campos independientes del movimiento.

El servidor toma el nombre y `actorId` del usuario autenticado en nuevos movimientos y cierres. Ignora el nombre de responsable enviado por el navegador para atribuirlos. Los registros antiguos pueden conservar nombres libres y no tener `actorId`; no se convierten retrospectivamente en identidades verificadas.

## 6. Órdenes, horarios y prioridades

### Datos de una orden

| Campo | Uso |
| --- | --- |
| `id`, `kind`, `title` | Identidad, tipo y descripción del trabajo |
| `reference` | Número de pedido o referencia de trabajo; texto libre |
| `truck` | Matrícula o identificación del camión |
| `assignedTo` | Equipo o persona que ejecuta; texto libre, distinto del autor que registra |
| `instructions` | Instrucciones visibles para los operarios |
| `scheduledDate`, `scheduledTime` | Día real de calendario y hora prevista opcional; se interpretan en el contexto del almacén en Madrid |
| `priority` | `normal` o `urgente` |
| `status` | `pendiente`, `en_curso`, `pausada`, `completada` o `cancelada` |
| `repeatEveryDays` | De 0 a 365; solo mantenimiento y limpieza. Cero significa sin repetición |
| `previousOrderId`, `nextOrderId` | Enlaces entre tareas recurrentes |
| `createdAt`, `updatedAt`, `completedAt` | Tiempos del servidor, en ISO UTC; finalización nula mientras no esté completada |
| `createdBy`, `updatedBy`, `events` | Autoría e historial de creación, edición y cambios de estado |
| `production` | Especificación de consumo/producción de un viaje, opcional hasta completarlo |

Cada evento guarda `id`, `kind`, `date`, `actorId`, `actorName` y `status`. El historial conserva quién y cuándo, pero todavía no guarda un diff completo de los valores anteriores de cada edición. La asignación por nombre no es una relación con una cuenta ni concede permisos.

Los tipos de trabajo son `viaje`, `pedido`, `carga`, `descarga`, `mantenimiento` y `limpieza`. Una orden nace pendiente. Se puede iniciar, pausar, reanudar, completar o cancelar. No se reabre ni se edita un trabajo cerrado. Si se necesita rehacerlo, se crea otro.

### Prioridad

La ordenación compartida presenta primero trabajos abiertos, después prioriza los que están en curso, las urgencias indicadas por el encargado y los viajes de producción; a continuación compara día y hora. Una hora vacía se coloca al final del día. El trabajo destacado de la pantalla elige primero los que están en marcha; si no hay ninguno, el siguiente pendiente de hoy o días anteriores. Solo si no hay pendientes de esos días propone trabajo futuro. Una orden pausada no se anuncia como siguiente trabajo.

Las órdenes futuras siguen visibles con su fecha. Una hora prevista ayuda a organizar y señalar retrasos; no inicia una máquina ni cambia automáticamente el estado. El encargado conserva el control y puede marcar una urgencia cuando un trabajo deba adelantar a un viaje.

### Repetición y almuerzo

Al completar mantenimiento o limpieza con repetición, se crea una única siguiente orden pendiente. Su fecha es el día de finalización en Madrid más el número de días elegido; conserva la hora programada. No depende de un cron ni genera tareas acumuladas por cada día transcurrido. Repetir la misma finalización no genera otra recurrencia.

`shift` contiene inicio/fin del turno, inicio/fin de almuerzo y aviso general. El turno debe empezar y terminar el mismo día, con inicio anterior al fin. El almuerzo requiere ambas horas, dentro del turno, o ambas vacías. Se repite diariamente hasta que el encargado lo cambia. No hay calendarios de festivos, turnos nocturnos ni horarios distintos por operario.

## 7. Cómo un viaje actualiza el stock

La especificación de producción contiene:

```json
{
  "inputSku": "PLANCHA-REF",
  "inputLocation": "CAR-A-01",
  "inputPallets": 2,
  "outputSku": "CAJA-REF",
  "outputLocation": "CAJ-A-01",
  "outputPallets": 3
}
```

Este ejemplo transforma dos palets de planchas en tres palets de cajas. **No se presupone una relación 1:1**. El encargado confirma cantidades reales, referencias y bloques al completar el viaje. No se calcula rendimiento ni merma a partir de unidades interiores.

1. Crear o iniciar un viaje no modifica existencias ni reserva stock.
2. Al completar, se exige una especificación válida. Las referencias y los bloques de origen/destino deben ser distintos y existir.
3. El servidor comprueba planchas suficientes, destino compatible, área asignada y capacidad de recepción. Exige etiquetado y, si corresponde, revisión de apilado.
4. Sobre una copia del estado, resta las planchas, suma las cajas y crea dos movimientos: `consumo` y `produccion`, ambos con `workOrderId`.
5. Marca el viaje completado, registra el evento del autor y guarda todo con una única escritura condicionada por revisión.

Si falla cualquiera de esas reglas, no se guarda ninguna parte del cambio. Si el viaje ya estaba completado, repetir esa finalización no vuelve a consumir ni producir palets. Esto evita duplicados por repetir el cierre de la misma orden.

Completar un pedido, una carga o una descarga **solo cierra el trabajo**. La entrada/salida de palets se registra por separado en Inventario. El diálogo de cierre de camiones lo explica. No existen todavía líneas de pedido, reservas, preparación parcial, conciliación con albaranes ni un enlace automático entre camión y movimientos.

## 8. Lectura, guardado y sincronización

`GET /api/warehouse` devuelve `{ revision, state }`. El encargado y el administrador consultan al entrar, cada 15 segundos, al recuperar el foco y tras guardar. Las respuestas con una revisión inferior a la ya recibida se ignoran, para que una lectura atrasada no sustituya un guardado más reciente.

Cada escritura envía `{ revision, action }`. El servidor verifica sesión, rol y origen, admite un cuerpo de hasta 12.000 caracteres y comprueba la revisión. `applyAction` clona el estado; la escritura SQL usa `INSERT ... ON CONFLICT ... DO UPDATE` con condición sobre la revisión esperada. Un conflicto devuelve 409 y el frontend refresca conservando el formulario para revisarlo. Incluso cambiar un horario compite por la misma revisión global que un movimiento.

No se reintentan automáticamente las escrituras. Aún falta una clave de idempotencia general para altas y movimientos manuales: si el servidor guarda pero se pierde la respuesta, repetir después con una revisión nueva puede duplicar la intención original. El cierre de viajes sí se protege mediante su orden y estado. Antes de reintentar una entrada, salida o nueva orden tras un error de conexión, hay que revisar si ya aparece registrada. Para operación intensiva, conviene resolver esta limitación antes de cargar datos reales.

La pantalla usa `GET /api/board` cada 10 segundos y rota listas cada 15 segundos. Recibe órdenes sin el array de eventos, horarios, revisión y hora del servidor; mantiene su reloj en Madrid. Producción/pedidos se pagina de dos en dos; muelle y puesta a punto, de uno en uno. Los avisos e instrucciones largos rotan en fragmentos. No se silencian trabajos sobrantes por superar el número de tarjetas.

Si una lectura falla o pasan 30 segundos sin una actualización correcta, aparece un aviso visible de datos sin actualizar. La pantalla conserva la última información con esa advertencia; no permite registrar trabajo sin conexión. Una sesión caducada conduce al login.

## 9. API y control de acceso

| Método y ruta | Permiso | Contrato |
| --- | --- | --- |
| `POST /api/session` | Público | `user` o `username` y `password`; devuelve identidad pública y cookie |
| `GET /api/session` | Cualquier cuenta activa | `{ user }` o 401 |
| `DELETE /api/session` | Cierre de sesión | Borra la cookie de ese navegador |
| `GET /api/warehouse` | Administrador/encargado | Estado completo y revisión |
| `POST /api/warehouse` | Administrador/encargado | `{ revision, action }`; devuelve estado y revisión nuevos |
| `GET /api/board` | Tres roles | `{ revision, workOrders, shift, serverTime }` |
| `GET /api/users` | Administrador | Lista de cuentas públicas con `active` y `bootstrap` |
| `POST /api/users` | Administrador | `type: create`, `update` o `delete`; alta, cambio o desactivación |
| `POST /api/reference-photo` | Administrador/encargado | Extrae sugerencias de una etiqueta; no guarda stock |

Las acciones del almacén son `product`, `location`, `movement`, `task`, `closure`, `workOrder`, `workOrderStatus` y `shift`. Las órdenes y horarios usan campos planos. `workOrder` incluye `id` solo al editar; `workOrderStatus` incluye ID y estado, además de producción/comprobaciones al terminar un viaje.

```json
{
  "revision": 12,
  "action": {
    "type": "workOrderStatus",
    "id": "ID_DEL_VIAJE",
    "status": "completada",
    "labelled": true
  }
}
```

El ejemplo supone producción ya planificada en la orden; se puede enviar `production` para confirmar valores diferentes. El autor no se acepta desde el formulario: se resuelve desde la sesión.

Respuestas: 400 para datos o reglas inválidas; 401 para sesión ausente/caducada; 403 para permisos u origen no permitido; 409 para conflicto de revisión o cuenta duplicada; 429 para exceso de intentos de login; 503 para configuración o servicio no disponible. La lectura de fotografías tiene además errores específicos de tamaño/formato/extracción.

### Sesiones y contraseñas

La cookie `burriana_sesion` es HttpOnly, SameSite=Lax y Secure en producción. Dura ocho horas desde el acceso. Los tokens nuevos contienen identidad, versión de sesión y caducidad; el rol se obtiene del registro actual, no de un campo que envíe el cliente. Los tokens antiguos de la cuenta principal siguen siendo válidos durante la actualización.

Las contraseñas de cuentas nuevas se almacenan con scrypt y sal aleatoria. Se exigen entre 12 y 256 caracteres. La credencial principal conserva la política existente y se configura en el servidor. Cambiarla invalida las sesiones; cambiar rol/contraseña de una cuenta o desactivarla incrementa su versión y revoca sus tokens anteriores. El cierre normal borra la cookie del navegador, sin una lista de revocación individual por dispositivo.

La API comprueba estado activo en cada petición y origen en escrituras. El limitador de intentos de login vive en memoria de cada instancia; no es un límite distribuido entre todas las funciones. Para acceso público sostenido queda pendiente valorar una protección compartida. No hay recuperación de contraseña por correo ni autenticación multifactor integrada.

## 10. Qué muestra cada dato en los dashboards

| Indicador | Fuente y cálculo |
| --- | --- |
| Palets en stock | Suma de `locations.qty` |
| Referencias bajo mínimo | Suma de bloques por SKU estrictamente inferior a `products.minimum` |
| Órdenes pendientes | Todas las abiertas: pendientes, en curso y pausadas, también futuras |
| Camiones previstos | Cargas/descargas abiertas de hoy o días anteriores |
| Completadas hoy | Órdenes con `completedAt` cuyo día en Madrid es hoy |
| Siguiente trabajo | Orden abierta elegida por prioridad y fecha; el encargado decide empezar |
| Mantenimiento y limpieza | Órdenes abiertas de ambos tipos, con la siguiente fecha prevista |
| Historial de producción | Movimientos consumo/producción enlazados a la orden |
| Ocupación de bloque | `qty / capacity`; el plano no calcula capacidad ni posición real |

El dashboard global es operativo: muestra stock, carga de trabajo y actividad terminada. No calcula todavía productividad por máquina, OEE, tiempos efectivos descontando pausas, costes, objetivos ni rendimiento de conversión. Los datos actuales permiten ampliar algunos indicadores, pero esos KPI necesitan definición y validación con el responsable.

El plan 5S heredado sigue accesible en Inventario para puesta en marcha. Para que mantenimiento y limpieza aparezcan en la pantalla hay que crearlos como órdenes en Organización del turno. El cierre diario sigue siendo una comprobación global; no completa automáticamente las órdenes abiertas.

## 11. Preparar el inventario real de la nave

Antes de introducir palets, el responsable debe reunir la siguiente información:

| Datos | Campos necesarios | Comprobación física |
| --- | --- | --- |
| Referencias | SKU, descripción y medidas, familia, mínimo en palets; distinguir planchas y cajas | Etiquetas y nomenclatura únicas |
| Bloques | Código, área cartón/montaje, pasillo, capacidad total validada | Señalización, límites y espacio realmente disponible |
| Recuento inicial | SKU, bloque y palets completos existentes | Un único SKU por bloque, cantidad dentro de capacidad |
| Producción | SKU de origen/destino, bloques, consumo y producción de cada viaje | Confirmar cantidades reales al terminar |
| Turno | Horas, almuerzo y avisos | Acuerdo del encargado para el primer día |
| Accesos | Nombre, usuario y rol por persona; cuenta de pantalla | Una cuenta de lectura exclusiva en el dispositivo visible |

Procedimiento de arranque:

1. Usar el entorno definitivo solo después de verificar permisos, copias y recuperación en una base de pruebas. No importar la demostración local.
2. Dar de alta el catálogo de planchas y cajas en Inventario. Dar de alta los bloques con sus áreas y capacidades reales.
3. Hacer un recuento físico en un momento acordado, evitando movimientos sin registrar durante el corte.
4. Registrar una entrada inicial por SKU y bloque, con documento identificable de inventario inicial y las comprobaciones exigidas.
5. Conciliar el total de cada referencia y la ocupación de cada bloque con el recuento. Resolver discrepancias antes de comenzar a operar.
6. Configurar turno y almuerzo, crear una orden de producción y probar el ciclo completo con el equipo en un entorno de pruebas.
7. Iniciar el primer turno real y revisar a diario stock, órdenes pendientes y movimientos sin conciliar.

No hay importación de Excel/CSV desde la interfaz ni ajuste de inventario dedicado. Los CSV exportados son informes. El importador JSON restaura un estado completo, no debe tratarse como un formulario para sumar existencias a una base operativa.

## 12. Copias, restauración y fotografías

«Descargar copia de datos» exporta `schemaVersion: 2`, fecha de exportación, revisión y todas las colecciones, incluidas órdenes y horarios. Sale del estado de la pestaña; hay que comprobar que esté actualizado. **No incluye cuentas ni hashes** de `warehouse_users`: el plan de recuperación debe respaldar ambas tablas y la configuración del servidor por separado.

El importador acepta el exportado de la app o una respuesta `{ revision, state }`. Para validar un archivo sin conexión a Postgres:

```sh
node --experimental-strip-types scripts/import-state.mjs copia.json --check
```

Comprueba estructura, IDs únicos, SKU/códigos normalizados, tipos, cantidades, referencias, áreas, fechas, cierre único, eventos, recurrencia y que un viaje terminado corresponda a sus dos movimientos. Conserva órdenes y horarios. En copias antiguas sin esos campos aplica valores por defecto. No reconstruye todos los saldos a partir de los movimientos; esa conciliación sigue siendo una revisión adicional.

La restauración administrativa, una vez verificado el entorno de destino y guardada una copia previa, usa:

```sh
node --experimental-strip-types --env-file=.env.local scripts/import-state.mjs copia.json
```

Se niega a reemplazar existencias, histórico, tareas personalizadas, órdenes o horarios cambiados sin `--force`. Esa opción sustituye todo el estado del almacén; no lo fusiona y no restaura cuentas. El script escribe con la revisión actual de la base, no con la revisión del archivo. No realiza por sí mismo una copia previa. No se ha ejecutado una restauración contra producción en este trabajo.

La lectura de etiquetas por fotografía sigue siendo opcional. Propone datos del catálogo y exige revisión humana; no registra palets. Antes de depender de ella hay que ensayar proveedor/modelo, formatos y tamaños aceptados por el despliegue. El flujo actual no ha sido validado con fotografías reales en esta revisión y necesita resolver compresión/tamaño y respuestas tardías al cerrar el formulario.

## 13. Desarrollo y despliegue

Requisitos del proyecto: Node 22.13 o superior y dependencias instaladas con `npm ci`. Variables privadas: `WAREHOUSE_ADMIN_USER`, `WAREHOUSE_ADMIN_PASSWORD` y `DATABASE_URL` o `POSTGRES_URL`. No deben subirse al repositorio.

Para desarrollar sin escribir en Supabase se ha añadido almacenamiento explícito local:

```sh
WAREHOUSE_LOCAL_DATA_DIR=outputs/dev-data/mi-prueba npm run dev -- --webpack --hostname 127.0.0.1
```

En este modo, `warehouse.json` guarda estado/revisión y `users.json` guarda cuentas de prueba con hashes. Se guardan bajo el directorio indicado. Es una ayuda de desarrollo, no una alternativa de producción. Con `NODE_ENV=production` ese modo se rechaza. Sin la variable local, el servidor usa la conexión Postgres configurada; arrancar en modo desarrollo por sí solo no aísla los datos.

Para revisar esta entrega se usa `outputs/dev-data/refocus`, con datos marcados DEMO LOCAL y cuentas de ensayo ya desactivadas. La cuenta principal existente sigue disponible. Un directorio local nuevo comienza vacío de inventario y órdenes.

Comprobaciones de código:

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build -- --webpack
```

La opción webpack evita el fallo de permisos de puerto interno observado con Turbopack en este equipo. No se ha modificado el compilador predeterminado del proyecto solo por esa limitación local.

Antes de publicar: preparar una base de pruebas, validar la inicialización de `warehouse_users` y su protección, comprobar roles con varias sesiones, ensayar escritura concurrente y recuperación, probar el panel en el dispositivo de la nave y asegurar que `WAREHOUSE_LOCAL_DATA_DIR` no esté definido en producción. Después se podrá desplegar la versión validada, crear las cuentas reales y cargar el inventario conciliado. Un rollback al código antiguo no debe escribir el nuevo estado sin verificar compatibilidad: podría perder órdenes/horarios por su tratamiento anterior del JSON.

La sesión de pantalla caduca a las ocho horas. En la primera fase habrá que entrar de nuevo cada turno. Para un dispositivo permanentemente encendido queda pendiente decidir un acceso de kiosco renovable, con credenciales y revocación propias, sin dejar abierta una sesión de administrador en la pantalla pública.

## 14. Validación y siguientes pasos

Se han ejecutado pruebas automatizadas de inventario, controles de acceso, adaptador SQL simulado, órdenes/producción, cuentas y restauración. También se ha probado la API de Next en el servidor local aislado: login, prohibiciones por rol, origen, autor autenticado, conflicto 409, viaje atómico, cierre repetido sin duplicado, recurrencia, proyección de pantalla y revocación de cuentas.

La revisión visual en Chrome ha cubierto dashboard, inventario, organización del turno, formulario de finalización de viaje y panel de pantalla. Se corrigió el desbordamiento inicial del panel mediante tres columnas y listas rotatorias. Esta revisión de escritorio no acredita todavía lectura desde la puerta ni uso táctil en tablets.

El siguiente paso operativo es reunir catálogo, bloques, capacidades y recuento reales. El siguiente paso técnico es un ensayo de esta versión en una base Postgres separada, con copia/restauración y varias sesiones. Antes de un uso intensivo conviene cerrar la idempotencia general y el procedimiento de correcciones de stock. La integración de pedidos/camiones con movimientos y las tablets quedan como ampliaciones explícitas, no como funciones ya disponibles.
