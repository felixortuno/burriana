// Imports planchas and cajas stock from a CSV, following .claude/skills/importar-stock.
// A dry run by default: validates, sets aside doubtful rows and prints the plan.
// --escribir applies every row in a single write, checked against the live revision.
// node --experimental-strip-types --env-file=.env.local scripts/importar-stock.mjs fichero.csv [--modo=sustituir|sumar] [--fecha=AAAA-MM-DD] [--escribir]
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyAction } from '../lib/warehouse.ts';
import { CAJA_MINIMUM, stockBySku } from '../lib/warehouse-insights.ts';

const CODE = /^[A-Z0-9]+(-[A-Z0-9]+)*-\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/;
const KINDS = {
  plancha: { suffix: 'PL', family: 'Planchas', area: 'carton', prefix: 'CAR', minimum: 0 },
  caja: { suffix: 'CJ', family: 'Cajas', area: 'montaje', prefix: 'CAJ', minimum: CAJA_MINIMUM },
};
const fail = message => { throw new Error(message); };
const columnFor = (header, name) => [name, `${name}_cm`].find(candidate => header.includes(candidate));

export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const lines = rows.map((cells, index) => ({ cells, line: index + 1 })).filter(({ cells }) => cells.some(cell => cell.trim()));
  if (!lines.length) fail('El fichero está vacío.');
  const header = lines[0].cells.map(cell => cell.trim());
  return { header, records: lines.slice(1).map(({ cells, line }) => ({ line, width: cells.length, ...Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? '').trim()])) })) };
}

/** Steps 2 and 3 of the skill: errors stop the import; doubtful rows are set aside. */
export function validateStockFile(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('El fichero no está en UTF-8. Guárdalo como «CSV UTF-8» y vuelve a probar.'); }
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  if (!firstLine.includes(',') && firstLine.includes(';')) fail('El separador es «;». Probablemente se guardó con Excel en español; expórtalo con comas.');
  const { header, records } = parseCsv(text);
  const columns = { largo: columnFor(header, 'largo'), ancho: columnFor(header, 'ancho'), alto: columnFor(header, 'alto') };
  const missing = ['tipo', 'codigo_modelo', 'nombre_modelo', 'cantidad'].filter(name => !header.includes(name)).concat(Object.entries(columns).filter(([, value]) => !value).map(([name]) => name));
  if (missing.length) fail(`Faltan columnas obligatorias: ${missing.join(', ')}.`);
  const numeric = [columns.largo, columns.ancho, columns.alto, 'cantidad'];
  const commas = records.flatMap(record => numeric.filter(name => /\d,\d/.test(record[name])).map(name => `fila ${record.line}, ${name}: «${record[name]}»`));
  if (commas.length) fail(`Hay decimales con coma (${commas.join('; ')}). Probablemente se abrió y guardó con Excel en español; no se convierte a ciegas.`);

  const errors = [], warnings = [], seen = new Map();
  const rows = [];
  for (const record of records) {
    const where = `fila ${record.line} (${record.codigo_modelo || 'sin código'}, ${record.tipo || 'sin tipo'})`;
    const before = errors.length;
    if (record.width !== header.length) errors.push(`${where}: tiene ${record.width} columnas y la cabecera ${header.length}.`);
    if (!KINDS[record.tipo]) errors.push(`${where}: el tipo debe ser «plancha» o «caja».`);
    if (!CODE.test(record.codigo_modelo)) errors.push(`${where}: el código no sigue el formato NOMBRE-LxAxH.`);
    const dims = [columns.largo, columns.ancho, columns.alto].map(name => Number(record[name]));
    if (dims.some(value => !Number.isFinite(value) || value <= 0)) errors.push(`${where}: las dimensiones deben ser números mayores que 0.`);
    const fromCode = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(record.codigo_modelo)?.slice(1).map(Number);
    if (fromCode && fromCode.join('x') !== dims.join('x')) errors.push(`${where}: el código dice ${fromCode.join('x')} y las columnas ${dims.join('x')}.`);
    const measure = dims.join('x');
    // A second height (16/12) is how some models are written; it is not a mismatch.
    if (record.medida && record.medida !== measure && record.medida !== `${measure}/${record.alto_secundario_cm || record.alto_secundario}`) errors.push(`${where}: la medida «${record.medida}» no coincide con ${measure}.`);
    const qty = Number(record.cantidad);
    if (record.cantidad === '' || !Number.isFinite(qty) || qty < 0) errors.push(`${where}: la cantidad «${record.cantidad}» no es un número mayor o igual que 0.`);
    else if (!Number.isInteger(qty * 4)) errors.push(`${where}: la app guarda palets en cuartos; ${qty} no lo es.`);
    const key = `${record.codigo_modelo}|${record.tipo}`;
    if (seen.has(key)) errors.push(`${where}: repetida con la fila ${seen.get(key)}. No se suman: decide cuál vale.`);
    else seen.set(key, record.line);
    if (errors.length === before) rows.push({ ...record, qty, measure: record.medida || measure });
  }
  const byCode = new Map();
  for (const row of rows) byCode.set(row.codigo_modelo, [...(byCode.get(row.codigo_modelo) ?? []), row]);
  for (const [code, list] of byCode) {
    if (new Set(list.map(row => row.nombre_modelo)).size > 1) errors.push(`${code}: la plancha y la caja tienen nombres distintos (${list.map(row => `${row.tipo} «${row.nombre_modelo}»`).join(', ')}).`);
  }
  const excluded = rows.filter(row => row.revisar === 'si');
  return { header, rows: rows.filter(row => row.revisar !== 'si'), excluded, errors, warnings };
}

const skuOf = row => `${row.codigo_modelo.toUpperCase()}-${KINDS[row.tipo].suffix}`;
const nameOf = row => `${row.nombre_modelo} ${row.measure} (${row.tipo})`;

/** Step 5: what happens to each row against the live state. */
export function planStockImport(state, rows, mode = 'sustituir') {
  if (!['sustituir', 'sumar'].includes(mode)) fail('El modo debe ser «sustituir» (recuento o stock inicial) o «sumar» (entrada).');
  const stock = stockBySku(state);
  const used = { CAR: 0, CAJ: 0 };
  for (const location of state.locations) {
    const match = /^(CAR|CAJ)-(\d+)$/.exec(location.code);
    if (match) used[match[1]] = Math.max(used[match[1]], Number(match[2]));
  }
  const zoneOf = area => {
    const counts = new Map();
    for (const location of state.locations) if (location.area === area) counts.set(location.zone, (counts.get(location.zone) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Pendiente de ubicar';
  };
  const newBlock = (kind, qty) => ({ code: `${kind.prefix}-${String(++used[kind.prefix]).padStart(2, '0')}`, zone: zoneOf(kind.area), area: kind.area, capacity: Math.max(1, Math.ceil(qty * 1.25)) });
  const steps = [], problems = [];
  for (const row of rows) {
    const kind = KINDS[row.tipo], sku = skuOf(row);
    const product = state.products.find(item => item.sku === sku);
    const blocks = state.locations.filter(location => location.sku === sku && location.qty > 0);
    const current = stock.get(sku) ?? 0;
    const step = { row, sku, kind, createProduct: !product, current, target: mode === 'sustituir' ? row.qty : current + row.qty, action: 'nada', block: null };
    if (mode === 'sustituir') {
      if (current === row.qty) step.action = product ? 'sin cambios' : 'nada';
      else if (blocks.length > 1) { problems.push(`${sku}: está repartida en ${blocks.length} bloques (${blocks.map(b => `${b.code}=${b.qty}`).join(', ')}); corrígela a mano en Ajustes > Inventario.`); continue; }
      else if (blocks.length === 1) Object.assign(step, { action: 'ajuste', block: { ...blocks[0], newBlock: false } });
      else Object.assign(step, { action: 'entrada', block: { ...newBlock(kind, row.qty), newBlock: true } });
    } else if (row.qty > 0) {
      const roomy = blocks.find(location => location.capacity - location.qty >= row.qty);
      if (roomy) Object.assign(step, { action: 'entrada', block: { ...roomy, newBlock: false } });
      else if (blocks.length) { problems.push(`${sku}: no cabe en ${blocks.map(b => b.code).join(', ')}; amplía la capacidad o crea un bloque.`); continue; }
      else Object.assign(step, { action: 'entrada', block: { ...newBlock(kind, row.qty), newBlock: true } });
    }
    steps.push(step);
  }
  return { mode, steps, problems };
}

/** Step 6: every row through the app's own rules, in memory, so one write commits all or nothing. */
export function applyStockImport(state, plan, { file, date, now = new Date() }) {
  const actor = { id: 'importacion', name: `Importación ${file}`, role: 'administrador' };
  let next = state;
  for (const step of plan.steps) {
    const { row, sku, kind } = step;
    if (step.createProduct) next = applyAction(next, { type: 'product', sku, name: nameOf(row), family: kind.family, minimum: kind.minimum }, now, actor);
    if (step.action === 'nada' || step.action === 'sin cambios') continue;
    const origin = [row.nombre_original && `Nombre en origen: ${row.nombre_original}.`, row.nota && `Nota: ${row.nota}.`].filter(Boolean).join(' ');
    if (step.block.newBlock) next = applyAction(next, { type: 'location', code: step.block.code, zone: step.block.zone, area: step.block.area, capacity: step.block.capacity }, now, actor);
    if (step.action === 'entrada') {
      const location = next.locations.find(item => item.code === step.block.code);
      if (location.qty + row.qty > location.capacity) next = applyAction(next, { type: 'location', id: location.id, code: location.code, zone: location.zone, area: location.area, capacity: Math.ceil(location.qty + row.qty) }, now, actor);
      next = applyAction(next, { type: 'movement', kind: 'entrada', sku, qty: row.qty, location: step.block.code, document: `INV-${date}`, notes: `Importación de ${file} (${date}). ${origin}`.trim(), labelled: true }, now, actor);
    } else {
      next = applyAction(next, { type: 'adjust', location: step.block.code, sku, qty: row.qty, capacity: Math.max(step.block.capacity, Math.ceil(row.qty)), reason: `Recuento de ${file} (${date}). ${origin}`.trim() }, now, actor);
    }
  }
  return next;
}

/** Step 7: the stored stock must match the plan, and no reference may appear twice. */
export function verifyStockImport(state, plan) {
  const stock = stockBySku(state);
  const problems = plan.steps.filter(step => (stock.get(step.sku) ?? 0) !== step.target).map(step => `${step.sku}: esperado ${step.target}, guardado ${stock.get(step.sku) ?? 0}`);
  const skus = state.products.map(product => product.sku);
  if (new Set(skus).size !== skus.length) problems.push('Hay referencias repetidas en el catálogo.');
  return problems;
}

const sum = (list, tipo, pick) => list.filter(item => (item.row ?? item).tipo === tipo).reduce((n, item) => n + pick(item), 0);
const pallets = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);

export async function runStockImport(args, options = {}) {
  const log = options.log ?? console.log;
  const flags = Object.fromEntries(args.filter(arg => arg.startsWith('--')).map(arg => { const [key, value = 'true'] = arg.slice(2).split('='); return [key, value]; }));
  const unknown = Object.keys(flags).filter(key => !['modo', 'fecha', 'escribir'].includes(key));
  const paths = args.filter(arg => !arg.startsWith('--'));
  if (unknown.length || paths.length !== 1) fail('Uso: scripts/importar-stock.mjs fichero.csv [--modo=sustituir|sumar] [--fecha=AAAA-MM-DD] [--escribir]');
  const date = flags.fecha ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('La fecha debe ir como AAAA-MM-DD.');
  const file = basename(paths[0]);
  const checked = validateStockFile(await (options.readFile ?? readFile)(paths[0]));

  log(`Fichero ${file}: UTF-8, separador «,», ${checked.rows.length + checked.excluded.length} filas válidas.`);
  log(`Mapeo: tipo+codigo_modelo → sku (CODIGO-PL / CODIGO-CJ), nombre_modelo+medida → nombre, cantidad → palets del bloque. Se descartan: revisar, nota y columnas no reconocidas (${checked.header.filter(name => !['tipo', 'codigo_modelo', 'nombre_modelo', 'cantidad', 'medida', 'nombre_original', 'revisar', 'nota'].includes(name) && !/^(largo|ancho|alto)(_cm)?$/.test(name)).join(', ') || 'ninguna'}).`);
  for (const warning of checked.warnings) log(`Aviso: ${warning}`);
  if (checked.errors.length) { checked.errors.forEach(error => log(`Error: ${error}`)); fail(`El fichero tiene ${checked.errors.length} errores. No se importa nada.`); }
  if (checked.excluded.length) {
    log(`Quedan fuera ${checked.excluded.length} filas marcadas para revisar:`);
    checked.excluded.forEach(row => log(`  fila ${row.line}: ${row.codigo_modelo} (${row.tipo}), ${pallets(row.qty)} palets. ${row.nota}`));
  }

  const store = await (options.createStore ?? (async () => (await import('../db/supabase-warehouse.ts')).getPostgresWarehouseStore()))();
  const { revision, state } = await store.read();
  const plan = planStockImport(state, checked.rows, flags.modo ?? 'sustituir');
  const count = action => plan.steps.filter(step => step.action === action).length;
  log(`Plan (${plan.mode}, revisión ${revision}): ${plan.steps.filter(step => step.createProduct).length} modelos nuevos, ${plan.steps.filter(step => !step.createProduct).length} existentes; ${count('entrada')} entradas, ${count('ajuste')} ajustes, ${count('sin cambios')} sin cambios.`);
  log(`Totales a importar: planchas ${pallets(sum(checked.rows, 'plancha', row => row.qty))} palets, cajas ${pallets(sum(checked.rows, 'caja', row => row.qty))} palets.`);
  plan.steps.filter(step => step.action === 'entrada' || step.action === 'ajuste').forEach(step => log(`  ${step.action} ${step.sku} en ${step.block.code}${step.block.newBlock ? ' (bloque nuevo)' : ''}: ${pallets(step.current)} → ${pallets(step.target)}`));
  plan.problems.forEach(problem => log(`Pendiente: ${problem}`));
  if (flags.escribir !== 'true') { log('Ensayo: no se ha escrito nada. Añade --escribir para importar.'); return { written: false, plan, checked }; }
  if (plan.problems.length) fail('Resuelve antes los pendientes; no se ha escrito nada.');

  const next = applyStockImport(state, plan, { file, date, now: options.now ?? new Date(`${date}T12:00:00Z`) });
  if (!await store.write(revision, next)) fail('Otro cambio se guardó durante la importación. No se ha escrito nada; vuelve a lanzarla.');
  const after = await store.read();
  const problems = verifyStockImport(after.state, plan);
  if (problems.length) fail(`Lo guardado no cuadra con el plan: ${problems.join('; ')}`);
  log(`Importado. Revisión ${after.revision}. Planchas ${pallets(sum(plan.steps, 'plancha', step => step.target))} palets y cajas ${pallets(sum(plan.steps, 'caja', step => step.target))} en las referencias del fichero; sin referencias repetidas.`);
  return { written: true, plan, checked, revision: after.revision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runStockImport(process.argv.slice(2)); process.exit(0); }
  catch (error) { console.error(error instanceof Error ? error.message : 'No se ha podido importar el stock.'); process.exit(1); }
}
