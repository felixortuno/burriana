import type { Product, State } from './warehouse.ts';

export type ProductKind = 'plancha' | 'caja' | 'otro';

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
