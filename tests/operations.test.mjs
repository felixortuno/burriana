import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, initialState, normalizeState } from '../lib/warehouse.ts';
import { defaultShiftSettings, isValidCalendarDate, sortOperationalOrders } from '../lib/operations.ts';

const manager = { id: 'manager-1', name: 'Encargada de prueba' };
const now = new Date('2026-10-01T08:00:00.000Z');
const makeAction = (extra = {}) => ({
  type: 'workOrder', kind: 'pedido', title: 'Preparar pedido', reference: 'PED-1',
  truck: '', assignedTo: '', instructions: '', scheduledDate: '2026-10-01',
  scheduledTime: '11:00', priority: 'normal', repeatEveryDays: 0, ...extra,
});
const apply = (state, action, time = now, actor = manager) => applyAction(state, action, time, actor);

test('legacy state gains an empty work board without changing inventory or inventing lunch hours', () => {
  const legacy = initialState();
  delete legacy.workOrders;
  delete legacy.shift;
  const before = structuredClone(legacy);
  const normalized = normalizeState(legacy);
  assert.deepEqual(normalized.workOrders, []);
  assert.deepEqual(normalized.shift, { startTime: '07:00', endTime: '15:00', lunchStart: '', lunchEnd: '', announcement: '' });
  assert.deepEqual(legacy, before);
  const saved = apply(legacy, makeAction());
  assert.equal(saved.workOrders.length, 1);
  for (const key of ['products', 'locations', 'movements', 'tasks', 'closures']) {
    assert.deepEqual(saved[key], before[key]);
  }
});

test('work captures trusted actor and server time; editing preserves identity and creation history', () => {
  let state = apply(initialState(), makeAction({ createdBy: 'forged', status: 'completada', title: '  Preparar pedido  ' }));
  const original = structuredClone(state.workOrders[0]);
  assert.equal(original.status, 'pendiente');
  assert.equal(original.title, 'Preparar pedido');
  assert.equal(original.createdBy, manager.id);
  assert.equal(original.createdAt, now.toISOString());
  assert.equal(original.events[0].actorName, manager.name);
  const later = new Date('2026-10-01T09:00:00Z');
  state = apply(state, makeAction({ id: original.id, title: 'Pedido corregido' }), later);
  const updated = state.workOrders[0];
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.updatedAt, later.toISOString());
  assert.deepEqual(updated.events[0], original.events[0]);
  assert.equal(updated.events[1].kind, 'updated');
  const fallback = applyAction(initialState(), makeAction(), now).workOrders[0];
  assert.equal(fallback.createdBy, 'legacy-office');
  assert.equal(fallback.events[0].actorName, 'Cuenta de oficina heredada');
});

test('work validation rejects unknown IDs, impossible dates, invalid times, enums and lengths atomically', () => {
  const state = apply(initialState(), makeAction());
  const before = structuredClone(state);
  for (const action of [
    makeAction({ id: 'missing' }), makeAction({ id: '' }),
    makeAction({ scheduledDate: '2026-02-30' }), makeAction({ scheduledDate: '2025-02-29' }),
    makeAction({ scheduledDate: '2026-99-99' }), makeAction({ scheduledDate: '' }),
    makeAction({ scheduledTime: '24:00' }), makeAction({ scheduledTime: '9:30' }),
    makeAction({ kind: 'fake' }), makeAction({ priority: 'fake' }),
    makeAction({ title: ' ' }), makeAction({ title: 'a'.repeat(181) }),
    makeAction({ instructions: 'a'.repeat(1501) }),
    makeAction({ repeatEveryDays: 1 }),
    makeAction({ kind: 'limpieza', repeatEveryDays: 1.5 }),
    makeAction({ kind: 'limpieza', repeatEveryDays: 366 }),
    { type: 'workOrderStatus', id: 'missing', status: 'en_curso' },
    { type: 'workOrderStatus', id: state.workOrders[0].id, status: 'fake' },
  ]) {
    assert.throws(() => apply(state, action), undefined, JSON.stringify(action));
    assert.deepEqual(state, before);
  }
  assert.equal(isValidCalendarDate('2028-02-29'), true);
  assert.equal(apply(state, makeAction({ scheduledDate: '2028-02-29', scheduledTime: '' })).workOrders.length, 2);
});

test('status changes are attributed, repeat status is a no-op, and closed work cannot reopen', () => {
  let state = apply(initialState(), makeAction());
  const id = state.workOrders[0].id;
  for (const status of ['en_curso', 'pausada', 'en_curso', 'completada']) {
    state = apply(state, { type: 'workOrderStatus', id, status });
  }
  assert.equal(state.workOrders[0].events.length, 5);
  assert.equal(state.workOrders[0].completedAt, now.toISOString());
  assert.deepEqual(apply(state, { type: 'workOrderStatus', id, status: 'completada' }), state);
  assert.throws(() => apply(state, { type: 'workOrderStatus', id, status: 'en_curso' }), /cerrado/);
  assert.throws(() => apply(state, makeAction({ id, title: 'Cambiar terminado' })), /cerrado/);
  let cancelled = apply(initialState(), makeAction());
  const cancelledId = cancelled.workOrders[0].id;
  cancelled = apply(cancelled, { type: 'workOrderStatus', id: cancelledId, status: 'cancelada' });
  assert.equal(cancelled.workOrders[0].completedAt, null);
});

test('completion of recurrent maintenance schedules exactly one next instance from Madrid completion day', () => {
  let state = apply(initialState(), makeAction({ kind: 'mantenimiento', repeatEveryDays: 2 }));
  const id = state.workOrders[0].id;
  const completedAt = new Date('2026-10-24T22:30:00Z'); // Already 25 October in Madrid; clocks change that night.
  state = apply(state, { type: 'workOrderStatus', id, status: 'completada' }, completedAt);
  assert.equal(state.workOrders.length, 2);
  const original = state.workOrders.find(order => order.id === id);
  const next = state.workOrders.find(order => order.previousOrderId === id);
  assert.equal(original.nextOrderId, next.id);
  assert.equal(next.scheduledDate, '2026-10-27');
  assert.equal(next.scheduledTime, '11:00');
  assert.equal(next.status, 'pendiente');
  assert.equal(next.completedAt, null);
  assert.equal(next.repeatEveryDays, 2);
  assert.equal(next.events.length, 1);
  assert.deepEqual(apply(state, { type: 'workOrderStatus', id, status: 'completada' }, completedAt), state);
  const cancelled = apply(state, { type: 'workOrderStatus', id: next.id, status: 'cancelada' });
  assert.equal(cancelled.workOrders.length, 2);
});

test('shift validates a same-day schedule and an optional complete lunch interval', () => {
  const state = initialState();
  const base = { type: 'shift', ...defaultShiftSettings() };
  const updated = apply(state, { ...base, lunchStart: '10:00', lunchEnd: '10:30', announcement: '  Revisión de máquina  ' });
  assert.equal(updated.shift.announcement, 'Revisión de máquina');
  assert.equal(updated.shift.lunchStart, '10:00');
  assert.equal(state.shift.lunchStart, '');
  for (const change of [
    { startTime: '15:00', endTime: '07:00' }, { startTime: '07:00', endTime: '07:00' },
    { startTime: '7:00' }, { lunchStart: '10:00' }, { lunchEnd: '10:30' },
    { lunchStart: '10:00', lunchEnd: '09:30' }, { lunchStart: '06:30', lunchEnd: '07:30' },
    { lunchStart: '14:30', lunchEnd: '15:30' }, { announcement: 'a'.repeat(1001) },
  ]) assert.throws(() => apply(state, { ...base, ...change }));
});

test('shared ordering puts work in progress first, then urgency, then production, without mutation', () => {
  let state = initialState();
  for (const extra of [
    { title: 'Normal temprano', scheduledTime: '07:00' },
    { title: 'Viaje normal', kind: 'viaje', scheduledTime: '12:00' },
    { title: 'Limpieza urgente', kind: 'limpieza', priority: 'urgente' },
    { title: 'Carga en curso', kind: 'carga', scheduledTime: '13:00' },
    { title: 'Cerrado urgente', priority: 'urgente' },
  ]) state = apply(state, makeAction(extra));
  state = apply(state, { type: 'workOrderStatus', id: state.workOrders[3].id, status: 'en_curso' });
  state = apply(state, { type: 'workOrderStatus', id: state.workOrders[4].id, status: 'completada' });
  const original = state.workOrders.map(order => order.id);
  assert.deepEqual(sortOperationalOrders(state.workOrders).map(order => order.title), [
    'Carga en curso', 'Limpieza urgente', 'Viaje normal', 'Normal temprano', 'Cerrado urgente',
  ]);
  assert.deepEqual(sortOperationalOrders(state.workOrders, 'fecha_programada').map(order => order.title), [
    'Carga en curso', 'Limpieza urgente', 'Normal temprano', 'Viaje normal', 'Cerrado urgente',
  ]);
  // The administrator's order of kinds replaces «viajes primero»: here pedidos and cleaning come first.
  assert.deepEqual(sortOperationalOrders(state.workOrders, ['limpieza', 'pedido', 'viaje', 'carga', 'descarga', 'mantenimiento']).map(order => order.title), [
    'Carga en curso', 'Limpieza urgente', 'Normal temprano', 'Viaje normal', 'Cerrado urgente',
  ]);
  assert.deepEqual(state.workOrders.map(order => order.id), original);
});

const production = {
  inputSku: 'PLANCHA-A', inputLocation: 'CAR-A-01', inputPallets: 2,
  outputSku: 'CAJA-A', outputLocation: 'CAJ-A-01', outputPallets: 3,
};
function productionState() {
  let state = initialState();
  for (const [sku, name] of [['PLANCHA-A', 'Planchas'], ['CAJA-A', 'Cajas'], ['CAJA-B', 'Otras cajas']]) {
    state = apply(state, { type: 'product', sku, name, family: 'Cartón', minimum: 0 });
  }
  for (const [code, area] of [['CAR-A-01', 'carton'], ['CAJ-A-01', 'montaje']]) {
    state = apply(state, { type: 'location', code, area, zone: 'A', capacity: 10 });
  }
  state = apply(state, { type: 'movement', kind: 'entrada', sku: 'PLANCHA-A', qty: 2, location: 'CAR-A-01', labelled: true, operator: 'Nombre falsificado' });
  return apply(state, makeAction({ kind: 'viaje', title: 'Transformar planchas', production }));
}

test('completing a viaje consumes full pallets and produces full pallets atomically with linked history', () => {
  const before = productionState();
  const id = before.workOrders[0].id;
  const state = apply(before, { type: 'workOrderStatus', id, status: 'completada', labelled: true, stacked: true, safe: true, operator: 'Impostor' });
  assert.equal(before.locations[0].qty, 2);
  assert.equal(state.locations[0].qty, 0);
  assert.equal(state.locations[0].sku, '');
  assert.equal(state.locations[1].qty, 3);
  assert.equal(state.locations[1].sku, 'CAJA-A');
  const linked = state.movements.filter(movement => movement.workOrderId === id);
  assert.deepEqual(linked.map(movement => [movement.kind, movement.sku, movement.qty]), [
    ['consumo', 'PLANCHA-A', 2], ['produccion', 'CAJA-A', 3],
  ]);
  assert.equal(linked[0].operator, manager.name);
  assert.equal(linked[1].operator, manager.name);
  assert.equal(linked[1].stacked, true);
  assert.equal(linked[0].stacked, false);
  assert.deepEqual(state.workOrders[0].production, production);
  assert.equal(state.workOrders[0].status, 'completada');
  assert.deepEqual(apply(state, { type: 'workOrderStatus', id, status: 'completada' }), state);
  // The normal intake also derives its operator from the trusted session actor.
  assert.equal(before.movements[0].operator, manager.name);
});

test('a viaje may be planned without production details but cannot complete without them', () => {
  let state = productionState();
  state = apply(state, makeAction({ kind: 'viaje', title: 'Planificar sin consumos' }));
  const id = state.workOrders.at(-1).id;
  assert.throws(() => apply(state, { type: 'workOrderStatus', id, status: 'completada', labelled: true }), /planchas/);
  const completed = apply(state, { type: 'workOrderStatus', id, status: 'completada', labelled: true, production });
  assert.deepEqual(completed.workOrders.at(-1).production, production);
});

test('failed production never changes inventory, work status or history', () => {
  const state = productionState();
  const id = state.workOrders[0].id;
  const original = structuredClone(state);
  const complete = { type: 'workOrderStatus', id, status: 'completada', labelled: true };
  for (const change of [
    { labelled: false }, { stacked: true, safe: false },
    { production: { ...production, inputPallets: 3 } },
    { production: { ...production, outputPallets: 11 } },
    { production: { ...production, outputPallets: 0.5 } },
    { production: { ...production, inputPallets: -1 } },
    { production: { ...production, inputSku: 'NO-EXISTE' } },
    { production: { ...production, outputSku: 'PLANCHA-A' } },
    { production: { ...production, outputLocation: 'CAR-A-01' } },
    { production: { ...production, outputLocation: 'NO-EXISTE' } },
  ]) {
    assert.throws(() => apply(state, { ...complete, ...change }));
    assert.deepEqual(state, original);
  }
  const mixed = structuredClone(state);
  mixed.locations[1].sku = 'CAJA-B';
  mixed.locations[1].qty = 1;
  assert.throws(() => apply(mixed, complete), /otra referencia/);
  const unassigned = structuredClone(state);
  delete unassigned.locations[1].area;
  assert.throws(() => apply(unassigned, complete), /zona/);
});

test('completing dispatch or cleaning work does not imply an inventory movement', () => {
  for (const kind of ['pedido', 'carga', 'descarga', 'mantenimiento', 'limpieza']) {
    const before = apply(productionState(), makeAction({ kind }));
    const id = before.workOrders.at(-1).id;
    const after = apply(before, { type: 'workOrderStatus', id, status: 'completada' });
    assert.deepEqual(after.locations, before.locations);
    assert.deepEqual(after.movements, before.movements);
  }
});
