import assert from 'node:assert/strict';
import { boxDimensions, cajaDestinations, palletShape, formatPallets, linkPlancha, locationsToReview, modelKey, modelSummary, pairedCaja, planchaSources, productKind } from '../lib/warehouse-insights.ts';

assert.equal(modelKey('BIEDRONKA-40X30X23-PL'), 'BIEDRONKA-40X30X23');
assert.equal(modelKey('COLUMNA-NEGRA-60X40X15.5-CJ'), 'COLUMNA-NEGRA-60X40X15.5');
assert.equal(productKind({ sku: 'X-PL', family: 'Planchas' }), 'plancha');
assert.equal(productKind({ sku: 'X-CJ', family: 'Cajas' }), 'caja');
assert.equal(productKind({ sku: 'X-PL', family: 'Planchas y cajas' }), 'plancha');
assert.equal(productKind({ sku: 'CAN-1', family: 'Cantoneras' }), 'otro');

const state = {
  products: [
    { id: '1', sku: 'BIEDRONKA-40X30X23-PL', name: 'Biedronka 40x30x23 (plancha)', family: 'Planchas', minimum: 0 },
    { id: '2', sku: 'BIEDRONKA-40X30X23-CJ', name: 'Biedronka 40x30x23 (caja)', family: 'Cajas', minimum: 0 },
    { id: '3', sku: 'CARREFOUR-40X30X14.5-CJ', name: 'Carrefour 40x30x14.5 (caja)', family: 'Cajas', minimum: 0 },
  ],
  locations: [
    { id: 'a', code: 'CAR-01', zone: '', capacity: 20, sku: 'BIEDRONKA-40X30X23-PL', qty: 11, area: 'carton' },
    { id: 'b', code: 'CAJ-01', zone: '', capacity: 50, sku: 'BIEDRONKA-40X30X23-CJ', qty: 37, area: 'montaje' },
    { id: 'c', code: 'CAJ-02', zone: '', capacity: 40, sku: 'CARREFOUR-40X30X14.5-CJ', qty: 25.5, area: 'montaje' },
    { id: 'd', code: 'CAJ-03', zone: '', capacity: 40, sku: '', qty: 0, area: 'montaje' },
  ],
  movements: [
    { id: 'm1', date: '2026-09-30T13:00:00.000Z', kind: 'entrada', sku: 'CARREFOUR-40X30X14.5-CJ', qty: 25.5, location: 'CAJ-02', destination: '', operator: 'Inventario inicial', document: 'INV', notes: 'Stock inicial. REVISAR. Nota: alto 23 o 33.', stacked: false },
    { id: 'm2', date: '2026-09-30T13:00:00.000Z', kind: 'entrada', sku: 'BIEDRONKA-40X30X23-CJ', qty: 37, location: 'CAJ-01', destination: '', operator: 'Inventario inicial', document: 'INV', notes: 'Stock inicial.', stacked: false },
  ],
};

assert.deepEqual(modelSummary(state), [
  { key: 'BIEDRONKA-40X30X23', name: 'Biedronka 40x30x23', planchas: 11, cajas: 37, planchaSku: 'BIEDRONKA-40X30X23-PL', cajaSku: 'BIEDRONKA-40X30X23-CJ' },
  { key: 'CARREFOUR-40X30X14.5', name: 'Carrefour 40x30x14.5', planchas: 0, cajas: 25.5, cajaSku: 'CARREFOUR-40X30X14.5-CJ' },
]);
assert.deepEqual([...locationsToReview(state)], ['c']);
assert.equal(formatPallets(22.5), '22,5');
assert.equal(formatPallets(6.75), '6,75');
assert.equal(formatPallets(1000), '1000');

// Choosing a plancha links its caja, the fullest source block and the block that already holds those cajas.
const linked = { ...state, locations: [...state.locations, { id: 'e', code: 'CAR-02', zone: '', capacity: 20, sku: 'BIEDRONKA-40X30X23-PL', qty: 4, area: 'carton' }, { id: 'f', code: 'CAJ-04', zone: '', capacity: 90, sku: '', qty: 0, area: 'montaje' }, { id: 'g', code: 'CAR-09', zone: '', capacity: 9, sku: '', qty: 0, area: 'carton' }] };
assert.equal(pairedCaja(linked, 'BIEDRONKA-40X30X23-PL').sku, 'BIEDRONKA-40X30X23-CJ');
assert.equal(pairedCaja(linked, 'CARREFOUR-40X30X14.5-CJ'), undefined);
assert.deepEqual(planchaSources(linked, 'BIEDRONKA-40X30X23-PL').map(l => l.code), ['CAR-01', 'CAR-02']);
assert.deepEqual(linkPlancha(linked, 'BIEDRONKA-40X30X23-PL'), { inputSku: 'BIEDRONKA-40X30X23-PL', inputLocation: 'CAR-01', outputSku: 'BIEDRONKA-40X30X23-CJ', outputLocation: 'CAJ-01' });
// Without that caja in stock, the free assembly block with most room comes first, never another reference's block.
assert.deepEqual(cajaDestinations(linked, 'NUEVA-CJ').map(l => l.code), ['CAJ-04', 'CAJ-03', 'CAR-09']);
// A plancha without stock is planned from an empty cardboard block; a model without caja leaves the caja to choose.
const solo = { products: [{ id: 'p', sku: 'LIDL-VERDE-60X40X11-PL', name: 'Lidl Verde 60x40x11 (plancha)', family: 'Planchas', minimum: 0 }], locations: linked.locations };
assert.deepEqual(linkPlancha(solo, 'LIDL-VERDE-60X40X11-PL'), { inputSku: 'LIDL-VERDE-60X40X11-PL', inputLocation: 'CAR-09', outputSku: '', outputLocation: '' });
// A pallet: layers of 5 boxes (3 along, 2 across), 10 layers unless the model says otherwise.
assert.deepEqual(boxDimensions('COLUMNA-NEGRA-60X40X15.5-CJ'), { length: 60, width: 40, height: 15.5 });
assert.equal(boxDimensions('CAN-1'), null);
assert.deepEqual(palletShape({ sku: 'BIEDRONKA-60X40X18-CJ' }), { width: 1.2, depth: 1, height: 1.8, layers: 10, boxes: 50, estimated: true });
assert.deepEqual(palletShape({ sku: 'SUSSE-SUSI-60X40X14-CJ', boxesPerPallet: 55 }), { width: 1.2, depth: 1, height: 1.54, layers: 11, boxes: 55, estimated: false });
assert.deepEqual(palletShape({ sku: 'BIEDRONKA-40X30X23-CJ' }), { width: 0.9, depth: 0.7, height: 2.3, layers: 10, boxes: 50, estimated: true });
console.log('OK: modelos emparejados, enlace plancha-caja-bloques, tipos, líneas a revisar, formato de palets y forma del palet de cajas.');
