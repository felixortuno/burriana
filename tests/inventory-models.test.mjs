import assert from 'node:assert/strict';
import { inventoryModels, inventoryTotals } from '../lib/inventory-models.ts';

const product = (sku, family, minimum = 0, boxesPerPallet) => ({ id: sku, sku, name: `${sku.replace(/-(PL|CJ)$/, '')} (${family === 'Planchas' ? 'plancha' : 'caja'})`, family, minimum, ...(boxesPerPallet === undefined ? {} : { boxesPerPallet }) });
const location = (sku, qty, index = 0) => ({ id: `${sku}-${index}`, code: `${sku}-${index}`, zone: '', capacity: 100, sku, qty });
const state = {
  products: [
    product('ALFA-PL', 'Planchas', 26),
    product('ALFA-CJ', 'Cajas', 2, 55),
    product('BETA-CJ', 'Cajas', 0),
    product('SOLO-PL', 'Planchas', 0),
    product('CANTONERAS', 'Cantoneras', 5),
    product('VACIO-CJ', 'Cajas', 0),
    product('MINIMO-PL', 'Planchas', 26),
  ],
  locations: [
    location('ALFA-PL', 10, 1),
    location('ALFA-PL', 12.5, 2),
    location('ALFA-CJ', 2.25),
    location('BETA-CJ', 0.75),
    location('SOLO-PL', 1),
    location('CANTONERAS', 3.25),
    location('MINIMO-PL', 26),
    location('', 0),
  ],
};
const original = structuredClone(state);
const rows = inventoryModels(state);
const byKey = new Map(rows.map(row => [row.key, row]));
const alfa = byKey.get('ALFA');

assert.equal(alfa.name, 'ALFA');
assert.equal(alfa.planchas, 22.5, 'One reference is summed across locations.');
assert.equal(alfa.cajas, 2.25);
assert.equal(alfa.totalPallets, 24.75);
assert.equal(alfa.boxUnits, 123.75, 'The reference conversion also applies to partial pallets.');
assert.equal(alfa.boxUnitsEstimated, false);
assert.deepEqual(alfa.shortages, { plancha: 3.5, caja: 0, otro: 0, total: 3.5 });
assert.equal(alfa.belowMinimum, true);
assert.equal(alfa.noStock, false);
assert.deepEqual(alfa.products.map(item => item.sku), ['ALFA-PL', 'ALFA-CJ']);
assert.deepEqual(alfa.planchaProducts.map(item => item.sku), ['ALFA-PL']);
assert.deepEqual(alfa.cajaProducts.map(item => item.sku), ['ALFA-CJ']);
assert.deepEqual(alfa.otherProducts, []);

assert.equal(byKey.get('BETA').boxUnits, 37.5);
assert.equal(byKey.get('BETA').boxUnitsEstimated, true);
assert.deepEqual(byKey.get('BETA').planchaProducts, [], 'An absent plancha is not an invented reference or shortage.');
assert.equal(byKey.get('BETA').shortages.plancha, 0);
assert.deepEqual(byKey.get('SOLO').cajaProducts, []);
assert.equal(byKey.get('SOLO').boxUnits, 0);
assert.equal(byKey.get('SOLO').boxUnitsEstimated, false);

const other = byKey.get('CANTONERAS');
assert.equal(other.otros, 3.25);
assert.equal(other.cajas, 0, 'Other families must not be counted as cajas.');
assert.equal(other.boxUnits, 0);
assert.equal(other.boxUnitsEstimated, false);
assert.deepEqual(other.shortages, { plancha: 0, caja: 0, otro: 1.75, total: 1.75 });
assert.equal(other.otherProducts.length, 1);

assert.equal(byKey.get('VACIO').noStock, true);
assert.equal(byKey.get('VACIO').belowMinimum, false, 'Zero minimum is valid even with no stock.');
assert.equal(byKey.get('VACIO').boxUnitsEstimated, false, 'No stocked boxes means no estimated units.');
assert.equal(byKey.get('MINIMO').belowMinimum, false, 'Meeting the minimum exactly is sufficient.');
assert.equal(byKey.get('MINIMO').shortages.total, 0);
assert.deepEqual(state, original, 'Computing the inventory does not mutate warehouse state.');

// A model can contain more than one reference of one kind. Each needs its own conversion and minimum.
const multi = inventoryModels({
  products: [product('MULTI', 'Cajas', 8, 40), product('MULTI-CJ', 'Cajas', 2, 60), product('MULTI-PL', 'Planchas', 26)],
  locations: [location('MULTI', 2), location('MULTI-CJ', 10), location('MULTI-PL', 30)],
})[0];
assert.equal(multi.cajaProducts.length, 2);
assert.equal(multi.boxUnits, 680, 'Conversions are applied per reference before adding units.');
assert.equal(multi.boxUnitsEstimated, false);
assert.equal(multi.shortages.caja, 6, 'Surplus of another caja reference cannot cancel a shortage.');
assert.equal(multi.shortages.plancha, 0);
assert.equal(multi.shortages.total, 6);
assert.equal(multi.belowMinimum, true);

const mixedConversion = inventoryModels({
  products: [product('MIX', 'Cajas', 0), product('MIX-CJ', 'Cajas', 0, 60)],
  locations: [location('MIX-CJ', 2)],
})[0];
assert.equal(mixedConversion.boxUnits, 120);
assert.equal(mixedConversion.boxUnitsEstimated, false, 'An empty reference with no conversion does not taint exact units.');

const noStock = inventoryModels({ products: [product('SIN-PL', 'Planchas', 26)], locations: [] })[0];
assert.equal(noStock.noStock, true);
assert.equal(noStock.belowMinimum, true);
assert.deepEqual(noStock.shortages, { plancha: 26, caja: 0, otro: 0, total: 26 });

assert.deepEqual(inventoryTotals(rows), {
  models: 6,
  planchas: 49.5,
  cajas: 3,
  otros: 3.25,
  totalPallets: 55.75,
  boxUnits: 161.25,
  boxUnitsEstimated: true,
  belowMinimum: 2,
  noStock: 1,
  shortages: { plancha: 3.5, caja: 0, otro: 1.75, total: 5.25 },
});
assert.deepEqual(inventoryModels({ products: [], locations: [] }), []);
assert.deepEqual(inventoryTotals([]), {
  models: 0, planchas: 0, cajas: 0, otros: 0, totalPallets: 0, boxUnits: 0,
  boxUnitsEstimated: false, belowMinimum: 0, noStock: 0,
  shortages: { plancha: 0, caja: 0, otro: 0, total: 0 },
});

console.log('OK: inventario por modelo, referencias, mínimos, cajas por palet y totales.');
