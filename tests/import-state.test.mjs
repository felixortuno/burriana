import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyAction, initialState } from '../lib/warehouse.ts';
import { hasWarehouseData, readWarehouseBackup, runImport, validateWarehouseBackup } from '../scripts/import-state.mjs';

const actor = { id: 'encargado-prueba', name: 'Encargado de prueba' };
const now = new Date('2026-10-01T08:00:00.000Z');
const apply = (state, action) => applyAction(state, action, now, actor);
const orderAction = extra => ({
  type: 'workOrder', kind: 'limpieza', title: 'Limpiar zona de montaje',
  reference: '', truck: '', assignedTo: 'Equipo', instructions: 'Revisar pasillo',
  scheduledDate: '2026-10-01', scheduledTime: '14:30', priority: 'normal', repeatEveryDays: 1,
  ...extra,
});
function fixture() {
  let state = initialState();
  for (const sku of ['PLANCHA', 'CAJA']) state = apply(state, { type: 'product', sku, name: sku, family: 'Cartón', minimum: 1 });
  for (const [code, area] of [['CAR-01', 'carton'], ['CAJ-01', 'montaje']]) state = apply(state, { type: 'location', code, area, zone: 'A', capacity: 10 });
  state = apply(state, { type: 'movement', kind: 'entrada', sku: 'PLANCHA', qty: 2, location: 'CAR-01', operator: 'Legacy', labelled: true });
  state = apply(state, orderAction({ kind: 'viaje', title: 'Fabricar cajas', repeatEveryDays: 0, production: {
    inputSku: 'PLANCHA', inputLocation: 'CAR-01', inputPallets: 1,
    outputSku: 'CAJA', outputLocation: 'CAJ-01', outputPallets: 2,
  } }));
  state = apply(state, { type: 'workOrderStatus', id: state.workOrders[0].id, status: 'completada', labelled: true });
  state = apply(state, orderAction({}));
  state = apply(state, { type: 'workOrderStatus', id: state.workOrders[1].id, status: 'completada' });
  state = apply(state, { type: 'shift', startTime: '07:00', endTime: '15:00', lunchStart: '10:00', lunchEnd: '10:30', announcement: 'Revisión antes del cierre' });
  state = apply(state, { type: 'closure', checks: [true, true, true, true, true], operator: 'Encargado', notes: '' });
  return state;
}
async function temporaryBackup(t, content) {
  const directory = await mkdtemp(join(tmpdir(), 'burriana-import-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'copia.json');
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return path;
}
function memoryStore(state = initialState()) {
  let snapshot = { revision: 0, state: structuredClone(state) };
  let writes = 0;
  return {
    get writes() { return writes; },
    read: async () => structuredClone(snapshot),
    write: async (revision, state) => {
      writes += 1;
      if (revision !== snapshot.revision) return false;
      snapshot = { revision: revision + 1, state: structuredClone(state) };
      return true;
    },
  };
}

test('current file and API-envelope backups retain production, recurrence, events and shift exactly', async t => {
  const state = fixture();
  const exported = { exportedAt: now.toISOString(), revision: 43, ...state };
  const path = await temporaryBackup(t, exported);
  assert.deepEqual(await readWarehouseBackup(path), state);
  assert.deepEqual(validateWarehouseBackup({ revision: 43, state }), state);
  const result = validateWarehouseBackup(exported);
  result.workOrders[0].events[0].actorName = 'Cambiar copia';
  assert.equal(state.workOrders[0].events[0].actorName, actor.name);
});

test('legacy files keep existing data and gain only empty work/default shift', async t => {
  const legacy = initialState();
  delete legacy.workOrders;
  delete legacy.shift;
  const path = await temporaryBackup(t, legacy);
  const result = await readWarehouseBackup(path);
  for (const key of ['products', 'locations', 'movements', 'tasks', 'closures']) assert.deepEqual(result[key], legacy[key]);
  assert.deepEqual(result.workOrders, []);
  assert.equal(result.shift.lunchStart, '');
  assert.equal(result.shift.lunchEnd, '');
});

test('invalid work, shifts, chronology and production links are rejected before any store is created', async t => {
  const valid = fixture();
  const mutations = [
    state => { state.workOrders = {}; },
    state => { state.shift = null; },
    state => { delete state.shift.startTime; },
    state => { state.shift.lunchEnd = ''; },
    state => { state.shift.lunchStart = '06:00'; },
    state => { state.workOrders[0].scheduledDate = '2026-02-30'; },
    state => { state.workOrders[0].scheduledTime = '24:00'; },
    state => { state.workOrders[0].status = 'invalid'; },
    state => { state.workOrders[0].events = []; },
    state => { state.workOrders[0].events[0].actorId = 'otro'; },
    state => { state.workOrders[0].createdAt = '2026-10-01T24:00:00.000Z'; },
    state => { state.workOrders[0].production.outputPallets = 3; },
    state => { state.movements = state.movements.filter(movement => movement.kind !== 'consumo'); },
    state => { state.workOrders[1].nextOrderId = null; },
    state => { state.workOrders[2].previousOrderId = 'missing'; },
    state => { state.workOrders.push(structuredClone(state.workOrders[0])); },
    state => { state.movements[0].actorId = 123; },
    state => { state.closures[0].actorId = ''; },
  ];
  for (const mutate of mutations) {
    const broken = structuredClone(valid);
    mutate(broken);
    const path = await temporaryBackup(t, broken);
    let connected = false;
    await assert.rejects(runImport([path], {
      createStore: () => { connected = true; return memoryStore(); }, log: () => {},
    }));
    assert.equal(connected, false);
  }
});

test('legacy inventory validation rejects negative stock, duplicate codes and impossible dates', () => {
  const valid = fixture();
  for (const mutate of [
    state => { state.locations[0].qty = -1; },
    state => { state.locations[0].qty = 11; },
    state => { state.locations[0].sku = 'INEXISTENTE'; },
    state => { state.products.push({ ...state.products[0], id: 'otro', sku: 'plancha' }); },
    state => { state.locations[1].id = state.locations[0].id; },
    state => { state.tasks[0].due = '2025-02-29'; },
    state => { state.closures[0].day = '2026-10-02'; },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => validateWarehouseBackup(invalid));
  }
});

test('validation-only mode never constructs a store, including the real CLI path', async t => {
  const path = await temporaryBackup(t, fixture());
  const result = await runImport([path, '--check'], { createStore: () => { throw new Error('Must not access DB'); }, log: () => {} });
  assert.equal(result.checked, true);
  const script = fileURLToPath(new URL('../scripts/import-state.mjs', import.meta.url));
  const output = await promisify(execFile)(process.execPath, ['--experimental-strip-types', script, path, '--check'], {
    env: { DATABASE_URL: 'not-a-database-url', POSTGRES_URL: 'not-a-database-url' }, timeout: 10000,
  });
  assert.match(output.stdout, /Copia válida, sin acceder a la base/);
});

test('restoring replaces the complete validated state and uses the live revision, not the exported one', async t => {
  const state = fixture();
  const path = await temporaryBackup(t, { revision: 999, ...state });
  const store = memoryStore();
  const restored = await runImport([path], { createStore: () => store, log: () => {} });
  assert.equal(store.writes, 1);
  assert.equal(restored.revision, 1);
  assert.deepEqual(restored.state, state);
});

test('custom tasks, work orders and non-default shift prevent unforced replacement', async t => {
  assert.equal(hasWarehouseData(initialState()), false);
  const states = [];
  const tasksOnly = initialState();
  tasksOnly.tasks[0].owner = 'Persona real';
  states.push(tasksOnly);
  states.push(apply(initialState(), orderAction({})));
  const shiftOnly = initialState();
  shiftOnly.shift.announcement = 'Aviso real';
  states.push(shiftOnly);
  const path = await temporaryBackup(t, initialState());
  for (const state of states) {
    const store = memoryStore(state);
    await assert.rejects(runImport([path], { createStore: () => store, log: () => {} }), /--force/);
    assert.equal(store.writes, 0);
    assert.deepEqual((await store.read()).state, state);
    await runImport([path, '--force'], { createStore: () => store, log: () => {} });
    assert.deepEqual((await store.read()).state, initialState());
  }
});

test('revision conflicts and malformed JSON stop restoration', async t => {
  const validPath = await temporaryBackup(t, fixture());
  let writes = 0;
  await assert.rejects(runImport([validPath], {
    createStore: () => ({ read: async () => ({ revision: 5, state: initialState() }), write: async () => { writes += 1; return false; } }),
    log: () => {},
  }), /Otro cambio/);
  assert.equal(writes, 1);
  const malformedPath = await temporaryBackup(t, '{');
  await assert.rejects(readWarehouseBackup(malformedPath), /JSON válido/);
  await assert.rejects(runImport([validPath, '--unknown']), /Uso:/);
  await assert.rejects(runImport([validPath], { createStore: () => { throw new Error('private-connection-details'); } }), error => {
    assert.match(error.message, /Revisa la conexión/);
    assert.doesNotMatch(error.message, /private-connection-details/);
    return true;
  });
});
