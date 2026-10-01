import assert from 'node:assert/strict';
import { layoutWarehouse, stackLevels, cajasSlots, cartonSlots } from '../lib/warehouse-layout.ts';

assert.deepEqual(stackLevels(5, 2), [[1, 1], [1, 1], [1]]);
assert.deepEqual(stackLevels(6.75, 3), [[1, 1, 1], [1, 1, 1], [0.75]]);
assert.deepEqual(stackLevels(0.5, 2), [[0.5]]);

// The stock imported on 30/09/2026: planchas in the cardboard store, cajas in the bottom strip.
const planchas = [25, 16, 11, 6, 22.5, 5, 12, 12, 20, 13, 32, 27, 3, 22, 6.75, 7, 23.5, 4, 3];
const cajas = [15, 37, 40, 54, 5.5, 35, 31.5, 55, 30, 24, 19, 37, 57, 26, 25.5, 22, 26.5, 26];
const at = (area, prefix) => (qty, i) => ({ id: `${prefix}${i}`, code: `${prefix}-${String(i + 1).padStart(2, '0')}`, zone: '', capacity: 100, sku: `${prefix}${i}`, qty, area });
const locations = [...planchas.map(at('carton', 'CAR')), ...cajas.map(at('montaje', 'CAJ')), { id: 'free', code: 'CAR-99', zone: '', capacity: 4, sku: '', qty: 0, area: 'carton' }];
const layout = layoutWarehouse(locations);

const sum = list => list.reduce((n, v) => n + v, 0);
const placed = area => sum(layout.stacks.filter(stack => stack.area === area).flatMap(stack => stack.levels));
assert.equal(placed('carton'), sum(planchas));
assert.equal(placed('montaje'), sum(cajas));
assert.deepEqual(layout.stackHeight, { carton: 2, montaje: 3 });
assert.equal(layout.overflow, 0);
assert.equal(layout.stacks.some(stack => stack.locationId === 'free'), false);

const keys = layout.stacks.map(stack => `${stack.slot.x}:${stack.slot.y}`);
assert.equal(new Set(keys).size, keys.length, 'two stacks share a pallet position');
assert.ok(layout.stacks.filter(s => s.area === 'carton').every(s => cartonSlots.includes(s.slot)));
assert.ok(layout.stacks.filter(s => s.area === 'montaje').every(s => cajasSlots.includes(s.slot)));
// Boxes start next to the offices and move towards the bottom-left corner.
const firstBoxes = layout.stacks.find(stack => stack.area === 'montaje');
assert.equal(firstBoxes.slot.x, Math.max(...cajasSlots.map(slot => slot.x)));

// A zone that cannot hold its stock stacks higher before spilling onto the open floor.
const crowded = layoutWarehouse([{ id: 'x', code: 'CAJ-01', zone: '', capacity: 5000, sku: 'X', qty: 2000, area: 'montaje' }]);
assert.equal(crowded.stackHeight.montaje, 6);
assert.ok(crowded.overflow > 0);
assert.equal(layoutWarehouse([{ id: 'p', code: 'P', zone: '', capacity: 4, sku: 'X', qty: 2 }]).unplaced.length, 1);
console.log('OK: posiciones del plano, alturas de apilado, cuartos de palet y orden desde oficinas.');
