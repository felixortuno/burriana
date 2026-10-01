# BURRIANA · Estado de la app y lista de trabajo

Revisión: **29/09/2026**. Base de código: `afe4824348da15863b82862658431a54a1618442`, más los cambios de protección y despliegue descritos aquí.

La app sirve como base para controlar palets completos desde oficina. Gestiona referencias, bloques, entradas/salidas/traslados, tareas 5S y cierres. El siguiente paso es asegurar la recuperación y los reintentos, preparar el inventario real y ensayar un turno completo. No hace falta reescribirla para conseguirlo.

Este documento sustituye la auditoría del 24/09: la arquitectura actual es **Next.js en Vercel + Postgres en Supabase**, con login propio. Las referencias antiguas a Sites, D1 y su límite de 2 MB ya no aplican.

## Despliegue y situación real

- [x] Publicada en [burriana.vercel.app](https://burriana.vercel.app), en el proyecto existente `grupotrimodos/burriana`.
- [x] Compilación de producción en Vercel y TypeScript correctos.
- [x] Añadido `.vercelignore`: el paquete excluye credenciales, configuración local de agentes, estado de desarrollo e informes de auditoría. Comprobado con `vercel deploy --dry --json`.
- [x] Cerrada y verificada la vía de acceso directo a `public.warehouse`: RLS activa, permisos públicos retirados y Data API anónimo rechazado con **401 / 42501**; la app autenticada mantiene lectura **200**.

Despliegue final: [`burriana-fak9rgvdg-grupotrimodos.vercel.app`](https://burriana-fak9rgvdg-grupotrimodos.vercel.app), identificador `dpl_33ZVcdVsiUHtdAgm5otf9UduvPRC`, estado **READY**, funciones en `cdg1`. Verificado el 29/09/2026 a las 10:31 (Europe/Madrid). El dominio estable es el enlace anterior de `burriana.vercel.app`.

En la lectura autenticada de esta revisión, la app devuelve **revisión 0**, **0 referencias**, **0 ubicaciones**, **0 movimientos**, **0 cierres** y **9 tareas iniciales**. Por tanto, todavía falta poner en marcha el almacén con sus datos reales. No se han insertado referencias ni movimientos de prueba en producción.

### Hallazgo crítico detectado durante el despliegue

La pantalla de entrada protegía correctamente la API de la app, pero `public.warehouse` tenía RLS desactivado y permisos de lectura/escritura para `anon` y `authenticated`. Una consulta directa al Data API con la clave pública respondió 200. La comprobación solicitó cero filas y no intentó escribir datos.

La corrección **ya desplegada** activa RLS y revoca los permisos de `PUBLIC`, `anon` y `authenticated` sobre esa tabla, dentro de la inicialización transaccional existente. El servidor sigue usando su conexión privada. No se cambian usuarios, contraseñas ni datos de inventario. Esta combinación sigue la [guía de seguridad de Data API de Supabase](https://supabase.com/docs/guides/api/securing-your-api).

La comprobación posterior confirma permisos efectivos de SELECT/INSERT/UPDATE/DELETE denegados para ambos roles públicos, acceso del servidor conservado, revisión 0 y los mismos recuentos. Los cambios están en `db/postgres-warehouse.ts` y `db/supabase-warehouse.ts`; [procedimiento y límites](db/security.md). Las demás mejoras de esta lista permanecen pendientes.

## Comprobaciones y límites del análisis

| Comprobación | Resultado |
|---|---|
| Producción, acceso anónimo | `/` redirige a `/login` (307), login 200; GET/POST de inventario y POST de fotos devuelven 401. |
| Producción, acceso autorizado | Login 200, cookie HttpOnly/Secure/SameSite=Lax, lectura de inventario 200 y logout 200 con borrado de cookie. |
| Origen de mutaciones | POST autenticado desde origen ajeno rechazado con 403 antes de modificar datos. |
| Protección de Supabase | RLS activa, sin concesiones a PUBLIC/anon/authenticated, permisos efectivos denegados y Data API anónimo 401. |
| Pruebas automatizadas | Dominio correcto, 13 pruebas de acceso y 2 pruebas nuevas de espera/fallo de inicialización correctas (`npm test`). Las dos últimas usan adaptador en memoria. |
| Tipos | `tsc --noEmit` correcto. |
| Build | `next build --webpack` correcto localmente; `npm run build` con Turbopack correcto en Vercel. Turbopack local bloqueado por permisos de apertura de puertos del entorno, no por un error demostrado de la app. |
| Lint | **5 errores y 1 aviso** en `app/page.tsx`: tres `any`, dos efectos con cambios de estado y un import sin usar. |
| Reproducciones de auditoría | **11 casos** en memoria: fechas, duplicación, cambios de zona, IDs desconocidos e importación inválida. |
| Navegador | Pantalla de login de producción comprobada visualmente en escritorio. |

**Pendiente de prueba práctica:** navegación interior autenticada en navegador, móvil real, impresión/PDF, lector de pantalla, OCR con fotografías reales, recuperación completa en una base aislada, carga y concurrencia contra Postgres. Los defectos de UI se indican como hallazgos de código, no como pruebas visuales completadas. La verificación en producción no modifica stock ni crea cierres. No se ha auditado el histórico de accesos ni se puede concluir si hubo accesos anteriores al Data API.

## P1 · Antes del uso diario

Las estimaciones son orientativas para una persona familiarizada con el proyecto, incluyendo pruebas. Algunas tareas comparten trabajo; no deben sumarse como un presupuesto cerrado.

### 1. Hacer que un reintento no duplique una operación · 1–2 días

- [ ] **Problema:** si se guarda una entrada y se pierde la respuesta, actualizar/reintentar puede registrarla otra vez. La revisión optimista evita escrituras simultáneas obsoletas, pero no reconoce una intención ya ejecutada. Evidencia: `app/page.tsx:38`, `lib/server/warehouse-api.ts:40`, `lib/warehouse.ts:24,34`.
- **Solución:** generar un `operationId` al primer envío, conservarlo mientras se reintenta y garantizar unicidad en el servidor dentro de la misma transacción. Devolver el resultado anterior si coinciden identificador y datos; rechazar el identificador reutilizado con datos diferentes.
- **Terminado cuando:** perder la respuesta después de guardar y reintentar varias veces produce exactamente un movimiento y una variación de stock. Probar también dos pestañas y recarga.

### 2. Invalidar las confirmaciones al cambiar el movimiento · ½ día

- [ ] **Problema:** cantidad, SKU, origen, destino o tipo pueden cambiar manteniendo marcadas las comprobaciones de etiquetado, doble revisión y apilado. Hallazgo de código: `app/page.tsx:40,65`.
- **Solución:** limpiar las confirmaciones afectadas y vincularlas a los datos exactos que se guardan. La autorización física de apilado sigue dependiendo del responsable del almacén.
- **Terminado cuando:** cambiar cualquier dato relevante después de comprobar una operación exige revisarla de nuevo.

### 3. Validar las copias y ensayar la recuperación · 1–2 días

- [ ] **Problema:** ya hay exportación JSON y un importador administrativo, pero este valida solo la presencia de arrays y algunos duplicados. Se ha reproducido que acepta stock negativo, exceso de capacidad, SKU inexistente, IDs duplicados y SKU duplicado con mayúsculas/minúsculas. Además, puede reemplazar tareas personalizadas sin `--force` si las otras colecciones están vacías. Evidencia: `scripts/import-state.mjs:29,39,52`.
- **Solución:** esquema de copia versionado, validación completa de tipos y relaciones, unicidad normalizada, cantidades/capacidades y fechas. Añadir modo simulación, resumen de cambios, copia previa y protección de todas las colecciones, incluidas tareas.
- **Terminado cuando:** una copia válida restaura entidades y totales en un entorno aislado; cada caso inválido se rechaza sin escritura; las tareas reales impiden reemplazar sin autorización explícita. Documentar responsable, frecuencia, ubicación de copias y ensayo de recuperación.
- **Alcance:** no se ha verificado el plan de copias del proveedor; no se afirma que Supabase carezca de backups. Evitar añadir una pantalla de importación antes de asegurar el procedimiento.

### 4. Añadir ajustes de inventario con trazabilidad · 2–4 días

- [ ] **Problema:** solo existen entrada, salida y traslado. No hay recuento, merma ni corrección vinculada a un movimiento erróneo (`lib/warehouse.ts:4,28`).
- **Solución:** recuentos y movimientos compensatorios con motivo, responsable, cantidades anterior/nueva y vínculo al original. Conservar los movimientos originales y las comprobaciones de stock/capacidad.
- **Terminado cuando:** corregir una entrada equivocada no requiere inventar una expedición ni borrar el historial; las discrepancias con operaciones posteriores quedan visibles.

### 5. Limitar intentos de login entre instancias · ½–1 día

- [ ] **Problema:** el contador actual vive en memoria de cada función; varias instancias no comparten el bloqueo (`app/api/session/route.ts:30-68`). No se ha comprobado si existe una regla adicional en el firewall de Vercel.
- **Solución:** revisar primero esa configuración y, si falta, usar un límite distribuido en plataforma o almacén compartido con caducidad, respuesta `Retry-After` y registro de rechazos. Mantener las credenciales existentes salvo decisión del propietario.
- **Terminado cuando:** intentos repartidos entre instancias quedan limitados y el acceso legítimo vuelve a funcionar al terminar el intervalo.

### 6. Asegurar el flujo de lectura de fotografías · 1–2 días

- [ ] **Problemas:** una lectura lenta puede completar después de cerrar el formulario y rellenar una referencia distinta (`app/reference-photo.tsx:22-28`, `app/page.tsx:62`). Se aceptan hasta 6 MiB y `image/*` sin compresión previa; Vercel limita los cuerpos de Functions a 4,5 MB, por lo que una foto grande puede fallar antes de alcanzar la validación de la app. El cliente presupone JSON y puede confundir ese fallo con falta de conexión. [Límites oficiales de Vercel](https://vercel.com/docs/functions/limitations).
- **Solución:** cancelar al cerrar con `AbortController` y comprobar identidad del formulario/lectura; presentar una propuesta de campos para confirmar. Validar formato, redimensionar/comprimir con margen inferior al límite y tratar respuestas no JSON. Convertir HEIC o rechazarlo con claridad; probarlo a través del proveedor real. Definir un límite de uso/coste del OCR.
- **Terminado cuando:** cancelar una lectura no altera el siguiente formulario; fotografías reales de Android/iPhone funcionan y los archivos grandes, ilegibles o incompatibles muestran un error útil. No guardar automáticamente lo inferido.

### 7. Establecer una barrera automática de calidad · 1–2 días iniciales

- [ ] **Problema:** existen pruebas de dominio y acceso, pero lint falla y no hay CI ni pruebas versionadas de recuperación, API completa, OCR o Postgres real.
- **Solución:** corregir los cinco errores y el aviso, tipar formularios/acciones y dividir gradualmente `app/page.tsx` por flujos. Incorporar CI con lint, tipos, pruebas y build; integración con Postgres aislado para concurrencia, reintento, recuperación y seguridad de tabla. Fijar una versión mayor de Node compatible en desarrollo y despliegue.
- **Terminado cuando:** CI bloquea una regresión de stock, acceso o migración; ninguna prueba usa la base de producción. Conservar las reglas que ya pasan.

### 8. Preparar los datos reales y ensayar un turno · tiempo según catálogo

- [ ] Crear referencias con SKU único, descripción, familia y mínimo validado.
- [ ] Registrar bloques físicos en cartón o montaje/cajas, con pasillo y capacidad comprobados in situ.
- [ ] Recontar e introducir existencias iniciales con responsable y etiquetado.
- [ ] Asignar personas y fechas reales a las tareas 5S.
- [ ] Acordar quién registra, revisa, corrige discrepancias y recupera copias.
- [ ] Ensayar entrada → traslado → salida → cierre y contrastar existencias físicas/registradas.

El plano es una referencia de proyecto de 2022; no permite deducir posiciones exactas, capacidad ni existencias reales.

## P2 · Robustez, operación e interfaz

| Pendiente | Mejor solución y criterio de aceptación | Esfuerzo orientativo |
|---|---|---|
| [ ] **Historial y estado que puedan crecer.** Se lee/devuelve/reescribe todo el JSON (`db/postgres-warehouse.ts`, `lib/server/warehouse-api.ts:24,68`). | Separar primero movimientos del estado operacional y paginar; después tablas de referencias, ubicaciones, tareas y cierres según necesidad. Stock y movimiento deben seguir siendo transaccionales. Validar 20.000 movimientos con respuestas pequeñas, filtros por fecha y exportación que admita volumen. No esperar al límite de respuesta de Vercel. | 3–5 días |
| [ ] **Migraciones y permisos mínimos.** Hoy se inicializa la tabla durante la petición (`db/supabase-warehouse.ts`). | Migraciones versionadas y probadas desde base vacía/existente; rol de ejecución sin DDL y esquema explícito. Conservar la protección de RLS/permisos introducida en esta revisión. | 1–2 días, junto al cambio de almacenamiento |
| [ ] **Evitar que una respuesta antigua muestre stock obsoleto.** `app/page.tsx:29,32,38` aplica respuestas sin comparar revisión. | Descartar revisiones menores, coordinar refresh y refrescar al recuperar foco; mostrar última actualización. Un GET lento anterior a un guardado no debe hacer retroceder la pantalla ni la exportación. | ½–1 día |
| [ ] **Cambio de zona con stock sin rastro.** Reproducido en `lib/warehouse.ts:27`. | Diferenciar traslado físico y corrección administrativa; motivo, responsable y antes/después para esta última. Todo cambio con existencias debe quedar explicado. | ½–1 día |
| [ ] **Fechas imposibles.** Acepta `2026-99-99`, `2026-02-30` y `2025-02-29` (`lib/warehouse.ts:36`). | Validar calendario real y bisiestos, también al importar. Rechazar esos casos y aceptar `2028-02-29`. | 1–2 horas |
| [ ] **Ediciones con ID desconocido crean entidades.** Reproducido en `lib/warehouse.ts:26-27`. | Separar creación/edición; ID inexistente en edición debe rechazarse sin crear producto/ubicación. | 1–2 horas |
| [ ] **Archivar referencias, ubicaciones y tareas.** No existe estado de archivo. | Archivo lógico y reactivación; bloquear archivo con stock, conservar histórico y excluir archivados de operaciones nuevas. | 1–2 días |
| [ ] **Cierre con incidencias.** Solo admite cinco conformidades (`lib/warehouse.ts:37`, `app/page.tsx:57`). | Separar inspección de conformidad; incidencia, responsable, plazo y resolución. Registrar un pasillo bloqueado sin declarar falsamente un cierre conforme. | 2–3 días |
| [ ] **Impresión del cierre.** CSS oculta todos los botones, incluidas casillas Radix (`app/globals.css:108`). Hallazgo de código. | Representación imprimible explícita, con estados, fecha y responsable; detalle de cierres anteriores. Verificar PDF pendiente y firmado. | ½–1 día |
| [ ] **Móvil.** Navegar no cierra el menú y el diálogo pierde el margen lateral (`app/page.tsx:37`, `app/globals.css:106`). Hallazgo de código. | Cerrar `openMobile` al navegar, ancho limitado al viewport, altura/scroll adecuados. Validar 360/390 px con teclado virtual y textos largos. | ½–1 día |
| [ ] **Accesibilidad.** Búsqueda sin foco visible, textos secundarios con contraste bajo y etiquetas inglesas. | Foco visible, etiquetas españolas, contraste y errores anunciados. Recorrer con teclado y lector; comprobar formularios/diálogos. | ½–1 día |
| [ ] **Selectores que orienten la operación.** Ofrecen destinos llenos o sin zona (`app/page.tsx:65`). | Mostrar stock/capacidad libre, búsqueda por SKU/bloque y deshabilitar destinos inviables con explicación. Mantener controles del servidor. | 1–2 días |
| [ ] **Filtros y planificación.** Algunos vacíos dicen que no hay datos aunque solo estén filtrados; “esta semana” muestra las primeras cuatro tareas (`app/page.tsx:52-55`). | Distinguir sin datos/sin coincidencias, botón limpiar filtros y tareas por fecha/vencimiento o título fiel al contenido. | ½ día |
| [ ] **Caducidad y salida de sesión.** Login promete 07:00–15:00, pero la cookie vence ocho horas después del acceso; 401 no ofrece reentrada y logout no trata error de red. | Explicar duración real, facilitar reentrada conservando el borrador de forma segura y tratar el fallo de logout. Probar sesión vencida y desconexión. | ½ día |
| [ ] **Observación operativa.** No hay evidencia de alertas ni procedimiento documentado para fallos de lectura, guardado u OCR. | Métricas/alertas de errores y latencia, tamaño del estado y coste OCR; registros sin contraseñas, fotos o contenido sensible. Documentar diagnóstico y recuperación. | ½–1 día |

## Ampliaciones opcionales, sujetas al uso real

- [ ] **Identidad individual y roles**, si varias personas van a operar. Hoy el responsable es texto libre bajo una cuenta de oficina, no una identidad autenticada ni firma certificada.
- [ ] **Escaneo de códigos y etiquetas de movimientos**, tras un piloto con los dispositivos del almacén. Ya existe lectura de fotos para crear referencias; no confundirla con escaneo operativo completo.
- [ ] **Palets parciales, lotes, pedidos o unidades interiores**, solo después de definir procesos y conversiones. El alcance actual los excluye expresamente.
- [ ] **Trabajo sin conexión**, solo si es necesario: requiere una estrategia de sincronización y conflictos, no basta instalar una PWA.

## Orden recomendado de ejecución

1. **Hecho:** cerrar y verificar el acceso directo a Supabase, conservando login y API privada.
2. Confirmaciones de movimientos, reintentos, validación/ensayo de copias, login distribuido y pruebas automáticas.
3. Ajustes de inventario y OCR seguro; cargar datos y realizar un piloto controlado.
4. Incidencias, cambios de zona, archivo, móvil, impresión y accesibilidad.
5. Separar/paginar historial antes de acumular volumen o ampliar a varios puestos; introducir migraciones y rol de permisos mínimos conjuntamente.
6. Decidir ampliaciones a partir del piloto, sin reescritura completa ni funcionalidades ajenas al flujo real.

## Evidencias locales

Estos archivos están excluidos del despliegue y del repositorio por la configuración actual:

- [Casos de dominio e importación](outputs/audit/2026-09-29/domain-report.json) y [script reproducible](outputs/audit/2026-09-29/domain-audit.mjs): solo memoria, sin red ni base de datos.
- [Acceso y metadatos antes de la protección](outputs/audit/2026-09-29/production-before-hardening.json).
- [Última verificación de producción](outputs/audit/2026-09-29/production-readonly-report.json) y [script](outputs/audit/2026-09-29/production-readonly.mjs): credenciales en memoria, nunca impresas; sin escrituras de inventario.
- [Informe de lint](outputs/audit/2026-09-29/lint-report.json).
- [Estado final del despliegue](outputs/audit/2026-09-29/deployment-report.json).
