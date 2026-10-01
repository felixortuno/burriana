import assert from 'node:assert/strict';
import { boardTicker, duration, encouragement } from '../lib/board-ticker.ts';

const shift = { startTime: '07:00', endTime: '15:00', lunchStart: '10:00', lunchEnd: '10:30', announcement: '' };
const day = '2026-10-02';
const order = (extra = {}) => ({ id: Math.random().toString(36), kind: 'pedido', title: 'Preparar pedido', reference: '', truck: '', assignedTo: '', instructions: '', scheduledDate: day, scheduledTime: '', priority: 'normal', status: 'pendiente', repeatEveryDays: 0, previousOrderId: null, nextOrderId: null, createdAt: '', updatedAt: '', createdBy: '', updatedBy: '', completedAt: null, events: [], ...extra });
const block = { rule: { title: 'Mantenimiento y limpieza', notes: 'Revisar carretillas' }, start: '13:00', end: '15:00' };
const tick = (time, extra = {}) => boardTicker({ time, day, shift, blocks: [], orders: [], finishedToday: 0, seed: 0, ...extra });
const tones = state => state.messages.map(message => message.tone);

assert.equal(duration(80), '1 h 20 min');
assert.equal(duration(60), '1 h');
assert.equal(duration(7), '7 min');

// Outside the shift.
assert.deepEqual(tick('06:30').messages, [{ tone: 'fuera', text: 'Buenos días. El turno empieza a las 07:00' }]);
assert.match(tick('15:00', { finishedToday: 4 }).messages[0].text, /Turno terminado.*4 trabajos terminados/);

// Start of the day: a greeting with the work ahead, then the shift.
assert.deepEqual(tick('07:10', { orders: [order()] }).messages.map(m => m.text), ['¡Buenos días, equipo! Hoy hay 1 trabajo previsto', 'Turno de 07:00 a 15:00 · quedan 7 h 50 min · almuerzo a las 10:00']);

// The break is announced 15 minutes ahead, insists in the last 5, and runs while it lasts.
assert.equal(tick('09:40').messages[0].tone, 'info');
assert.deepEqual(tick('09:50').messages[0], { tone: 'aviso', text: 'Descanso en 10 min · de 10:00 a 10:30' });
assert.deepEqual(tick('09:56').messages[0], { tone: 'aviso', text: 'Descanso en 4 min · id dejando el puesto recogido' });
assert.deepEqual(tick('10:12').messages[0], { tone: 'descanso', text: '¡Buen provecho! Volvemos a las 10:30 · quedan 18 min' });
assert.equal(tick('10:30').messages.some(m => m.tone === 'descanso'), false);

// Fixed blocks of the shift: warned 30 minutes ahead, then «Ahora».
assert.equal(tick('12:35', { blocks: [block] }).messages[0].text, 'En 25 min: Mantenimiento y limpieza (13:00–15:00)');
assert.equal(tick('13:20', { blocks: [block] }).messages[0].text, 'Ahora: Mantenimiento y limpieza, hasta las 15:00 · Revisar carretillas');

// Urgent work, trucks about to arrive and the last half hour.
const truck = order({ kind: 'carga', title: 'Cargar Lidl', truck: '1234 ABC', scheduledTime: '11:15' });
assert.deepEqual(tones(tick('11:00', { orders: [order({ priority: 'urgente', title: 'Pedido Mercadona' }), truck] })).slice(0, 2), ['urgente', 'camion']);
assert.equal(tick('11:00', { orders: [truck] }).messages[0].text, 'Camión en 15 min · carga 1234 ABC');
assert.equal(tick('11:30', { orders: [truck] }).messages.some(m => m.tone === 'camion'), false, 'no warning once the time has passed');
assert.equal(tick('14:40').messages[0].text, 'Quedan 20 min de turno · cierre a las 15:00 · dejad el puesto listo para mañana');

// A heavy day brings two encouragement lines that change with the seed; a light one, praise.
const busy = Array.from({ length: 6 }, () => order());
const heavy = tick('08:00', { orders: busy, seed: 0 }).messages.filter(m => m.tone === 'animo').map(m => m.text);
assert.deepEqual(heavy, [encouragement[0].replace('{n}', '6'), encouragement[1]]);
assert.notDeepEqual(tick('08:00', { orders: busy, seed: 2 }).messages.filter(m => m.tone === 'animo'), tick('08:00', { orders: busy, seed: 0 }).messages.filter(m => m.tone === 'animo'));
assert.equal(tick('13:30', { orders: busy.slice(0, 3) }).messages.some(m => m.tone === 'animo'), true, 'three jobs with under two hours left is heavy');
assert.equal(tick('08:00', { orders: busy.slice(0, 3) }).messages.some(m => m.tone === 'animo'), false);
assert.equal(tick('08:00', { finishedToday: 3 }).messages.find(m => m.tone === 'animo').text, '¡Buen ritmo! 3 trabajos terminados hoy');
assert.equal(tick('08:00', { orders: [order({ status: 'pausada' }), ...busy.slice(0, 4)] }).messages.some(m => m.tone === 'animo'), false, 'paused work does not count');

// The day bar: lunch and blocks placed on the shift, and where we are now.
const { timeline } = tick('11:00', { blocks: [block] });
assert.equal(timeline.progress, 0.5);
assert.deepEqual(timeline.segments.map(s => [s.kind, s.from, s.to]), [['almuerzo', 0.375, 0.4375], ['norma', 0.75, 1]]);
console.log('OK: valla de la pantalla: descanso, normas, urgencias, camiones, cierre, ánimo y barra del día.');
