import { isWarehouseArea } from './areas.ts';
import type { Location, Product, State } from './warehouse.ts';

export type ProductKind = 'plancha' | 'caja' | 'otro';

/** Warehouse rule since 01/10/2026: keep at least 26 pallets of every plancha. */
export const PLANCHA_MINIMUM = 26;

/** Planchas and cajas of one model share the code; only the -PL / -CJ suffix differs. */
export function modelKey(sku: string) {
  return sku.replace(/-(PL|CJ)$/i, '');
}

export function productKind(product: Pick<Product, 'sku' | 'family'>): ProductKind {
  const family = product.family.toLocaleLowerCase('es');
  if (family.includes('plancha') && !family.includes('caja')) return 'plancha';
  if (family.includes('caja') && !family.includes('plancha')) return 'caja';
  if (/-PL$/i.test(product.sku)) return 'plancha';
  if (/-CJ$/i.test(product.sku)) return 'caja';
  return 'otro';
}

export function modelName(product: Pick<Product, 'name'>) {
  return product.name.replace(/\s*\((plancha|caja)\)\s*$/i, '');
}

export function stockBySku(state: Pick<State, 'locations'>) {
  const stock = new Map<string, number>();
  for (const location of state.locations) if (location.qty) stock.set(location.sku, (stock.get(location.sku) ?? 0) + location.qty);
  return stock;
}

/** Locations whose stock came in with a note asking to check the reading. */
export function locationsToReview(state: Pick<State, 'locations' | 'movements'>) {
  const codes = new Set(state.movements.filter(movement => /\bREVISAR\b/.test(movement.notes)).map(movement => movement.location));
  return new Set(state.locations.filter(location => location.qty > 0 && codes.has(location.code)).map(location => location.id));
}

export type ModelRow = {
  key: string;
  name: string;
  planchas: number;
  cajas: number;
  planchaSku?: string;
  cajaSku?: string;
};

/** One row per model with its planchas and cajas in pallets, largest stock first. */
export function modelSummary(state: Pick<State, 'products' | 'locations'>): ModelRow[] {
  const stock = stockBySku(state);
  const rows = new Map<string, ModelRow>();
  for (const product of state.products) {
    const key = modelKey(product.sku);
    const row = rows.get(key) ?? { key, name: modelName(product), planchas: 0, cajas: 0 };
    const kind = productKind(product);
    const qty = stock.get(product.sku) ?? 0;
    if (kind === 'plancha') { row.planchas += qty; row.planchaSku = product.sku; }
    else if (kind === 'caja') { row.cajas += qty; row.cajaSku = product.sku; }
    else row.cajas += qty;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.planchas + b.cajas - (a.planchas + a.cajas) || a.name.localeCompare(b.name, 'es'));
}

const quarter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
/** Pallets are counted in quarters: 22,5 or 6,75. */
export function formatPallets(value: number) {
  return quarter.format(value);
}

type Stock = Pick<State, 'products' | 'locations'>;

/** The caja of the same model as a plancha, when the catalogue has one. */
export function pairedCaja(state: Pick<State, 'products'>, planchaSku: string) {
  const key = modelKey(planchaSku);
  return state.products.find(product => product.sku !== planchaSku && modelKey(product.sku) === key && productKind(product) === 'caja');
}

/** Where to take a plancha from: its stocked blocks, fullest first; empty cardboard blocks if it has none. */
export function planchaSources(state: Pick<State, 'locations'>, sku: string): Location[] {
  const stocked = state.locations.filter(location => location.sku === sku && location.qty > 0).sort((a, b) => b.qty - a.qty);
  if (stocked.length) return stocked;
  return state.locations.filter(location => location.area === 'carton' && !location.qty).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

/** Where produced cajas can go: blocks already holding them, then free assembly blocks, most room first. */
export function cajaDestinations(state: Pick<State, 'locations'>, sku: string, exclude = ''): Location[] {
  const rank = (location: Location) => [location.sku === sku && location.qty > 0 ? 0 : 1, location.area === 'montaje' ? 0 : 1, -(location.capacity - location.qty)];
  return state.locations
    .filter(location => isWarehouseArea(location.area) && location.code !== exclude && (!location.qty || location.sku === sku))
    .sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.code.localeCompare(b.code, 'es', { numeric: true }); });
}

/** Choosing a plancha fills in its caja and both blocks; quantities are left to the person. */
export function linkPlancha(state: Stock, planchaSku: string) {
  const inputLocation = planchaSources(state, planchaSku)[0]?.code ?? '';
  const outputSku = pairedCaja(state, planchaSku)?.sku ?? '';
  const outputLocation = outputSku ? cajaDestinations(state, outputSku, inputLocation)[0]?.code ?? '' : '';
  return { inputSku: planchaSku, inputLocation, outputSku, outputLocation };
}

/**
 * How a pallet of assembled boxes is built in Burriana: layers of 5 boxes, 3 along
 * the top and 2 across, 10 or 11 layers high. With 60×40 boxes that is a 1.2 × 1.0 m
 * footprint. Without a figure for the model, 10 layers (50 boxes) are assumed.
 */
export const BOXES_PER_LAYER = 5;
export const DEFAULT_LAYERS = 10;
export const DEFAULT_BOXES_PER_PALLET = BOXES_PER_LAYER * DEFAULT_LAYERS;

/** Box length, width and height in centimetres, read from the model code (60X40X14). */
export function boxDimensions(sku: string) {
  const match = /(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/i.exec(sku);
  if (!match) return null;
  const [a, b, height] = match.slice(1, 4).map(Number);
  return { length: Math.max(a, b), width: Math.min(a, b), height };
}

export function boxesPerPallet(product?: Pick<Product, 'boxesPerPallet'>) {
  return { boxes: product?.boxesPerPallet ?? DEFAULT_BOXES_PER_PALLET, estimated: !product?.boxesPerPallet };
}

/** Approximate size of one loaded pallet in metres, without the wooden base. */
export function palletShape(product: Pick<Product, 'sku' | 'boxesPerPallet'>) {
  const box = boxDimensions(product.sku) ?? { length: 60, width: 40, height: 15 };
  const { boxes, estimated } = boxesPerPallet(product);
  const layers = boxes / BOXES_PER_LAYER;
  return {
    width: Math.max(3 * box.width, 2 * box.length) / 100,
    depth: (box.length + box.width) / 100,
    height: (layers * box.height) / 100,
    layers,
    boxes,
    estimated,
  };
}
