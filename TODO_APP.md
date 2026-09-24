# BURRIANA · Análisis y lista de trabajo

Fecha de cierre: 24/09/2026. Código revisado: `db7a4e904749cd91454360296b4e6ae750f51e1c`.

La app tiene una base funcional para gestionar palets completos desde oficina. Antes de ampliar su uso conviene resolver la recuperación de datos, los reintentos de movimientos y las correcciones de inventario. El historial también necesita un almacenamiento que permita crecer.

## Despliegue realizado

- [x] Publicada la **versión 3**, con acceso privado para la cuenta propietaria, en [BURRIANA](https://burr-almacen.pausanpui.chatgpt.site).
- [x] Publicado el código actual del repositorio, compilado y empaquetado desde el mismo commit.
- [x] Aplicada mediante el despliegue la migración correctora ya existente. Antes, la base publicada no tenía tablas; después, existe `warehouse`.
- [x] Verificada lectura autenticada en producción: HTTP **200**, revisión **0**. Catálogo, ubicaciones, movimientos y cierres vacíos; nueve tareas iniciales 5S.
- [x] Verificados GET y POST anónimos después del despliegue: HTTP **401** en ambos casos.

La publicación se completó el 23/09/2026 a las 09:49 UTC. No se han implementado las mejoras de esta lista ni se han introducido datos de prueba en producción. El acceso se mantiene igual que antes.

## Qué se ha comprobado

| Comprobación | Resultado y alcance |
|---|---|
| Compilación de producción | `npm run build`: correcta. |
| Tipos | `tsc --noEmit`: correcto. |
| Reglas de almacén | `node --experimental-strip-types tests/warehouse.test.mjs`: correctas. |
| API y D1 local | **20 comprobaciones correctas**: altas, entrada, traslado, salida, validaciones, cierre, persistencia mediante lecturas y concurrencia. |
| Dos escrituras con la misma revisión | Una devuelve **200** y otra **409**; se registra un único movimiento. |
| Rechazos de movimientos | Exceso de capacidad, mezcla de referencias, falta de etiquetas, falta de doble revisión y stock insuficiente: **400**, sin cambiar estado ni revisión. |
| Acceso publicado | Lectura autenticada **200**; GET y POST anónimos **401**. |
| Lint | Pendiente: **5 errores y 1 aviso** en `app/page.tsx`. |
| Interfaz de escritorio | Inspeccionados Resumen, Inventario y Ubicaciones en la copia local con datos AUDIT. |

No se ha completado el recorrido visual en móvil, la impresión, la navegación íntegra con teclado ni el inicio de sesión de la propietaria en navegador. Tampoco se han probado escrituras en producción ni persistencia tras reiniciar el servidor. Los hallazgos visuales pendientes se basan en código, no en una prueba visual completada.

Evidencias locales: [prueba API](outputs/audit/api-local-report.json), [script reproducible](outputs/audit/api-local-smoke.mjs) e [informe de despliegue](outputs/audit/deployment-report.json). Los datos AUDIT permanecen exclusivamente en `.wrangler/state` local.

## P1 · Resolver antes de un uso habitual o de acumular historial

Las estimaciones son orientativas para una persona que conozca el código, con pruebas y revisión. No son compromisos ni deben sumarse directamente: algunas tareas comparten trabajo.

### 1. Invalidar las comprobaciones cuando cambia el movimiento

- [ ] **Problema:** una confirmación de seguridad puede seguir marcada después de modificar referencia, cantidad, origen, destino o tipo. Evidencia estática: `app/page.tsx:60` conserva `verified`, `labelled`, `safe` y `stacked` al cambiar otros campos.
- **Solución:** reiniciar las confirmaciones afectadas por cada cambio y vincular la revisión a los datos exactos que se guardan.
- **Terminado cuando:** verificar una salida de SKU A y cambiar a SKU B, otra cantidad u otra ubicación obliga a comprobar de nuevo los datos.
- **Esfuerzo:** ½ día.

### 2. Impedir que un reintento duplique stock

- [ ] **Problema:** si el servidor guarda y se pierde la respuesta, el usuario conserva el formulario. Tras actualizar la revisión puede enviar de nuevo la misma operación. El escenario de red se deduce de `app/page.tsx:33`; `lib/warehouse.ts:34` crea un identificador nuevo cada vez. La protección por revisión funciona, pero no identifica una operación ya realizada.
- **Solución:** generar un `operationId` al primer envío, conservarlo durante los reintentos y establecer unicidad en servidor. Un reintento debe devolver el resultado ya guardado; reutilizar el identificador con datos distintos debe rechazarse.
- **Terminado cuando:** perder la respuesta después del guardado y reintentar varias veces produce exactamente un movimiento y un cambio de stock.
- **Esfuerzo:** 1–2 días; coordinar con la tarea 3.

### 3. Separar el historial y las entidades en tablas

- [ ] **Problema:** toda la aplicación se guarda en una sola celda JSON (`db/schema.ts:2`, `app/api/warehouse/route.ts:4-10`). Cada lectura devuelve todo el historial y cada escritura lo reescribe. D1 limita una cadena o fila a **2.000.000 bytes**: al alcanzar ese límite pueden fallar todos los guardados, incluidos salidas y cierres. [Límite oficial de D1](https://developers.cloudflare.com/d1/platform/limits/).
- **Evidencia:** simulaciones en memoria superan el límite con unos 10.000 movimientos mínimos con UUID, o unos 2.000 con notas largas permitidas. No es un umbral fijo: depende del tamaño real de los datos. No se hizo una prueba de saturación en producción.
- **Solución:** tablas para productos, ubicaciones, movimientos, tareas y cierres; índices por SKU, ubicación y fecha; historial paginado. Migración validada con copia previa y comparación de totales. Mantener el cambio de stock y su movimiento en una operación atómica.
- **Terminado cuando:** 20.000 movimientos de prueba no impiden registrar salidas o cierres, las consultas no descargan todo el historial y siguen pasando los casos de concurrencia.
- **Esfuerzo:** 3–5 días.

### 4. Disponer de recuperación de datos probada

- [ ] **Problema:** se descarga JSON pero no hay restauración desde la interfaz ni procedimiento propio de recuperación probado (`README.md:23`, `app/page.tsx:55`). Esto no significa que el proveedor carezca de copias.
- **Solución:** empezar por un procedimiento administrativo con validación del esquema, copia previa y restauración en un entorno aislado. Definir quién puede ejecutarlo, dónde se guardan las copias y qué pérdida de datos es aceptable. Añadir interfaz de importación solo si aporta utilidad operativa.
- **Terminado cuando:** una copia restaura referencias, ubicaciones, existencias, movimientos, tareas y cierres con totales coincidentes. Documentar el ensayo y repetirlo después de migraciones importantes.
- **Esfuerzo:** 1–2 días para procedimiento y prueba; una interfaz añade trabajo. Verificar qué mecanismos permite el alojamiento; D1 dispone de [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), cuya disponibilidad operativa a través de Sites no se ha probado aquí.

### 5. Corregir errores y diferencias de inventario con trazabilidad

- [ ] **Problema:** solo existen entrada, salida y traslado (`lib/warehouse.ts:28-34`). No hay recuento, merma ni corrección vinculada al movimiento original.
- **Solución:** incorporar ajustes por recuento y movimientos compensatorios con motivo, responsable, cantidades anterior/nueva y vínculo al original. Mantener el historial; comprobar stock y capacidad también en las correcciones.
- **Terminado cuando:** una entrada equivocada se corrige sin borrar el original ni simular un albarán de expedición. Una corrección incompatible con movimientos posteriores exige resolver la discrepancia.
- **Esfuerzo:** 2–4 días.

### 6. Convertir las verificaciones en una barrera automática de calidad

- [ ] **Problema:** las pruebas del repositorio solo cubren el dominio; las 20 pruebas HTTP de esta auditoría no forman parte de CI. Lint falla por tres usos de `any` (líneas 25, 31, 34), dos efectos con cambios de estado (29, 30) y avisa de `Task` sin uso (12), en `app/page.tsx`.
- **Solución:** tipar formularios y acciones, revisar los efectos y añadir `npm test` y CI con tipos, lint, dominio, integración D1 aislada y build. Convertir el script de auditoría en prueba con entorno propio y limpieza segura. Añadir respuesta perdida, migraciones y persistencia tras reinicio.
- **Terminado cuando:** CI detecta una regresión de stock, migración o concurrencia y todas las comprobaciones de calidad pasan. Ningún test escribe en producción.
- **Esfuerzo:** 1–2 días inicialmente; ampliar al implementar las tareas anteriores.

## P2 · Operación diaria, interfaz y mantenimiento

| Hecho | Pendiente y evidencia | Mejor solución y criterio de aceptación | Esfuerzo |
|---|---|---|---|
| [ ] | **Cambios de zona sin rastro.** Una ubicación con stock puede cambiar de zona sin movimiento ni registro administrativo (`lib/warehouse.ts:27`); reproducido en memoria. | Distinguir traslado físico y corrección administrativa. Exigir traslado para el primero; motivo y registro antes/después para la segunda. Todo cambio con existencias debe quedar explicado. | ½–1 día |
| [ ] | **Fechas imposibles.** El servidor acepta `2026-99-99` por validar solo el formato (`lib/warehouse.ts:36`); reproducido en memoria. | Validar fecha civil real, incluidos bisiestos, además del formato. Rechazar días y meses inexistentes en la API. | 1–2 horas |
| [ ] | **Archivar referencias, ubicaciones y tareas.** No hay estado de archivo (`lib/warehouse.ts:2-7,26-27,36`). | Archivo lógico y reactivación; conservar históricos e impedir archivar ubicaciones o referencias con stock. Los archivados dejan de aparecer en operaciones nuevas. | 1–2 días |
| [ ] | **Cierre con incidencias.** Solo admite cinco respuestas positivas (`lib/warehouse.ts:37`, `app/page.tsx:52`). | Separar revisión realizada de conformidad. Registrar incidencia, responsable, plazo y resolución. Poder declarar un pasillo bloqueado sin firmar falsamente un cierre conforme. | 2–3 días |
| [ ] | **Impresión de las casillas.** La regla de impresión oculta todos los botones y las casillas Radix son botones (`app/globals.css:108`, `components/ui/checkbox.tsx:14`). Hallazgo estático. | Representación imprimible explícita de casillas y estados, responsable y fecha. Verificar un PDF de cierre firmado y otro pendiente; ambos deben ser legibles y coherentes. | ½ día |
| [ ] | **Navegación y diálogos en móvil.** Cambiar sección no cierra el menú (`app/page.tsx:32`); el ancho impuesto al diálogo anula el margen previsto (`app/globals.css:106`). Pendiente verificación visual. | Cerrar menú al navegar y limitar el diálogo al ancho de pantalla con margen. Validar a 360/390 px, con teclado virtual y textos largos, sin perder acciones ni contenido. | ½–1 día |
| [ ] | **Accesibilidad.** La búsqueda elimina el contorno de foco; algunos textos pequeños tienen poco contraste (`app/globals.css:104,106`). | Foco visible, revisión de etiquetas en español y contraste. Recorrer formularios con teclado y lector; comprobar errores anunciados y texto normal con contraste suficiente. | ½–1 día |
| [ ] | **Selectores y límites útiles.** Se ofrecen destinos llenos o sin zona; el máximo de cantidad en UI no refleja disponibilidad (`app/page.tsx:60`). | Mostrar capacidad libre, filtrar o deshabilitar destinos inviables con explicación y buscar por SKU/código. Mantener todas las validaciones del servidor. | 1–2 días |
| [ ] | **Mensajes de filtros y resumen semanal.** Sin coincidencias se muestra el mensaje de catálogo vacío; el plan semanal usa las primeras cuatro tareas sin filtrar fechas (`app/page.tsx:47-50`). | Distinguir ausencia de datos y ausencia de resultados, permitir limpiar filtros y mostrar tareas de la semana/vencidas o cambiar el título. | ½ día |
| [ ] | **Consulta del historial.** Movimientos y cierres se cargan completos, sin rango temporal ni ficha imprimible de cierre (`app/page.tsx:50,52`). | Filtros de fechas, paginación en servidor, detalle de cierre y exportación del rango elegido. Consultar un mes sin cargar todos los años. Coordinar con tarea 3. | 1–3 días adicionales |

## Decisiones opcionales de producto

- [ ] **Varios usuarios:** añadir identidad real y permisos por función si van a operar varias personas. Los nombres escritos hoy no autentican a un operario. La API depende de la protección de Sites; no se ha observado una exposición pública. Si se cambia de alojamiento, verificar autenticación de las rutas y protección del origen antes de publicar.
- [ ] **Uso desde el almacén:** valorar escaneo de códigos y etiquetas, con un piloto en los dispositivos reales. No hace falta para el uso de oficina descrito.
- [ ] **Palets parciales, lotes y pedidos:** definir unidades, conversiones, trazabilidad y proceso de negocio antes de ampliar el modelo. Son cambios de alcance; el README excluye estas funciones expresamente.
- [ ] **Navegación y mantenimiento:** dividir `app/page.tsx` en módulos por flujo, tipar acciones y guardar sección/filtros en la URL. Añadir actualización al recuperar foco y fecha de última lectura si se usan varias pestañas o puestos. Evitar una reescritura completa sin necesidad.

El plano es una referencia del proyecto, no un mapa de existencias a escala. No se deben deducir capacidades ni posiciones reales de los símbolos del dibujo.

## Puesta en marcha del almacén real

- [ ] Crear las referencias con SKU único, familia, descripción y mínimo validado.
- [ ] Registrar los bloques físicos, asignar cartón o montaje/cajas, pasillo y capacidad comprobada en el almacén.
- [ ] Realizar recuento físico e introducir existencias iniciales con responsable y etiquetado confirmado.
- [ ] Sustituir responsables genéricos y fijar fechas reales de las tareas 5S.
- [ ] Acordar quién registra, quién revisa, cómo se resuelven discrepancias y quién recupera una copia.
- [ ] Ensayar un turno completo con entrada, traslado, salida y cierre; contrastar existencias físicas y registradas.

## Orden recomendado

1. Corregir confirmaciones, fechas y lint; establecer pruebas repetibles.
2. Diseñar juntos almacenamiento por tablas e idempotencia. Ensayar la recuperación antes de migrar y volver a verificarla después.
3. Añadir ajustes trazables, archivado e incidencias de cierre.
4. Corregir impresión, accesibilidad, móvil, filtros e historial.
5. Ejecutar el piloto con datos reales y decidir las ampliaciones según su resultado.

Conservar las reglas que ya funcionan: no permitir stock negativo, no mezclar referencias, respetar capacidad y mantener unidos el movimiento y su efecto en existencias.
