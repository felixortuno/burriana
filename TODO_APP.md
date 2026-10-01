# Puesta en marcha y siguientes fases

Actualizado el 1 de octubre de 2026. Alcance confirmado: administrador, encargado y pantalla; solo el encargado o administrador registra avances en la primera fase. Viajes = planchas a cajas. Unidad = palets completos.

## Implementado localmente

- Dashboard de actividad y stock; organización de viajes, pedidos, cargas, descargas, mantenimiento y limpieza.
- Pantalla de lectura con almuerzo, hora de Madrid, avisos, trabajo destacado y listas rotatorias.
- Identidad individual y permisos en servidor; alta/desactivación por administrador y revocación de sesiones.
- Producción atómica de viajes, historial, protección de cierre repetido y recurrencia de tareas.
- Sincronización automática y rechazo de revisiones antiguas; inventario conserva todos los campos nuevos.
- Copia con versión de formato, importador que conserva órdenes/turno y modo de validación sin DB.
- Datos locales de desarrollo explícitos, separados de Supabase; modo rechazado en producción.

## Antes de introducir inventario real

1. Ensayar la versión y el esquema de usuarios en Postgres aislado: permisos de tabla, concurrencia entre sesiones, caída de conexión y recuperación.
2. Definir y probar copia/restauración de ambas tablas, retención y responsable. El JSON de la UI no incluye usuarios.
3. Completar idempotencia general para entradas/salidas, altas y nuevas órdenes. El cierre de un viaje ya evita doble producción, pero una respuesta perdida puede duplicar un movimiento manual reintentado con revisión nueva.
4. Definir recuentos, ajustes y correcciones con motivo y trazabilidad. Hoy no hay formulario de ajuste/merma o reversión de viaje.
5. Reunir SKU de planchas/cajas, bloques, áreas, capacidades validadas, mínimos y recuento físico. Conciliar antes del primer turno.
6. Crear usuarios reales y acceso exclusivo de pantalla; fijar horarios/almuerzo. Probar TV, conexión, zoom y distancia de lectura en la nave.
7. Validar y desplegar. No configurar `WAREHOUSE_LOCAL_DATA_DIR` en producción ni importar la demostración local.

## Ampliaciones después del primer piloto

- Pedidos con líneas y palets previstos, reservas, preparación parcial y vínculo entre camiones/albaranes y movimientos. Actualmente los trabajos de muelle y su stock se cierran por separado.
- Tablets en columnas: interfaz de operario, identificación, permisos acotados y confirmaciones sin acceso administrativo.
- Sesión de kiosco renovable y revocable para la pantalla. Hoy vuelve al login a las ocho horas.
- Edición/cambio de contraseña de usuarios desde la UI (la API administrativa ya existe), recuperación y protección distribuida de login.
- Registro detallado de cambios de catálogo, capacidades y horarios; conservar comprobaciones de seguridad como evidencia y enlazar asignaciones a personas/equipos.
- KPI acordados: tiempos efectivos, retrasos, rendimiento por máquina y productividad. El dashboard actual muestra actividad y stock, no OEE.
- Medir crecimiento del JSON e histórico y, cuando lo justifique el volumen, normalizar tablas, paginar consultas y mejorar actualización entre puestos.
- Unificar o retirar el plan 5S heredado para evitar duplicidad con las órdenes de mantenimiento/limpieza.
- Ensayar OCR con etiquetas reales, ajustar tamaño/compresión a la plataforma y cancelar respuestas tardías al cerrar formularios. No es necesario para introducir referencias manualmente.

Consulta [la guía técnica y operativa](docs/BACKEND_Y_PUESTA_EN_MARCHA.md) para contratos, limitaciones y procedimiento de carga inicial.
