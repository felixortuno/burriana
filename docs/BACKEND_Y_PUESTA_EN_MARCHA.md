# Backend de Burriana y puesta en marcha del inventario

Guía técnica y operativa para oficina y operarios

Revisión del 1 de octubre de 2026 · Código base `92e78d2` · GTR Solutions

La aplicación ya está publicada y puede gestionar referencias, ubicaciones y movimientos de palets completos. La comprobación del 1 de octubre confirma que el inventario todavía está vacío. Para empezar a utilizarla con oficina y operarios hay que completar los permisos de ambos perfiles, asegurar los reintentos y la recuperación, y preparar los datos reales de la nave.

Este documento explica el backend que existe, cómo recoge y muestra los datos y qué falta para el uso real. Las secciones 2 a 9 describen la implementación actual; la sección 10 define la propuesta de perfiles, aún pendiente. La sección 11 explica cómo preparar el inventario y las secciones 12 a 14 ordenan la puesta en marcha. Dos perfiles significan dos tipos de permisos; puede haber varias personas dentro de cada perfil.

## 1 Estado comprobado

| Comprobación | Resultado del 1 de octubre de 2026 |
| --- | --- |
| Aplicación publicada | `https://burriana.vercel.app` responde; login 200 y acceso anónimo a la portada redirigido a login |
| Lectura con sesión | 200; revisión 0; 0 referencias, 0 ubicaciones, 0 movimientos, 0 cierres y 9 tareas iniciales |
| API sin sesión | Inventario y lectura de fotografías rechazan con 401 |
| Solicitud de escritura desde otro origen | Rechazada con 403 antes de modificar inventario |
| Base de datos | RLS activa en `public.warehouse`; sin permisos de tabla para PUBLIC, anon y authenticated; Data API anónimo rechazado con 401 y código 42501 |
| Arranque local | `npm run dev -- --webpack --hostname 127.0.0.1`; disponible en `http://127.0.0.1:3000` |
| API local | Login y lectura 200; mismo inventario vacío; cookie HttpOnly y SameSite=Lax, sin Secure en desarrollo HTTP |
| Navegador local | Login, resumen autenticado e inventario vacío comprobados en Chrome de escritorio |
| Pruebas | Pasa el script de dominio y las 15 pruebas reportadas por node:test: 13 de acceso y 2 del adaptador Postgres simulado |
| Compilación | `npm run build -- --webpack` correcto, incluida comprobación de TypeScript |
| Compilador predeterminado | `npm run build` bloqueado localmente por EPERM al abrir un puerto interno de Turbopack; no demuestra un defecto funcional de la app |
| Lint | 5 errores y 1 aviso pendientes en `app/page.tsx` |

Las comprobaciones de acceso no han creado referencias, movimientos ni cierres. La lectura de la API puede ejecutar la inicialización idempotente de esquema y permisos descrita en la sección 3. Las pruebas automatizadas usan memoria o adaptadores simulados, no acreditan por sí solas concurrencia y recuperación en Postgres real.

La sesión de desarrollo usa las variables existentes de `.env.local`. Arrancar localmente no crea una base de datos de pruebas independiente: antes de hacer ensayos con altas o movimientos hay que configurar una base aislada. No se ha realizado un nuevo despliegue en esta revisión.

## 2 Cómo está organizado el backend

La aplicación es un proyecto Next.js con React. La misma aplicación sirve las pantallas y las rutas HTTP del servidor. El backend no es un servidor Express separado. Usa la librería `postgres` para conectar directamente con Postgres alojado en Supabase; no utiliza Supabase Auth, Storage ni Realtime en el flujo actual.

```text
Pantallas React y formularios
        │ petición HTTP con cookie de sesión
        ▼
Proxy y autorización de la API
        │ comprobar acceso y origen de escrituras
        ▼
GET /api/warehouse → leer el estado
POST /api/warehouse → validar petición y revisión
        │ POST aplica reglas a una copia con applyAction
        ▼
WarehouseStore y postgres.js
        │ lectura o escritura SQL condicional
        ▼
Supabase Postgres
public.warehouse → una fila → cinco colecciones JSON
```

| Archivo | Responsabilidad |
| --- | --- |
| `app/page.tsx` | Siete vistas, formularios, llamadas a la API, cálculos para pantalla y exportaciones |
| `app/warehouse-plan.tsx` y `lib/areas.ts` | Plano de referencia y dos zonas admitidas |
| `proxy.ts` | Redirigir visitantes sin sesión y proteger rutas |
| `lib/server/session.ts` | Credenciales de oficina, firma y verificación de sesiones |
| `lib/server/access.ts` | Autorización de peticiones y comprobación del origen de escrituras |
| `app/api/session/route.ts` | Entrada, salida y contador de intentos de acceso |
| `app/api/warehouse/route.ts` | Publicar GET y POST del almacén |
| `lib/server/warehouse-handlers.ts` | Conectar autorización, reglas HTTP y almacenamiento |
| `lib/server/warehouse-api.ts` | Contrato HTTP, revisión, respuestas de error y guardado |
| `lib/warehouse.ts` | Tipos de datos, estado inicial y reglas de inventario, tareas y cierres |
| `db/postgres-warehouse.ts` | Esquema SQL y escritura atómica condicionada por revisión |
| `db/supabase-warehouse.ts` | Configurar la conexión y crear/proteger la tabla |
| `app/api/reference-photo/route.ts` y `lib/server/reference-photo.ts` | Recibir fotografías y pedir extracción de campos a un proveedor de IA |
| `scripts/import-state.mjs` | Restaurar administrativamente un estado JSON completo |

`app/chatgpt-auth.ts` contiene utilidades heredadas que no están conectadas al acceso actual. No debe interpretarse como un segundo sistema de usuarios activo.

## 3 Cómo se guarda la información

### Tabla y documento de estado

Actualmente existe una tabla operativa con una única fila posible:

```sql
CREATE TABLE IF NOT EXISTS public.warehouse (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL CHECK (revision >= 0),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);
```

`id` identifica el almacén único. `revision` es el contador global de cambios, no la versión del esquema. `data` contiene el estado completo:

```json
{
  "products": [],
  "locations": [],
  "movements": [],
  "tasks": [],
  "closures": []
}
```

Este ejemplo muestra la estructura, no una copia para importar. Si no hay fila, el servidor devuelve existencias vacías y nueve tareas 5S predefinidas en memoria. Leer ese estado inicial no inserta la fila; el primer guardado válido crea la revisión 1.

Cada GET lee todo el documento y cada guardado sustituye todo el documento. No hay tablas individuales de productos, usuarios o movimientos, claves foráneas entre entidades ni índices SQL por SKU o fecha. Postgres comprueba la forma general de la fila; las reglas internas dependen del código de aplicación.

### Conexión y protección

La conexión se obtiene de `DATABASE_URL ?? POSTGRES_URL`: si ambas existen, tiene prioridad `DATABASE_URL`. El cliente configura `prepare: false`, una conexión por instancia, 15 segundos para conectar y ejecutar sentencias y 20 segundos de inactividad. Desactivar sentencias preparadas es compatible con el pool de transacciones documentado por [Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

La primera operación de cada instancia inicializa la tabla dentro de una transacción. Adquiere `pg_advisory_xact_lock(75017329)`, crea la tabla si falta, activa RLS y revoca permisos a `anon`, `authenticated` y `PUBLIC`. Lecturas y escrituras esperan a que esto termine. Si falla, la API no continúa; la siguiente petición puede reintentar la inicialización.

El servidor conecta como propietario y conserva acceso. No se usa `FORCE ROW LEVEL SECURITY` ni hay políticas de usuario final. Por tanto, RLS y la retirada de permisos cierran el Data API público, pero **no distinguen oficina y operarios**. Esa autorización tendrá que realizarla el servidor. La arquitectura no envía las credenciales de Postgres al navegador. Véase también [db/security.md](../db/security.md).

## 4 Diccionario exacto de los datos actuales

### Referencias de producto

| Campo de Product | Tipo | Significado y regla |
| --- | --- | --- |
| `id` | texto | UUID generado en el servidor al crear |
| `sku` | texto | Código único; espacios externos recortados, mayúsculas e inmutable después del alta |
| `name` | texto | Descripción de la referencia; incluir medidas cuando permitan identificarla |
| `family` | texto | Familia libre; el formulario parte de Cantoneras y no existe catálogo controlado de familias |
| `minimum` | número entero | Mínimo global de esa referencia en palets; de 0 a 1.000.000 |

El producto no contiene un campo de existencias. Dar de alta una referencia no añade palets.

### Ubicaciones y existencias

| Campo de Location | Tipo | Significado y regla |
| --- | --- | --- |
| `id` | texto | UUID generado al crear |
| `code` | texto | Código único en mayúsculas e inmutable, por ejemplo CAR-A-01 |
| `area` | texto opcional | `carton` o `montaje`; obligatorio en altas y ediciones actuales; puede faltar en datos antiguos |
| `zone` | texto | Pasillo o sector dentro del área, por ejemplo Pasillo A |
| `capacity` | número entero | Capacidad total validada en palets, de 1 a 1.000.000 |
| `sku` | texto | Referencia que ocupa el bloque; vacío si no contiene stock |
| `qty` | número entero | Palets actuales del bloque; se modifica mediante movimientos |

`area` clasifica las dos zonas del plano; `zone` es un texto libre, no una tercera zona controlada. Un bloque solo admite una referencia a la vez. Al quedar a cero, el servidor vacía su SKU. Una ubicación antigua sin área admite salida, pero no recibe entradas ni traslados hasta asignarla.

### Movimientos

| Campo de Movement | Tipo | Significado |
| --- | --- | --- |
| `id` | texto | UUID de este movimiento, distinto en cada ejecución aceptada |
| `date` | texto ISO UTC | Fecha y hora generadas en el servidor al registrar |
| `kind` | texto controlado | `entrada`, `salida` o `traslado` |
| `sku` | texto | Referencia existente en el catálogo |
| `qty` | número entero | Palets positivos, hasta 1.000.000 |
| `location` | texto | Bloque receptor en entrada; bloque de origen en salida o traslado |
| `destination` | texto | Bloque de destino en traslado; vacío en los demás casos |
| `operator` | texto | Nombre escrito en el formulario; no es una identidad autenticada |
| `document` | texto | Albarán obligatorio en salida; opcional en entrada y traslado |
| `notes` | texto | Observaciones opcionales de hasta 1.000 caracteres |
| `stacked` | booleano | Indica apilado declarado en entrada o traslado |

Las confirmaciones `labelled`, `verified` y `safe` llegan en la acción y se validan, pero **no se conservan en Movement**. Tampoco se guarda la persona que hizo una segunda revisión, fecha física anterior al registro, foto, lote o identificador individual del palet.

### Tareas 5S

| Campo de Task | Tipo | Significado |
| --- | --- | --- |
| `id` | texto | UUID; las tareas iniciales usan `5s-1` a `5s-9` |
| `title` | texto | Trabajo a realizar |
| `zone` | texto | Zona o ámbito de la tarea, libre y sin relación obligatoria con Location |
| `owner` | texto | Responsable asignado por nombre libre |
| `due` | texto | Fecha objetivo `AAAA-MM-DD` o cadena vacía |
| `done` | booleano | Completada o pendiente |

La tarea no registra quién la completó, a qué hora ni un historial de cambios. `due` es una fecha objetivo, no una fecha de ejecución. La validación actual comprueba el formato, pero admite fechas de calendario imposibles.

### Cierres de turno

| Campo de Closure | Tipo | Significado |
| --- | --- | --- |
| `id` | texto | UUID generado en el servidor |
| `day` | texto | Día civil del almacén en Europe/Madrid |
| `date` | texto ISO UTC | Fecha y hora del registro |
| `operator` | texto | Nombre escrito por quien declara revisar |
| `checks` | array booleano | Exactamente cinco valores `true` |
| `notes` | texto | Observaciones opcionales, hasta 1.000 caracteres |

Hay un cierre por día para todo el almacén, no uno por persona ni por perfil. No se puede firmar con comprobaciones pendientes, reabrir ni registrar un segundo turno. Las cinco comprobaciones son maquinaria estacionada, baterías/carga, pasillos, consumibles y residuos. El nombre guardado no constituye una firma electrónica certificada.

### Relaciones entre entidades

```text
products.sku ──► locations.sku
             └► movements.sku
locations.code ──► movements.location y movements.destination
```

Son relaciones por texto mantenidas por la aplicación. SKU y código de ubicación se conservan para que el histórico siga apuntando a ellos. `operator` y `owner` no enlazan con una tabla de personas. Los nombres de zonas de tareas tampoco asignan permisos.

Los textos ordinarios tienen un límite de 180 caracteres y se recortan. Las reglas de campos y relaciones se aplican a acciones nuevas; el importador actual no ofrece una validación equivalente.

## 5 Qué ocurre al leer y guardar

### Lectura

Al abrir la app, React pide `GET /api/warehouse`. El servidor comprueba la cookie y devuelve `{ revision, state }`. La pantalla conserva una copia en memoria y calcula tablas e indicadores. Las respuestas no se cachean. No hay modo sin conexión ni cola de operaciones persistente en el navegador.

### Guardado

1. El formulario envía `POST /api/warehouse` con `{ revision, action }`.
2. El servidor comprueba la sesión y el origen. Valida JSON, revisión entera no negativa y acción de tipo objeto; limita el cuerpo a 12.000 caracteres.
3. Lee la revisión y el estado actual. Si la revisión enviada está desactualizada, responde 409.
4. `applyAction` clona el estado con `structuredClone` y aplica validaciones y cambios sobre esa copia.
5. Una única sentencia SQL guarda el JSON completo y aumenta la revisión, solo si coincide la revisión esperada. Stock e histórico se guardan juntos.
6. La API devuelve el estado completo y la nueva revisión. El navegador actualiza la pantalla y muestra la confirmación.

La escritura usa un `INSERT ... ON CONFLICT ... DO UPDATE` condicionado por `warehouse.revision = revisiónEsperada`. No hay una transacción SQL que englobe toda la lectura y el cálculo; la garantía frente a escritores concurrentes está en esa escritura condicional atómica.

Ejemplo: oficina y un operario leen revisión 12. Oficina guarda una entrada y crea revisión 13. El operario intenta guardar sobre 12: recibe 409, se recargan datos y se conserva su formulario para revisarlo. No se pisan silenciosamente las cantidades. Incluso editar una tarea compite por esa misma revisión global.

Si la escritura se completa pero se pierde la respuesta, un reintento posterior con una revisión actualizada puede registrar otra vez la misma operación. Reenviar literalmente la revisión antigua devuelve 409; ese control no identifica la intención original. Falta un `operationId` estable para que reintentar produzca un único movimiento.

### Reglas por tipo de movimiento

| Movimiento | Efecto en existencias | Comprobaciones específicas |
| --- | --- | --- |
| Entrada | Suma palets al bloque receptor | Catálogo existente, área válida, capacidad, bloque vacío o mismo SKU, responsable y etiquetado |
| Salida | Resta del origen y vacía su SKU si llega a cero | SKU y cantidad disponibles, responsable, albarán y doble revisión declarada |
| Traslado | Resta del origen y suma al destino en el mismo guardado | Bloques distintos, cantidad disponible, destino compatible, área, capacidad, responsable y etiquetado |

Entrada y traslado con apilado declarado exigen además revisión del palet inferior. Las reglas impiden stock negativo y superar capacidad en operaciones normales. La capacidad y la autorización física del apilado proceden del equipo del almacén, no se calculan a partir del dibujo.

Hoy no hay recuento, ajuste, merma, reserva ni corrección vinculada a un movimiento erróneo. La ausencia de botón de borrado preserva el historial desde la interfaz, pero no convierte la base o las copias en un registro inmutable frente a administradores.

## 6 Contrato de las rutas HTTP

| Método y ruta | Entrada | Resultado |
| --- | --- | --- |
| POST `/api/session` | JSON con `user` y `password` | `{ ok: true }` y cookie de sesión |
| DELETE `/api/session` | Sin cuerpo necesario | Borrado de la cookie del navegador |
| GET `/api/warehouse` | Cookie válida | `{ revision, state }` completo |
| POST `/api/warehouse` | Cookie y `{ revision, action }` | Estado y revisión actualizados |
| POST `/api/reference-photo` | Cookie y multipart con archivo `foto` | Campos de referencia propuestos; no guarda stock |

Acciones admitidas en `POST /api/warehouse`:

| `action.type` | Campos de la acción |
| --- | --- |
| `product` | `id` para editar; `sku`, `name`, `family`, `minimum` |
| `location` | `id` para editar; `code`, `area`, `zone`, `capacity`; cantidad y SKU se conservan desde el estado |
| `movement` | `kind`, `sku`, `qty`, `location`, `destination`, `operator`, `document`, `notes`, `labelled`, `verified`, `stacked`, `safe` según el tipo |
| `task` | `id` para editar; `title`, `zone`, `owner`, `due`, `done` |
| `closure` | `operator`, `checks`, `notes`; el día y la fecha los calcula el servidor |

Una edición de tarea con ID desconocido se rechaza. Producto y ubicación usan otra lógica: un ID desconocido puede acabar creando un registro nuevo; hay que corregir esa diferencia.

| Estado HTTP | Interpretación |
| --- | --- |
| 400 | Petición o regla de negocio inválida |
| 401 | Sesión ausente/caducada o credenciales incorrectas en login |
| 403 | Origen de una mutación rechazado |
| 409 | Otro cambio avanzó la revisión |
| 413 / 415 / 422 | Foto demasiado grande, formato no permitido o etiqueta ilegible |
| 429 | Límite de intentos de login en una instancia |
| 503 | Acceso no configurado o fallo de base/proveedor, según ruta |

Las rutas no devuelven los detalles sensibles de errores de Postgres o del proveedor de IA. El frontend todavía necesita distinguir mejor sesión caducada, respuesta no JSON y pérdida de conexión.

## 7 Acceso y sesiones actuales

Existe una única cuenta definida mediante `WAREHOUSE_ADMIN_USER` y `WAREHOUSE_ADMIN_PASSWORD`. Sin credenciales utilizables el acceso privado se cierra con 503. La ruta de login permanece accesible.

Tras entrar, el navegador recibe `burriana_sesion`. Es una cookie HttpOnly, SameSite=Lax y Secure en producción. El token contiene usuario y vencimiento y se firma con HMAC SHA-256, con una clave derivada de la contraseña. Dura ocho horas desde el acceso. Cambiar las credenciales invalida las sesiones; cerrar sesión borra la cookie, sin una lista central de sesiones revocadas.

El texto de login habla de 07:00 a 15:00, pero ese horario no limita la sesión: entrar a las 11:00 permite ocho horas desde ese momento. El contador de intentos permite bloquear después de ocho fallos por IP, pero vive en memoria y no se comparte entre funciones. No se ha acreditado una regla distribuida adicional en la plataforma.

El proxy y cada API aplican autorización. Las mutaciones comprueban `Origin` frente al host recibido y rechazan `sec-fetch-site: cross-site`. Eso protege el flujo de navegador, pero no añade permisos por persona. Cualquiera con la cuenta actual puede ejecutar todas las acciones autorizadas por esa sesión.

## 8 Cómo se muestran los mismos datos en las pantallas

| Pantalla | Fuente y cálculo actual |
| --- | --- |
| Resumen | Total = suma de `locations.qty`; ocupadas = bloques con cantidad mayor que cero; referencias = tamaño del catálogo; cierre = coincidencia con el día de Madrid |
| Inventario | Catálogo y suma de cantidades de las ubicaciones de cada SKU; alerta si stock es estrictamente menor que `minimum` |
| Ubicaciones | Bloques agrupados por `area` y `zone`, ordenados por código; ocupación = `qty / capacity` |
| Plano | Suma de palets y número de bloques de cartón y montaje/cajas; las ubicaciones sin área se avisan por separado |
| Movimientos | Array histórico; fecha UTC presentada en Europe/Madrid; búsqueda y filtro en el navegador |
| Plan 5S | Tareas, asignación por texto, fecha objetivo y progreso de completadas |
| Cierre de turno | Cierre global del día, cinco comprobaciones e historial de cierres |
| Protocolo operativo | Texto fijo del frontend; no se configura ni versiona desde la base |

**El stock mostrado se suma desde las ubicaciones, no se reconstruye reproduciendo movimientos.** Ambos se mantienen juntos en operaciones normales, pero una importación incoherente puede romper esa correspondencia. El plano de diciembre de 2022 es una referencia de distribución: sus símbolos no son existencias actuales ni capacidades medidas. No hay coordenadas reales para situar cada bloque registrado a escala.

El navegador refresca al entrar, al pulsar Actualizar, tras guardar, ante conflicto o al ejecutar la herramienta opcional `read_warehouse_stock` si el entorno la admite. El temporizador de 30 segundos solo actualiza el día; no consulta existencias. No hay sincronización automática entre puestos. Además, una respuesta antigua que llegue tarde puede sustituir una revisión más nueva en pantalla.

Para oficina y operarios hace falta una política común de actualización: refresco al recuperar foco y un intervalo o notificación de cambios, rechazo de revisiones inferiores y fecha visible de última actualización. La consulta y las reglas deben compartir la misma fuente de stock. Si una cuenta tiene acceso limitado por zona, sus totales deben indicar ese ámbito.

Hay también diferencias que conviene corregir: el inventario exporta todo el catálogo aunque haya filtros, mientras el historial exporta solo los movimientos filtrados. “El plan de esta semana” muestra las primeras cuatro tareas sin filtrar fecha. Las tarjetas “Operario 01/02/03” y el nombre “Oficina” son textos fijos, no información del usuario conectado.

## 9 Fotografías y copias de datos

### Lectura de etiquetas

El formulario de nueva referencia puede enviar una fotografía a `/api/reference-photo`. El servidor admite JPEG, PNG, WebP y HEIC y un máximo de 6 MiB. Usa AI SDK con el identificador de modelo `anthropic/claude-sonnet-5` configurado en el código para obtener `legible`, `sku`, `name`, `family` y `note`.

La extracción propone campos; la persona debe comprobarlos y guardar después. Este endpoint no añade productos ni stock y no almacena la imagen en la base de la app. La fotografía se transmite al proveedor de IA. La compatibilidad real del modelo, credenciales, coste y formatos requiere ensayo; no se ha ejecutado OCR con imágenes reales en esta revisión.

El límite de la app es mayor que los 4,5 MB documentados para cuerpos de petición/respuesta de [Vercel Functions](https://vercel.com/docs/functions/limitations). Una imagen grande puede rechazarse antes de entrar en la función. También falta cancelar o ignorar una lectura pendiente al cerrar el formulario: su respuesta podría rellenar otra referencia abierta después. Hay que comprimir/redimensionar, tratar errores no JSON y confirmar los campos extraídos.

### Exportación y restauración

El CSV de inventario contiene SKU, descripción, familia, palets, mínimo y ubicaciones. El CSV de movimientos contiene las filas filtradas del historial. Son informes; la app no tiene importación de CSV o Excel.

“Descargar copia de datos” genera JSON con `exportedAt`, `revision` y las cinco colecciones. Sale de la copia que tiene el navegador, por lo que se debe actualizar antes. No incluye credenciales, usuarios, esquema SQL ni una versión de formato.

El importador administrativo acepta ese JSON o el estado anidado de una respuesta de API. Reemplaza las cinco colecciones, no las fusiona. Ignora la revisión del archivo y escribe con la revisión vigente de la base más uno. La protección sin `--force` omite tareas al decidir si hay datos: puede reemplazar tareas personalizadas si el resto está vacío.

Su validación solo comprueba arrays y duplicados exactos de SKU/código. Faltan tipos, IDs únicos, normalización, referencias existentes, cantidades no negativas, capacidades, áreas, fechas, cierre único y coherencia de saldos. Tampoco tiene simulación ni copia previa. **No debe usarse como importador masivo ordinario del inventario real hasta completar esas garantías.**

El comando existente, para una copia ya validada y con el entorno de destino comprobado, es:

```sh
node --experimental-strip-types --env-file=.env.local scripts/import-state.mjs copia.json
```

La opción `--force` sustituye el estado completo incluso con datos. No se ha ejecutado este importador durante la revisión. Hay que ensayar restauración en una base aislada y definir responsable, frecuencia, retención y acceso a copias. Los backups del proveedor y su recuperación dependen de la configuración contratada, que no se ha verificado aquí.

## 10 Perfiles de oficina y operarios que faltan por implementar

### Permisos propuestos

El alcance confirmado es **oficina y operarios**. Actualmente ambos usarían la misma cuenta con todos los permisos. La siguiente matriz es una propuesta de implementación, no una capacidad ya disponible.

| Operación | Oficina | Operarios |
| --- | --- | --- |
| Consultar referencias, existencias, bloques y protocolo | Sí | Sí |
| Registrar entrada, salida y traslado | Sí | Sí, dentro del flujo autorizado |
| Crear o editar referencias y capacidades | Sí | No |
| Cargar inventario inicial de forma masiva | Sí, con validación y simulación | No |
| Hacer un recuento físico | Sí | Sí, como declaración pendiente de aprobación |
| Aprobar ajustes o correcciones | Sí, con motivo e historial | No; comunicar discrepancia |
| Crear, asignar y reprogramar tareas | Sí | No |
| Completar tareas | Sí | Las asignadas o autorizadas |
| Firmar cierre global del día | Sí | Solo personas designadas para revisar |
| Exportar histórico o copia completa | Sí | No por defecto |
| Gestionar accesos | Personas autorizadas de oficina | No |

Las facultades de firmar cierre y gestionar accesos pueden ser permisos adicionales dentro de esos dos perfiles. No requieren inventar otros perfiles. Es preferible una cuenta por persona, aunque varias compartan el rol operario, para que el historial identifique al autor.

### Identidad y trazabilidad

El servidor debe resolver de la sesión un `actorId` estable, nombre, rol, estado activo y permisos. Un campo `role` o `operator` enviado por el navegador no debe decidir la autorización. Los movimientos deberían guardar autor autenticado, instante del servidor, comprobaciones realizadas y una instantánea del nombre para conservar la lectura histórica. Si quien introduce datos actúa por otra persona, registrar ambos conceptos de forma explícita.

Las tareas necesitan responsable por ID, `completedBy` y `completedAt`. El cierre necesita firmante autenticado y versión de checklist. Los cambios de catálogo, capacidades y zona con stock requieren autor, motivo y valores anterior/nuevo. Los nombres históricos existentes no deben convertirse automáticamente en identidades verificadas durante una migración.

Cada acción debe validar permisos en el backend. Ocultar botones adapta el trabajo de cada perfil, pero no impide una llamada directa a la API. Si el operario no puede descargar toda la información, el servidor tampoco debe enviarle el JSON completo y confiar en que la pantalla lo oculte.

### Una fuente de información para ambos perfiles

Oficina necesita una vista completa de catálogo, capacidad, mínimos, movimientos, incidencias y tareas. Los operarios necesitan localizar una referencia, conocer stock/capacidad, registrar una operación y completar trabajo asignado con formularios sencillos. Ambos deben usar los mismos identificadores y reglas, y ver cantidades coherentes para el mismo ámbito y revisión.

Como evolución, se puede empezar incorporando autorización y contratos de lectura por perfil al backend existente. La normalización de datos no es imprescindible para una prueba pequeña de oficina, pero cobra valor con varios puestos y un histórico creciente.

| Tabla propuesta | Información principal |
| --- | --- |
| `profiles` | Identidad vinculada al sistema de autenticación, nombre, rol y estado activo |
| `products` | Referencias y mínimos, con SKU único |
| `locations` | Bloques, áreas, pasillos, capacidad y estado de archivo |
| `inventory_balances` | Saldo por bloque y referencia, conservando una referencia por bloque |
| `movements` | Operación, cantidad, origen/destino, autor, fecha, documento y confirmaciones |
| `operations` | Clave única de idempotencia, contenido y resultado de cada intención de escritura |
| `tasks` | Asignación, fecha objetivo, estado y evidencia de finalización |
| `closures` | Día/turno definido, firmante, versión de checklist y comprobaciones |
| `incidents` | Discrepancia o no conformidad, responsable y resolución |
| `audit_events` | Cambios administrativos y correcciones con antes/después |

Esto es un diseño propuesto; estas tablas no existen hoy. Debe añadir claves foráneas, unicidad, restricciones e índices. El guardado de saldos, movimiento e idempotencia debe permanecer en una misma transacción, con bloqueo o control de versión de los saldos afectados. El histórico se consultaría por páginas. La migración debe preservar IDs e historial, reconciliar cantidades y conservar las restricciones de acceso.

## 11 Cómo preparar el inventario real de la nave

### Acordar el alcance y la unidad

La app actual gestiona cartón y montaje/almacenaje de cajas. Cerámica, exposición, oficinas, instalaciones y muelle no son ubicaciones de stock. Trabaja en palets completos: no representa palets parciales, unidades interiores, lotes, series, reservas o pedidos. Si alguno es necesario en la nave, hay que ampliar primero el modelo; no conviene redondear cantidades para forzarlas a entrar.

### Información que hay que recopilar

| Registro de preparación | Campos a recopilar | Validación antes de cargar |
| --- | --- | --- |
| Referencias | SKU, descripción con medidas, familia, mínimo en palets | Código legible y único; evitar duplicados por mayúsculas/espacios; familia homogénea |
| Bloques | Código, área, pasillo, capacidad validada | Código físico señalizado; área correcta; capacidad comprobada in situ |
| Recuento inicial | SKU, bloque, palets enteros, persona y fecha del recuento, documento/observación | Referencia y bloque existentes, un SKU por bloque, cantidad dentro de capacidad |
| Comprobaciones | Etiquetado y, si corresponde, autorización/revisión de apilado | Declaración real de la persona que revisa; no rellenar por defecto |
| Personas | Nombre, identidad de acceso, perfil y autorización de cierre | Lo relativo a usuarios requiere la ampliación de perfiles |
| Tareas | Título, zona, responsable real y fecha objetivo | Sustituir asignaciones genéricas de las nueve tareas iniciales |

La fecha física de recuento y la persona verificadora conviene conservarlas en el registro de preparación. Hoy el movimiento guarda como fecha la del servidor al introducirlo; una fecha de recuento distinta solo puede anotarse como observación. Un futuro importador debe distinguir ambas fechas.

### Orden de carga con las pantallas actuales

1. Acordar una hora de corte y quién registra las operaciones durante el recuento para no contar dos veces una entrada o salida.
2. Crear las referencias en Inventario, revisar SKU y descripción y comprobar duplicados.
3. Crear las ubicaciones vacías en Ubicaciones con área, pasillo y capacidad reales. No deducir capacidad del plano.
4. Registrar una entrada inicial por combinación de SKU y bloque. Si el mismo SKU está en tres bloques, registrar tres entradas. Si un bloque contiene dos SKU, corregir la organización física o definir bloques separados antes de cargar.
5. Indicar responsable real, comprobaciones y una observación/documento que identifique el inventario inicial. `INICIAL-AAAA-MM-DD` es un ejemplo de convención, no un documento existente ni un tipo especial de movimiento.
6. Comparar cantidades físicas y registradas por SKU, por bloque, por zona y en el total. Cargar el catálogo por sí solo deja el stock a cero.
7. Actualizar datos, exportar una copia y verificar su contenido. Acordar quién autoriza el inicio y quién registra desde ese momento.

Para un catálogo pequeño se puede hacer esta carga manual después de resolver los riesgos prioritarios. Para muchos registros falta un importador por lotes con mapeo de columnas, simulación, errores por fila, identificador de lote, idempotencia y conciliación. No debe sustituir el estado entero para añadir datos.

### Criterios de inventario aceptado

- Cada SKU y cada bloque existen físicamente y tienen un único código normalizado.
- Cada bloque ocupado tiene exactamente un SKU válido y una cantidad entera mayor que cero y hasta su capacidad. Un bloque vacío tiene cantidad cero y SKU vacío.
- El stock por referencia equivale a la suma de sus bloques; el total por zonas más los pendientes de asignar coincide con el total general. Para arrancar, los pendientes deben quedar resueltos.
- Las entradas iniciales explican todos los saldos iniciales y están identificadas como tales.
- El recuento tiene fecha de corte, responsable y revisión; las discrepancias quedan resueltas o registradas antes de aceptar el saldo.
- La copia inicial puede restaurarse en una base aislada con las mismas cantidades y relaciones.

## 12 Trabajo pendiente en orden de prioridad

### Antes de abrir el uso conjunto de oficina y operarios

1. **Identidad y permisos reales.** Implementar la matriz de la sección 10, atribuir operaciones desde sesión y adaptar las vistas. Terminado cuando un operario no puede editar catálogo/capacidades ni obtener una copia completa mediante una llamada directa, y ambos perfiles ven el mismo saldo autorizado.
2. **Reintentos sin duplicar movimientos.** Generar una clave de operación estable, conservarla al reintentar y asegurar unicidad en el servidor. Terminado cuando perder la respuesta y reenviar produce exactamente un movimiento; reutilizar la clave con otros datos se rechaza.
3. **Datos actualizados entre puestos.** Rechazar respuestas con revisión menor y refrescar al recuperar foco y tras cambios. Terminado cuando oficina y operarios convergen al saldo guardado y la pantalla informa de datos desactualizados.
4. **Confirmaciones y autoría conservadas.** Desmarcar comprobaciones cuando cambie SKU, cantidad, tipo, origen, destino o apilado; guardarlas vinculadas a operación y autor. Terminado cuando no se puede reutilizar una comprobación hecha sobre otra operación.

### Antes de confiar el inventario real a la app

5. **Importación y recuperación verificadas.** Validar el documento completo, proteger también tareas, añadir simulación y copia previa y ensayar recuperación. Terminado cuando todos los casos inválidos se rechazan sin escribir y una copia válida recupera los mismos saldos.
6. **Recuentos, ajustes y correcciones.** Añadir motivo, identidad, cantidades anterior/nueva y referencia al error corregido. No borrar el movimiento original. Terminado cuando una equivocación se corrige sin simular una expedición real.
7. **Evitar cambios de datos sin rastro.** Rechazar ID desconocido al editar, validar fechas civiles y auditar cambios de área/pasillo con stock. Se ha reproducido en memoria que cambiar el área de un bloque ocupado no crea movimiento y que se acepta `2026-99-99` como fecha de tarea.
8. **Preparación física y carga inicial.** Recopilar y validar los datos de la sección 11 y ensayar el ciclo completo con el equipo.

### Calidad y operación del despliegue

9. **Lint y automatización.** Resolver los tres usos de `any`, dos errores de efectos y el import no usado en `app/page.tsx`. Añadir CI con lint, tipos, pruebas y compilación, más integración en Postgres aislado para permisos, reintentos y concurrencia. No hay una barrera CI versionada en el repositorio actual.
10. **Acceso y recuperación operativa.** Confirmar límite distribuido de login, copias, retención, restauración, alertas y responsable de incidencias. Fijar la misma versión principal compatible de Node en desarrollo y despliegue.
11. **Fotografías, si se van a usar.** Corregir tamaño, cancelación, formatos y tratamiento de fallos; verificar proveedor y coste con etiquetas reales. La carga manual no depende del OCR.
12. **Trabajo de operarios en móvil y cierre.** Probar menú, formularios, teclado y reconexión en sus dispositivos; revisar impresión de casillas; permitir comunicar incidencias sin declarar falsamente cinco conformidades. La interfaz de cierre actual solo admite conformidad completa.
13. **Crecimiento y mantenimiento.** Paginar/separar movimientos, añadir archivo lógico, migraciones versionadas y rol de base con permisos mínimos. Hoy cada lectura/escritura transporta todo el histórico y el arranque necesita DDL.

Los puntos 1 a 4 son requisitos del uso con los dos perfiles solicitados. Ya no se consideran una ampliación opcional. No hace falta desplegar otra vez para comprobar que el sitio existe; hace falta completar y probar estos cambios antes de habilitar el trabajo compartido.

## 13 Cómo desplegar y mantener la app

El proyecto incluye `vercel.json` para Next.js y región `cdg1`. La documentación del repositorio sitúa la base en París; la ubicación y configuración efectiva del proveedor deben confirmarse antes de cambiar entornos. Se necesita un servidor Next.js con rutas de API; no es una exportación estática. [Next.js documenta las opciones de despliegue con servidor](https://nextjs.org/docs/app/getting-started/deploying).

| Configuración | Uso |
| --- | --- |
| Node | `package.json` exige 22.13.0 o superior; esta revisión se ejecutó con 25.8.2 |
| `WAREHOUSE_ADMIN_USER` | Cuenta única actual; reemplazar el diseño de acceso cuando se incorporen personas y roles |
| `WAREHOUSE_ADMIN_PASSWORD` | Contraseña y material para firma de sesión; mantener como secreto de servidor |
| `DATABASE_URL` o `POSTGRES_URL` | Conexión privada de Postgres; comprobar prioridad y destino antes de operar |
| Credenciales del proveedor de IA | Solo para lectura de fotos; verificar configuración del AI Gateway en cada entorno |
| Variables de producción y previsualización | Deben apuntar a bases separadas para que ensayos no modifiquen inventario real |

Las variables necesarias para login y Postgres están presentes localmente. Se detectó un token OIDC de Vercel y ausencia de `AI_GATEWAY_API_KEY`; la mera presencia del token no acredita que el OCR funcione. No se incluyen valores de secretos en este documento.

Preparación reproducible:

```sh
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
```

En este entorno el build predeterminado falla por el permiso de puerto interno; `npm run build -- --webpack` sí termina correctamente. Esto no resuelve los errores de lint. Para desarrollo local se ha usado `npm run dev -- --webpack --hostname 127.0.0.1`. Para servir una compilación de producción se utiliza `npm start`.

Antes de un nuevo despliegue, verificar la separación de bases, el contenido del paquete y que no incluya `.env`, copias o informes privados. El proyecto ya tiene `.gitignore` y `.vercelignore` para esas exclusiones. Preparar una copia verificada y un procedimiento de vuelta atrás, especialmente si se cambia el esquema; volver a una versión que exponga el Data API no es una recuperación válida.

Después, comprobar login, rechazo sin sesión, permisos por perfil, lectura, origen de escrituras, conexión, RLS y permisos públicos retirados. Los ensayos que generen movimientos deben hacerse primero en la base aislada. En producción verificar disponibilidad, permisos y conciliación con datos reales autorizados.

## 14 Pruebas de aceptación antes del primer turno

| Ensayo en entorno aislado | Resultado exigido |
| --- | --- |
| Crear referencia y bloque, introducir saldo inicial | Catálogo y saldos correctos en ambas vistas/perfiles |
| Entrada, traslado y salida | Stock por bloque y SKU correcto; un movimiento por operación |
| Dos usuarios escriben sobre la misma revisión | Conflicto controlado sin pérdida de datos |
| Guardado correcto cuya respuesta se pierde | Reintento devuelve resultado previo sin duplicar |
| GET antiguo llega después de un guardado | La pantalla no retrocede de revisión |
| Operario intenta editar capacidades o exportar copia por API | Rechazo en el servidor, aunque se manipule la petición |
| Cambiar campos después de marcar comprobaciones | Obliga a comprobar otra vez |
| Cantidad negativa, exceso de capacidad, SKU ajeno o mezcla de referencias | Rechazo sin alterar saldos |
| Archivo inválido o base con tareas propias | Restauración/importación rechazada sin pérdida |
| Restaurar copia válida | Mismos saldos, relaciones, histórico, tareas y cierres esperados |
| Recuento con diferencia | Incidencia y ajuste autorizado con trazabilidad |
| Cierre conforme y cierre con incidencia | Firma del autorizado o registro veraz de la incidencia según el flujo implementado |
| Sesión caducada y desconexión | Mensaje útil; reentrada y revisión del borrador sin duplicar operación |
| Móvil e impresión | Formularios utilizables y checklist legible con sus estados |

El primer turno real se acepta cuando los saldos físicos coinciden, oficina y operarios trabajan con sus permisos, se conoce quién resuelve incidencias y hay una copia recuperable. Una pantalla accesible y una compilación correcta no bastan para acreditar esas condiciones.

## 15 Evidencias y referencias de mantenimiento

La explicación de implementación procede de los archivos indicados en la sección 2 y del modelo en `lib/warehouse.ts`. Los números de línea siguientes corresponden al código base revisado y pueden cambiar al editarlo:

| Tema | Punto de entrada en el código |
| --- | --- |
| Campos y reglas | `lib/warehouse.ts:2` y `lib/warehouse.ts:23` |
| Zonas admitidas | `lib/areas.ts:1` |
| Lectura y guardado HTTP | `lib/server/warehouse-api.ts:18` |
| Esquema y escritura condicional | `db/postgres-warehouse.ts:4` y `db/postgres-warehouse.ts:40` |
| Conexión e inicialización | `db/supabase-warehouse.ts:15` |
| Sesión y duración | `lib/server/session.ts:6` y `lib/server/session.ts:91` |
| Cálculos de pantalla | `app/page.tsx:42` |
| Reintentos y refresco | `app/page.tsx:29` y `app/page.tsx:38` |
| Importador | `scripts/import-state.mjs:29` y `scripts/import-state.mjs:52` |

Evidencias locales de esta revisión, excluidas del despliegue y del repositorio por la configuración existente:

- `outputs/audit/2026-10-01/production-readonly-report.json`: acceso publicado, recuentos, metadatos de RLS/permisos y rechazo del Data API.
- `outputs/audit/2026-10-01/local-readonly-report.json`: login y lectura en el servidor local.
- `outputs/audit/2026-10-01/quality-summary.json`, `test.log`, `lint-report.json` y `build-webpack.log`: pruebas, lint y compilación.
- `outputs/audit/2026-10-01/domain-report.json`: 11 reproducciones de reglas e importación en memoria, sin escrituras en la base ni peticiones de red.

La auditoría del 29 de septiembre permanece en [TODO_APP.md](../TODO_APP.md) como detalle previo de incidencias. Esta revisión actualiza el estado comprobado y convierte los perfiles de oficina y operarios en requisito del alcance solicitado.

Quedan pendientes de comprobación práctica el OCR real, restauración completa, concurrencia contra Postgres, operación con inventario físico, móvil real y salida impresa. Los riesgos de formularios y cálculos descritos proceden de lectura del código y reproducciones en memoria cuando se indica; no se presentan como ensayos físicos completados.
