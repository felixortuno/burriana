import assert from 'node:assert/strict';
import { applySettings, blocksForDay, defaultSettings, describeRule, nextOccurrences, normalizeSettings, priorityOrder, ruleOccursOn, ruleWindow, weekdayOf } from '../lib/settings.ts';

let n = 0;
const id = () => `r${++n}`;
const shift = { startTime: '07:00', endTime: '15:00' };

// «Mantenimiento y limpieza cada 2 viernes, las 2 últimas horas».
assert.equal(weekdayOf('2026-10-02'), 5);
let settings = applySettings(defaultSettings(), { section: 'rule', value: { title: 'Mantenimiento y limpieza', kind: 'mantenimiento', weekday: 5, everyWeeks: 2, startDate: '2026-10-02', timing: { mode: 'final', hours: 2 }, notes: '', active: true } }, id);
const [rule] = settings.rules;
assert.equal(rule.id, 'r1');
assert.equal(describeRule(rule), 'Cada 2 viernes, las 2 últimas horas del turno');
assert.deepEqual(ruleWindow(rule, shift), { start: '13:00', end: '15:00' });
assert.equal(ruleOccursOn(rule, '2026-10-02'), true);
assert.equal(ruleOccursOn(rule, '2026-10-09'), false);
assert.equal(ruleOccursOn(rule, '2026-10-16'), true);
assert.equal(ruleOccursOn(rule, '2026-09-18'), false, 'nothing before the start date');
assert.deepEqual(nextOccurrences(rule, '2026-10-03'), ['2026-10-16', '2026-10-30', '2026-11-13']);
assert.deepEqual(nextOccurrences(rule, '2026-10-02', 1), ['2026-10-02']);
assert.deepEqual(blocksForDay(settings.rules, '2026-10-16', shift).map(b => [b.rule.title, b.start, b.end]), [['Mantenimiento y limpieza', '13:00', '15:00']]);
assert.deepEqual(blocksForDay(settings.rules, '2026-10-09', shift), []);
// Never earlier than the start of the shift.
assert.deepEqual(ruleWindow({ ...rule, timing: { mode: 'final', hours: 12 } }, shift), { start: '07:00', end: '15:00' });

// Editing keeps the id; the first day must fall on the chosen weekday; inactive rules never apply.
settings = applySettings(settings, { section: 'rule', value: { ...rule, title: 'Limpieza', active: false } }, id);
assert.equal(settings.rules.length, 1);
assert.equal(settings.rules[0].title, 'Limpieza');
assert.equal(ruleOccursOn(settings.rules[0], '2026-10-16'), false);
assert.throws(() => applySettings(settings, { section: 'rule', value: { ...rule, id: undefined, startDate: '2026-10-01' } }, id), /viernes/);
assert.throws(() => applySettings(settings, { section: 'rule', value: { ...rule, id: undefined, timing: { mode: 'horario', start: '15:00', end: '13:00' } } }, id), /horario/);
settings = applySettings(settings, { section: 'deleteRule', id: 'r1' }, id);
assert.deepEqual(settings.rules, []);

// Priorities: every kind once, or null for the original «viajes primero».
assert.equal(priorityOrder(defaultSettings()), 'viajes_primero');
settings = applySettings(settings, { section: 'priorities', value: ['pedido', 'viaje', 'carga', 'descarga', 'mantenimiento', 'limpieza'] }, id);
assert.deepEqual(priorityOrder(settings), ['pedido', 'viaje', 'carga', 'descarga', 'mantenimiento', 'limpieza']);
assert.throws(() => applySettings(settings, { section: 'priorities', value: ['pedido', 'pedido', 'carga', 'descarga', 'mantenimiento', 'limpieza'] }, id), /una sola vez/);

// Colours are #RRGGBB; null restores the defaults.
settings = applySettings(settings, { section: 'appearance', value: { accent: '#2c49a6', selection: '#1c1c1a', logoStroke: '#d9e33b', logoTile: '#1c1c1a' } }, id);
assert.equal(settings.appearance.accent, '#2C49A6');
assert.throws(() => applySettings(settings, { section: 'board', value: { background: 'red', panel: '#000000', accent: '#000000', text: '#ffffff' } }, id), /#RRGGBB/);
assert.deepEqual(applySettings(settings, { section: 'board', value: null }, id).board, defaultSettings().board);

// Older data without settings gets the defaults; stored settings round-trip unchanged.
assert.deepEqual(normalizeSettings(undefined), defaultSettings());
assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
console.log('OK: normas cada N semanas, franjas del turno, prioridades y colores validados.');
