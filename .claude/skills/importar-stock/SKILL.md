---
name: importar-stock
description: Importa stock de planchas y cajas desde un CSV o Excel a la app de almacén (stock inicial, recuentos o regularizaciones). Úsala siempre que haya que cargar o actualizar cantidades de stock a partir de un fichero.
---

# Importar stock de planchas y cajas

Procedimiento para cargar cantidades de stock en la app desde un fichero. El objetivo es que ninguna importación duplique modelos, mezcle unidades o meta cifras dudosas sin que nadie las haya revisado.

## Formato de entrada esperado

CSV en UTF-8, separador `,`, decimales con **punto**. Una fila por modelo y tipo.

| Columna | Obligatoria | Descripción |
|---|---|---|
| `tipo` | sí | `plancha` o `caja` |
| `codigo_modelo` | sí | Clave del modelo, p. ej. `COLUMNA-NEGRA-60x40x18` |
| `nombre_modelo` | sí | Nombre común (el de la caja) |
| `nombre_original` | no | Nombre tal como aparecía en el origen (cuaderno, hoja…) |
| `largo`, `ancho`, `alto` | sí | En cm, numéricos. También valen `largo_cm`, `ancho_cm`, `alto_cm` |
| `alto_secundario_cm` | no | Segundo alto de algunos modelos (p. ej. Tango 16/12) |
| `medida` | no | Texto `LxAxH`, o `LxAxH/S` si hay alto secundario; debe coincidir con las columnas anteriores |
| `cantidad` | sí | **Palets**, ≥ 0, en cuartos (`6.75`, `22.5`); la app no admite otros decimales |
| `revisar` | no | `si` / `no` |
| `nota` | no | Comentario libre |

Otras columnas (como `confianza_relacion`) se ignoran.

Si llega un `.xlsx`, léelo con la skill **xlsx**, trabaja con la hoja de detalle de stock (no con hojas de resumen ni totales) y expórtala a CSV antes de seguir.

## Convenciones del catálogo

- **Un modelo físico = un `codigo_modelo`**, compartido por su plancha y su caja en el fichero. La plancha y la caja del mismo modelo son dos filas distintas (`tipo` diferente) con el mismo código.
- **En la app son dos referencias**: `sku` = `codigo_modelo` en mayúsculas + `-PL` (plancha) o `-CJ` (caja), p. ej. `BIEDRONKA-40X30X23-PL`. `name` = `<nombre_modelo> <medida> (plancha|caja)`; `family` = `Planchas` o `Cajas`. Las cajas nuevas se crean con stock mínimo 26; las planchas, con 0.
- **Nombre común = nombre de la caja** (indica el tipo: Columna, Plaform, Cubito…). Si un modelo solo existe como plancha, se usa el nombre de la plancha.
- **Formato del código**: `NOMBRE-EN-MAYUSCULAS-LxAxH`, sin tildes ni espacios. Expresión regular:
  `^[A-Z0-9]+(-[A-Z0-9]+)*-\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$`
- **La clave única es `codigo_modelo` + `tipo`** (en la app, el `sku`), nunca solo el nombre: el mismo nombre ("Negra") existe con varias medidas.

## Procedimiento

El script `npm run importar-stock -- fichero.csv` hace los pasos 2 a 7. Sin `--escribir` es un ensayo: no escribe nada.

### 1. Conocer el esquema de la app
Antes de tocar datos, revisa la sección «Esquema de la app» de abajo y compruébala contra el código si algo no encaja.

### 2. Validar el fichero (sin escribir nada)
Para todo el fichero:
- Codificación UTF-8 y separador `,`. Un separador `;` → para y avisa.
- **Decimales con coma** (`6,75`) → para y avisa: probablemente alguien lo abrió y guardó con un Excel en español. No conviertas a ciegas.

Fila a fila:
- `tipo` ∈ {`plancha`, `caja`}.
- `codigo_modelo` cumple la expresión regular y su medida coincide con `largo`/`ancho`/`alto` (y `medida`, si viene).
- Dimensiones numéricas > 0; `cantidad` numérica ≥ 0 y en cuartos de palet.
- Duplicados de (`codigo_modelo`, `tipo`) → **no los sumes**; lístalos y pregunta.
- Mismo `codigo_modelo` con `nombre_modelo` distinto entre plancha y caja → lístalo y pregunta.

### 3. Separar filas dudosas
Las filas con `revisar=si` **no se importan**. Lístalas con su `nota` para que el usuario las confirme a mano y se carguen después.

### 4. Confirmar la unidad
La app guarda palets. Si el fichero puede venir en otra unidad (cajas sueltas, filas de cajas…), pregúntalo antes: un palet lleva 5 cajas por capa y 10 u 11 capas. No guardes un número sin saber qué cuenta.

### 5. Enseñar el plan y esperar confirmación
Antes de escribir, muestra:
- El mapeo columna del CSV → campo de la app, y las columnas que se descartan (`revisar`, `nota`, `medida`, `confianza_relacion`).
- Nº de filas a importar, excluidas (con motivo) y con error.
- Modelos nuevos que se van a crear vs. modelos que ya existen.
- Totales por tipo (suma de `cantidad` de planchas y de cajas) de las filas que se van a importar.
- Si el modelo ya tiene stock: si se **sustituye** (recuento, `--modo=sustituir`, por defecto) o se **suma** (entrada, `--modo=sumar`). En un stock inicial o recuento se sustituye; pregunta si no está claro.
- Las referencias repartidas en varios bloques: el script no las toca y hay que corregirlas a mano en Ajustes > Inventario.

No continúes hasta que el usuario lo confirme.

### 6. Importar
- `npm run importar-stock -- fichero.csv --fecha=AAAA-MM-DD --escribir`. La fecha es la del recuento (por defecto, hoy).
- Todo va en **una escritura** del documento del almacén, comprobando la revisión: si falla algo o alguien guarda a la vez, no queda nada a medias.
- El stock vive en **bloques**: se usa el bloque que ya tiene esa referencia; si no tiene, se crea uno nuevo (`CAR-nn` para planchas en la zona `carton`, `CAJ-nn` para cajas en `montaje`).
- Trazabilidad: el stock que entra en un bloque vacío se registra como movimiento `entrada` con documento `INV-<fecha>`; un recuento que cambia lo que había se registra como `ajuste` (guarda el antes y el después). En ambos casos la nota lleva el nombre del fichero, el `nombre_original` y la `nota`.
- Crea los modelos nuevos con el `codigo_modelo` y `nombre_modelo` del fichero; no inventes códigos.
- No modifiques el fichero de origen.

### 7. Verificar
El script vuelve a leer la base y comprueba que:
- El stock de cada referencia del fichero coincide con el del paso 5.
- Ningún `sku` aparece duplicado.

Si algo no cuadra, dilo claramente con las cifras de ambos lados.

### 8. Informe final
Resume en pocas líneas: filas importadas, modelos creados, totales por tipo, y la lista de filas pendientes de revisar.

## Esquema de la app

- Stack / base de datos: Next.js 16 (App Router) en Vercel, con Supabase Postgres. Todo el almacén es **un único documento JSON**: tabla `public.warehouse`, fila `id = 1`, columnas `revision` (entero) y `data` (jsonb), definida en `db/postgres-warehouse.ts`. Cada escritura comprueba `revision` (concurrencia optimista). Los cambios se aplican con `applyAction` de `lib/warehouse.ts`. En local, si existe `WAREHOUSE_LOCAL_DATA_DIR`, se usa un archivo JSON en lugar de Postgres.
- Tabla de modelos: no hay tabla; es el array `data.products` (campos: `id`, `sku`, `name`, `family`, `minimum`, `boxesPerPallet` opcional). Plancha y caja son **dos referencias**: `sku` = `codigo_modelo` en mayúsculas + `-PL` o `-CJ` (p. ej. `BIEDRONKA-40X30X23-PL`); `family` = `Planchas` o `Cajas`; `name` = `<nombre_modelo> <medida> (plancha|caja)`.
- Tabla de stock: no hay tabla por modelo; el stock vive en bloques, array `data.locations` (campos: `id`, `code`, `zone`, `area` = `carton` | `montaje`, `capacity`, `sku`, `qty`). Un bloque contiene una sola referencia; el stock de una referencia es la suma de `qty` de sus bloques. Planchas en `carton` (bloques `CAR-nn`), cajas en `montaje` (bloques `CAJ-nn`).
- Tabla de movimientos: array `data.movements` (campos: `id`, `date`, `kind`, `sku`, `qty`, `location`, `destination`, `operator`, `document`, `notes`, `stacked`, `workOrderId` opcional, `actorId` opcional). Tipos válidos: `entrada`, `salida`, `traslado`, `consumo`, `produccion`, `ajuste`. No existe un tipo «inventario inicial»: el del 30/09/2026 se cargó como `entrada` con `document` = `INV-INICIAL-2026-09-30`.
- Unidad en que se guarda el stock: palets, en cuartos (0,25; p. ej. 22,5 o 6,75). Confirmado: la `cantidad` de los ficheros son palets.
- Comando o script para ejecutar la importación: `npm run importar-stock -- fichero.csv [--modo=sustituir|sumar] [--fecha=AAAA-MM-DD] [--escribir]` (`scripts/importar-stock.mjs`, tests en `tests/importar-stock.test.mjs`). Para restaurar una copia JSON completa existe aparte `scripts/import-state.mjs`.
