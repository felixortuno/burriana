# BURRIANA - GTR SOLUTIONS-

Aplicación privada de gestión del almacén para el ordenador de oficina.

## Primer uso

1. En **Inventario**, crea las referencias con un SKU único, descripción, familia y mínimo en palets.
2. En **Ubicaciones**, crea cada bloque físico (por ejemplo A-01), su pasillo y su capacidad validada. No hay un plano ni existencias ficticias.
3. En **Movimientos**, registra el inventario inicial como entradas, con responsable y comprobación del etiquetado.
4. Edita las tareas del **Plan 5S** para asignar nombres y fechas reales.
5. Cada día, completa **Cierre de turno** y registra el nombre de quien revisa. El día y la hora se calculan en Europe/Madrid.

## Alcance

- Catálogo editable, búsqueda, alerta por mínimo y exportación CSV compatible con Excel.
- Mapa esquemático por zonas, no un plano a escala. Una referencia por bloque.
- Entradas, salidas y traslados de palets completos; no gestiona palets parciales, lotes o unidades interiores.
- No permite stock negativo, exceder capacidad o mezclar referencias en un bloque ocupado.
- Salidas con albarán, responsable y confirmación de doble comprobación.
- Entrada y traslado con etiquetado confirmado; revisión adicional cuando se declara apilado a doble altura.
- Tareas 5S y checklist diario con nombre, fecha y hora. El nombre registrado no es una firma electrónica certificada.
- Protocolo y checklist imprimibles; descarga de datos en JSON. La copia JSON es un archivo de datos; no hay restauración desde la interfaz.

## Datos y acceso

La versión publicada necesita conexión a Internet. Los datos se guardan en la base de datos de la aplicación, no en el navegador ni únicamente en el ordenador. El acceso inicial es privado para la cuenta propietaria mediante Sites. No hay roles de operario: los nombres escritos en los formularios sirven para atribuir operaciones dentro del uso de oficina.

El estado se guarda como un documento JSON en D1 con revisión optimista y actualización atómica. El diseño está pensado para un almacén pequeño con uso desde oficina. Un conflicto entre pestañas se rechaza y recarga los datos, manteniendo el formulario. Un cambio de stock y su movimiento se guardan juntos. No hay borrado de movimientos desde la interfaz.

Los controles del sistema recogen las comprobaciones del equipo; la capacidad de las ubicaciones y la autorización física de apilado se deben establecer con los responsables del almacén.

## Desarrollo

Node 22.13 o superior. `npm ci`, `npm run dev`. El entorno de desarrollo usa una base de datos local separada de producción.

- `npm run db:generate`: generar migraciones tras cambios en `db/schema.ts`.
- `npm run build`: compilar Worker y configuración local.
- Aplicar las migraciones pendientes en orden con `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_wonderful_puppet_master.sql` para la primera instalación.
- `npx tsc --noEmit`: comprobación de tipos.
- `node --experimental-strip-types tests/warehouse.test.mjs`: reglas de inventario, atomicidad y cierre.

El despliegue se gestiona con Sites y mantiene la configuración en `.openai/hosting.json`. No subir archivos `.env`, la carpeta `.wrangler` ni datos locales.
