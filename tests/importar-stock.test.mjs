import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, initialState } from '../lib/warehouse.ts';
import { stockBySku } from '../lib/warehouse-insights.ts';
import { planStockImport, runStockImport, validateStockFile } from '../scripts/importar-stock.mjs';

const header = 'codigo_modelo,nombre_modelo,tipo,largo_cm,ancho_cm,alto_cm,alto_secundario_cm,medida,cantidad,nombre_original,confianza_relacion,revisar,nota';
const csv = rows => Buffer.from([header, ...rows].join('\n') + '\n');
const base = [
  'BIEDRONKA-40x30x23,Biedronka,plancha,40,30,23,,40x30x23,11,Biedronka,alta,no,',
  'BIEDRONKA-40x30x23,Biedronka,caja,40,30,23,,40x30x23,37,Biedronka,alta,no,',
  'TANGO-40x30x16,Tango,plancha,40,30,16,12,40x30x16/12,12,Tango,sin caja,no,',
  'SIMPATIA-50x30x11,Simpatía,plancha,50,30,11,,50x30x11,6.75,Simpatía,sin caja,no,"Escrito \'6 + 3/4\'"',
  'PISTACHO-60x40x10.5,Pistacho,plancha,60,40,10.5,,60x40x10.5,6,Verde Pist Brill,alta,si,"Alto escrito \'105\' sin coma; leído 10,5"',
];

test('the file is validated before anything else, and doubtful rows are set aside', () => {
  const checked = validateStockFile(csv(base));
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.rows.map(row => `${row.codigo_modelo}|${row.tipo}|${row.qty}`), ['BIEDRONKA-40x30x23|plancha|11', 'BIEDRONKA-40x30x23|caja|37', 'TANGO-40x30x16|plancha|12', 'SIMPATIA-50x30x11|plancha|6.75']);
  assert.deepEqual(checked.excluded.map(row => row.line), [6]);
  assert.throws(() => validateStockFile(csv([base[0].replace(',11,', ',"11,5",')])), /decimales con coma/);
  assert.throws(() => validateStockFile(Buffer.from(header.replaceAll(',', ';') + '\n')), /separador es «;»/);
  assert.throws(() => validateStockFile(Buffer.from([0x63, 0xff, 0x0a])), /UTF-8/);
  const problems = validateStockFile(csv([base[0], base[0], base[1].replace(',Biedronka,caja', ',Biedronka Caja,caja'), 'MAL CODIGO,X,plancha,1,1,1,,1x1x1,1,,,no,', 'OTRO-10x10x10,Otro,caja,10,10,12,,10x10x10,1.3,,,no,'])).errors;
  assert.ok(problems.some(error => /repetida con la fila 2/.test(error)));
  assert.ok(problems.some(error => /formato NOMBRE-LxAxH/.test(error)));
  assert.ok(problems.some(error => /el código dice 10x10x10 y las columnas 10x10x12/.test(error)));
  assert.ok(problems.some(error => /cuartos/.test(error)));
  assert.ok(problems.some(error => /nombres distintos/.test(error)));
});

function warehouse() {
  let state = initialState();
  const at = new Date('2026-09-30T12:00:00Z');
  state = applyAction(state, { type: 'product', sku: 'BIEDRONKA-40X30X23-PL', name: 'Biedronka 40x30x23 (plancha)', family: 'Planchas', minimum: 0 }, at);
  state = applyAction(state, { type: 'product', sku: 'BIEDRONKA-40X30X23-CJ', name: 'Biedronka 40x30x23 (caja)', family: 'Cajas', minimum: 26 }, at);
  state = applyAction(state, { type: 'location', code: 'CAR-01', zone: 'Planchas', area: 'carton', capacity: 14 }, at);
  state = applyAction(state, { type: 'location', code: 'CAJ-01', zone: 'Cajas', area: 'montaje', capacity: 47 }, at);
  state = applyAction(state, { type: 'movement', kind: 'entrada', sku: 'BIEDRONKA-40X30X23-PL', qty: 9, location: 'CAR-01', operator: 'Prueba', labelled: true }, at);
  state = applyAction(state, { type: 'movement', kind: 'entrada', sku: 'BIEDRONKA-40X30X23-CJ', qty: 37, location: 'CAJ-01', operator: 'Prueba', labelled: true }, at);
  return state;
}

test('a recount replaces: adjusts what differs, leaves what matches and creates what is new', () => {
  const state = warehouse();
  const plan = planStockImport(state, validateStockFile(csv(base)).rows, 'sustituir');
  const bySku = Object.fromEntries(plan.steps.map(step => [step.sku, step]));
  assert.equal(bySku['BIEDRONKA-40X30X23-PL'].action, 'ajuste');
  assert.equal(bySku['BIEDRONKA-40X30X23-CJ'].action, 'sin cambios');
  assert.equal(bySku['TANGO-40X30X16-PL'].action, 'entrada');
  assert.equal(bySku['TANGO-40X30X16-PL'].block.code, 'CAR-02');
  assert.equal(bySku['SIMPATIA-50X30X11-PL'].block.code, 'CAR-03');
  assert.deepEqual(plan.problems, []);
  // A reference spread over two blocks is not guessed at.
  let split = applyAction(state, { type: 'location', code: 'CAR-09', zone: 'Planchas', area: 'carton', capacity: 5 });
  split = applyAction(split, { type: 'movement', kind: 'entrada', sku: 'BIEDRONKA-40X30X23-PL', qty: 1, location: 'CAR-09', operator: 'Prueba', labelled: true });
  assert.match(planStockImport(split, validateStockFile(csv(base)).rows).problems[0], /repartida en 2 bloques/);
  // Adding stock instead of replacing it.
  assert.equal(planStockImport(state, validateStockFile(csv([base[1].replace(',37,', ',5,')])).rows, 'sumar').steps[0].target, 42);
});

test('the dry run never writes; --escribir writes once, records movements and verifies', async () => {
  let current = { revision: 4, state: warehouse() };
  let writes = 0;
  const store = { async read() { return structuredClone(current); }, async write(revision, state) { writes++; if (revision !== current.revision) return false; current = { revision: revision + 1, state }; return true; } };
  const options = { createStore: async () => store, readFile: async () => csv(base), log: () => {} };
  const dry = await runStockImport(['stock.csv'], options);
  assert.equal(dry.written, false);
  assert.equal(writes, 0);
  const done = await runStockImport(['stock.csv', '--fecha=2026-10-02', '--escribir'], options);
  assert.equal(done.written, true);
  assert.equal(current.revision, 5);
  const stock = stockBySku(current.state);
  assert.equal(stock.get('BIEDRONKA-40X30X23-PL'), 11);
  assert.equal(stock.get('TANGO-40X30X16-PL'), 12);
  assert.equal(stock.get('SIMPATIA-50X30X11-PL'), 6.75);
  assert.equal(stock.get('PISTACHO-60X40X10.5-PL'), undefined, 'doubtful rows stay out');
  const recount = current.state.movements.find(m => m.kind === 'ajuste');
  assert.match(recount.notes, /Recuento de stock.csv \(2026-10-02\)/);
  assert.equal(recount.operator, 'Importación stock.csv');
  const entry = current.state.movements.find(m => m.kind === 'entrada' && m.sku === 'TANGO-40X30X16-PL');
  assert.equal(entry.document, 'INV-2026-10-02');
  assert.equal(current.state.products.find(p => p.sku === 'TANGO-40X30X16-PL').name, 'Tango 40x30x16/12 (plancha)');
  // Running the same file again changes nothing.
  const again = await runStockImport(['stock.csv', '--escribir'], options);
  assert.ok(again.plan.steps.every(step => step.action === 'sin cambios'));
  // A write that loses the race leaves nothing half done.
  // Adding more than a block holds is listed as pending instead of written.
  await assert.rejects(runStockImport(['stock.csv', '--modo=sumar', '--escribir'], options), /Resuelve antes los pendientes/);
  store.write = async () => false;
  options.readFile = async () => csv([base[0].replace(',11,', ',12,')]);
  await assert.rejects(runStockImport(['stock.csv', '--escribir'], options), /Otro cambio se guardó/);
  assert.equal(current.revision, 6);
});
