// Restore an app JSON backup. --check validates locally without accessing Postgres.
// node --experimental-strip-types --env-file=.env.local scripts/import-state.mjs copia.json [--check] [--force]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { applyAction, initialState, madridDay, normalizeState } from '../lib/warehouse.ts';
import { isWarehouseArea } from '../lib/areas.ts';
import { isValidCalendarDate, isValidTime, parseProduction, workOrderKinds, workOrderPriorities, workOrderStatuses } from '../lib/operations.ts';

const LEGACY_COLLECTIONS = ['products', 'locations', 'movements', 'tasks', 'closures'];
const COLLECTIONS = [...LEGACY_COLLECTIONS, 'workOrders'];
const fail = message => { throw new Error(message); };
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`«${label}» debe ser un objeto.`);
  return value;
}
function text(value, label, required = true, max = 180) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Revisa «${label}».`);
  return value;
}
function integer(value, label, min = 0, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`«${label}» debe ser un entero entre ${min} y ${max}.`);
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`«${label}» debe ser booleano.`);
}
function date(value, label) {
  if (typeof value !== 'string' || !isValidCalendarDate(value)) fail(`Fecha no válida en «${label}».`);
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value)
    || !isValidCalendarDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) fail(`Fecha y hora no válidas en «${label}».`);
}
function oneOf(value, values, label) {
  if (!values.includes(value)) fail(`Valor no válido en «${label}».`);
}
function unique(items, field, label, normalize = value => value) {
  const seen = new Set();
  for (const item of items) {
    object(item, label);
    const value = normalize(text(item[field], `${label}.${field}`));
    if (seen.has(value)) fail(`«${label}.${field}» contiene un valor repetido.`);
    seen.add(value);
  }
}
function code(value, label, optional = false) {
  text(value, label, !optional);
  if (value !== value.trim().toUpperCase()) fail(`«${label}» debe estar normalizado, sin espacios externos y en mayúsculas.`);
}

/** Accepts the app export and {revision,state} API backups; returns a detached full State. */
export function validateWarehouseBackup(file) {
  const envelope = object(file, 'copia');
  const backup = object(Object.hasOwn(envelope, 'state') ? envelope.state : envelope, 'estado');
  const extracted = {};
  for (const key of LEGACY_COLLECTIONS) {
    if (!Array.isArray(backup[key])) fail(`El archivo no tiene un array «${key}»; no parece una copia del almacén.`);
    extracted[key] = backup[key];
  }
  if (Object.hasOwn(backup, 'workOrders')) {
    if (!Array.isArray(backup.workOrders)) fail('«workOrders» debe ser un array.');
    extracted.workOrders = backup.workOrders;
  }
  if (Object.hasOwn(backup, 'shift')) {
    extracted.shift = object(backup.shift, 'shift');
    for (const field of ['startTime', 'endTime', 'lunchStart', 'lunchEnd', 'announcement']) {
      text(extracted.shift[field], `shift.${field}`, ['startTime', 'endTime'].includes(field), field === 'announcement' ? 1000 : 180);
    }
  }
  const state = structuredClone(normalizeState(extracted));
  for (const key of COLLECTIONS) unique(state[key], 'id', key);
  unique(state.products, 'sku', 'products', value => value.trim().toUpperCase());
  unique(state.locations, 'code', 'locations', value => value.trim().toUpperCase());

  const skus = new Set(state.products.map(product => product.sku));
  const locations = new Map(state.locations.map(location => [location.code, location]));
  const orders = new Map(state.workOrders.map(order => [order.id, order]));
  for (const product of state.products) {
    code(product.sku, 'products.sku');
    text(product.name, 'products.name');
    text(product.family, 'products.family');
    integer(product.minimum, 'products.minimum');
  }
  for (const location of state.locations) {
    code(location.code, 'locations.code');
    text(location.zone, 'locations.zone');
    if (location.area !== undefined && !isWarehouseArea(location.area)) fail('Área de ubicación no válida.');
    integer(location.capacity, 'locations.capacity', 1);
    integer(location.qty, 'locations.qty', 0, location.capacity);
    code(location.sku, 'locations.sku', true);
    if (location.qty === 0 ? location.sku !== '' : !skus.has(location.sku)) fail('El SKU de una ubicación no corresponde a sus existencias o al catálogo.');
  }
  for (const movement of state.movements) {
    timestamp(movement.date, 'movements.date');
    oneOf(movement.kind, ['entrada', 'salida', 'traslado', 'consumo', 'produccion'], 'movements.kind');
    if (!skus.has(movement.sku) || !locations.has(movement.location)) fail('Un movimiento referencia un SKU o bloque inexistente.');
    integer(movement.qty, 'movements.qty', 1);
    text(movement.operator, 'movements.operator');
    if (movement.actorId !== undefined) text(movement.actorId, 'movements.actorId');
    text(movement.document, 'movements.document', movement.kind === 'salida');
    text(movement.notes, 'movements.notes', false, 1000);
    boolean(movement.stacked, 'movements.stacked');
    if (movement.kind === 'traslado') {
      if (!locations.has(movement.destination) || movement.destination === movement.location) fail('Destino de traslado no válido.');
    } else if (movement.destination !== '') fail('Solo un traslado puede tener destino en su registro.');
    if (['salida', 'consumo'].includes(movement.kind) && movement.stacked) fail('Una salida o consumo no puede declarar apilado.');
    if (movement.workOrderId !== undefined && !orders.has(movement.workOrderId)) fail('Un movimiento referencia un trabajo inexistente.');
    if (['consumo', 'produccion'].includes(movement.kind) && !movement.workOrderId) fail('Consumo y producción deben estar vinculados a un viaje.');
  }
  for (const task of state.tasks) {
    for (const field of ['title', 'zone', 'owner']) text(task[field], `tasks.${field}`);
    text(task.due, 'tasks.due', false);
    if (task.due) date(task.due, 'tasks.due');
    boolean(task.done, 'tasks.done');
  }
  unique(state.closures, 'day', 'closures');
  for (const closure of state.closures) {
    date(closure.day, 'closures.day');
    timestamp(closure.date, 'closures.date');
    if (madridDay(new Date(closure.date)) !== closure.day) fail('El día de cierre no coincide con la fecha en Madrid.');
    text(closure.operator, 'closures.operator');
    if (closure.actorId !== undefined) text(closure.actorId, 'closures.actorId');
    text(closure.notes, 'closures.notes', false, 1000);
    if (!Array.isArray(closure.checks) || closure.checks.length !== 5 || !closure.checks.every(check => check === true)) fail('Un cierre debe conservar sus cinco comprobaciones.');
  }

  for (const order of state.workOrders) {
    oneOf(order.kind, workOrderKinds, 'workOrders.kind');
    oneOf(order.priority, workOrderPriorities, 'workOrders.priority');
    oneOf(order.status, workOrderStatuses, 'workOrders.status');
    text(order.title, 'workOrders.title');
    for (const field of ['reference', 'truck', 'assignedTo']) text(order[field], `workOrders.${field}`, false);
    text(order.instructions, 'workOrders.instructions', false, 1500);
    date(order.scheduledDate, 'workOrders.scheduledDate');
    text(order.scheduledTime, 'workOrders.scheduledTime', false);
    if (order.scheduledTime && !isValidTime(order.scheduledTime)) fail('Hora programada de trabajo no válida.');
    integer(order.repeatEveryDays, 'workOrders.repeatEveryDays', 0, 365);
    if (order.repeatEveryDays && !['mantenimiento', 'limpieza'].includes(order.kind)) fail('Repetición no válida para el tipo de trabajo.');
    for (const field of ['createdBy', 'updatedBy']) text(order[field], `workOrders.${field}`);
    for (const field of ['createdAt', 'updatedAt']) timestamp(order[field], `workOrders.${field}`);
    if (Date.parse(order.createdAt) > Date.parse(order.updatedAt)) fail('Un trabajo no puede actualizarse antes de crearse.');
    if (order.status === 'completada') {
      timestamp(order.completedAt, 'workOrders.completedAt');
      if (order.completedAt !== order.updatedAt) fail('La finalización debe coincidir con la última actualización del trabajo.');
    } else if (order.completedAt !== null) fail('Un trabajo no completado no puede tener fecha de finalización.');
    for (const field of ['previousOrderId', 'nextOrderId']) {
      if (order[field] !== null && (!orders.has(order[field]) || order[field] === order.id)) fail(`Enlace de repetición «${field}» no válido.`);
    }
    if (order.previousOrderId && orders.get(order.previousOrderId).nextOrderId !== order.id) fail('Los enlaces de repetición no son recíprocos.');
    if (order.nextOrderId) {
      if (order.status !== 'completada' || !order.repeatEveryDays || orders.get(order.nextOrderId).previousOrderId !== order.id) fail('El siguiente trabajo no corresponde a una repetición completada.');
    } else if (order.status === 'completada' && order.repeatEveryDays) fail('Falta la siguiente repetición del trabajo completado.');
    if (!Array.isArray(order.events) || !order.events.length) fail('Falta el historial del trabajo.');
    unique(order.events, 'id', 'workOrders.events');
    let previousTime = Date.parse(order.createdAt);
    for (const event of order.events) {
      oneOf(event.kind, ['created', 'updated', 'status'], 'events.kind');
      oneOf(event.status, workOrderStatuses, 'events.status');
      timestamp(event.date, 'events.date');
      if (Date.parse(event.date) < previousTime) fail('El historial del trabajo no está ordenado por fecha.');
      previousTime = Date.parse(event.date);
      text(event.actorId, 'events.actorId');
      text(event.actorName, 'events.actorName');
    }
    const first = order.events[0];
    const last = order.events.at(-1);
    if (first.kind !== 'created' || first.status !== 'pendiente' || first.date !== order.createdAt || first.actorId !== order.createdBy
      || last.date !== order.updatedAt || last.actorId !== order.updatedBy || last.status !== order.status) fail('La autoría o el estado del trabajo no coincide con su historial.');
    if (order.production !== undefined) {
      if (order.kind !== 'viaje') fail('Solo un viaje admite datos de producción.');
      if (!isDeepStrictEqual(order.production, parseProduction(order.production))) fail('Los datos de producción deben estar normalizados.');
    }
    const linked = state.movements.filter(movement => movement.workOrderId === order.id);
    if (order.kind === 'viaje' && order.status === 'completada') {
      const production = parseProduction(order.production);
      const consumed = linked.find(movement => movement.kind === 'consumo');
      const produced = linked.find(movement => movement.kind === 'produccion');
      if (linked.length !== 2 || !consumed || !produced
        || consumed.sku !== production.inputSku || consumed.location !== production.inputLocation || consumed.qty !== production.inputPallets
        || produced.sku !== production.outputSku || produced.location !== production.outputLocation || produced.qty !== production.outputPallets
        || consumed.date !== order.completedAt || produced.date !== order.completedAt) fail('El viaje completado no coincide con sus movimientos de consumo y producción.');
    } else if (linked.length) fail('Solo un viaje completado puede tener movimientos de producción vinculados.');
  }
  const checkedLinks = new Set();
  for (const order of state.workOrders) {
    const chain = new Set();
    let current = order;
    while (current && !checkedLinks.has(current.id)) {
      if (chain.has(current.id)) fail('Las repeticiones de trabajo contienen un ciclo.');
      chain.add(current.id);
      current = current.nextOrderId ? orders.get(current.nextOrderId) : undefined;
    }
    for (const id of chain) checkedLinks.add(id);
  }
  // Reuse the actual shift rules instead of maintaining a second schedule contract.
  state.shift = applyAction(initialState(), { ...state.shift, type: 'shift' }).shift;
  return state;
}

export async function readWarehouseBackup(path) {
  let file;
  try { file = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('El archivo no contiene JSON válido.');
    throw error;
  }
  return validateWarehouseBackup(file);
}

/** Initial suggested tasks are not real work; customized tasks/settings are protected. */
export function hasWarehouseData(currentState) {
  const state = normalizeState(currentState);
  const empty = initialState();
  return COLLECTIONS.some(key => key !== 'tasks' && state[key].length > 0)
    || !isDeepStrictEqual(state.tasks, empty.tasks)
    || !isDeepStrictEqual(state.shift, empty.shift);
}

const summary = state => COLLECTIONS.map(key => `${state[key].length} ${key}`).join(', ');

async function databaseOperation(operation) {
  try { return await operation(); }
  catch { throw new Error('No se ha podido acceder a la base. Revisa la conexión y sus permisos; no se muestran detalles privados.'); }
}

export async function runImport(args, options = {}) {
  const unknownFlag = args.find(argument => argument.startsWith('--') && !['--force', '--check'].includes(argument));
  const paths = args.filter(argument => !argument.startsWith('--'));
  if (unknownFlag || paths.length !== 1) fail('Uso: scripts/import-state.mjs copia.json [--check] [--force]');
  const state = await readWarehouseBackup(paths[0]);
  const log = options.log ?? console.log;
  if (args.includes('--check')) {
    log(`Copia válida, sin acceder a la base: ${summary(state)}. Turno y almuerzo incluidos.`);
    return { checked: true, state };
  }
  const createStore = options.createStore ?? (async () => {
    const { getPostgresWarehouseStore } = await import('../db/supabase-warehouse.ts');
    return getPostgresWarehouseStore();
  });
  const store = await databaseOperation(createStore);
  const current = await databaseOperation(() => store.read());
  if (hasWarehouseData(current.state) && !args.includes('--force')) {
    fail(`La base ya tiene datos, tareas personalizadas o configuración de turno (revisión ${current.revision}). Se necesita --force para sustituir el estado completo.`);
  }
  if (!await databaseOperation(() => store.write(current.revision, state))) fail('Otro cambio se guardó durante la importación. Vuelve a intentarlo.');
  const after = await databaseOperation(() => store.read());
  log(`Importado. Revisión ${after.revision}: ${summary(after.state)}. Turno y almuerzo incluidos.`);
  return after;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runImport(process.argv.slice(2));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se ha podido importar la copia.');
    process.exit(1);
  }
}
