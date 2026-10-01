import { boxesPerPallet, modelKey, modelName, productKind, stockBySku } from './warehouse-insights.ts';
import type { Product, State } from './warehouse.ts';

export type InventoryShortages = {
  plancha: number;
  caja: number;
  otro: number;
  total: number;
};

export type InventoryModel = {
  key: string;
  name: string;
  products: Product[];
  planchaProducts: Product[];
  cajaProducts: Product[];
  otherProducts: Product[];
  planchas: number;
  cajas: number;
  otros: number;
  totalPallets: number;
  boxUnits: number;
  boxUnitsEstimated: boolean;
  shortages: InventoryShortages;
  belowMinimum: boolean;
  noStock: boolean;
};

export type InventoryTotals = {
  models: number;
  planchas: number;
  cajas: number;
  otros: number;
  totalPallets: number;
  boxUnits: number;
  boxUnitsEstimated: boolean;
  belowMinimum: number;
  noStock: number;
  shortages: InventoryShortages;
};

const emptyShortages = (): InventoryShortages => ({ plancha: 0, caja: 0, otro: 0, total: 0 });

/** Model totals span every location; minimums are evaluated for each reference. */
export function inventoryModels(state: Pick<State, 'products' | 'locations'>): InventoryModel[] {
  const stock = stockBySku(state);
  const models = new Map<string, InventoryModel>();

  for (const product of state.products) {
    const key = modelKey(product.sku);
    const row: InventoryModel = models.get(key) ?? {
      key,
      name: modelName(product),
      products: [],
      planchaProducts: [],
      cajaProducts: [],
      otherProducts: [],
      planchas: 0,
      cajas: 0,
      otros: 0,
      totalPallets: 0,
      boxUnits: 0,
      boxUnitsEstimated: false,
      shortages: emptyShortages(),
      belowMinimum: false,
      noStock: true,
    };
    const qty = stock.get(product.sku) ?? 0;
    const kind = productKind(product);
    row.products.push(product);
    row.totalPallets += qty;

    if (kind === 'plancha') {
      row.planchaProducts.push(product);
      row.planchas += qty;
    } else if (kind === 'caja') {
      const conversion = boxesPerPallet(product);
      row.cajaProducts.push(product);
      row.cajas += qty;
      row.boxUnits += qty * conversion.boxes;
      // A missing conversion on an empty reference does not make stocked units estimated.
      row.boxUnitsEstimated ||= qty > 0 && conversion.estimated;
    } else {
      row.otherProducts.push(product);
      row.otros += qty;
    }

    // Surplus stock of another reference must not conceal a reference below minimum.
    const shortage = Math.max(0, product.minimum - qty);
    row.shortages[kind] += shortage;
    row.shortages.total += shortage;
    row.belowMinimum ||= shortage > 0;
    row.noStock = row.totalPallets === 0;
    models.set(key, row);
  }

  return [...models.values()].sort((a, b) => b.totalPallets - a.totalPallets || a.name.localeCompare(b.name, 'es') || a.key.localeCompare(b.key, 'es'));
}

/** Totals use the same rows as the inventory to keep cards and table consistent. */
export function inventoryTotals(models: readonly InventoryModel[]): InventoryTotals {
  return models.reduce<InventoryTotals>((totals, model) => {
    totals.models += 1;
    totals.planchas += model.planchas;
    totals.cajas += model.cajas;
    totals.otros += model.otros;
    totals.totalPallets += model.totalPallets;
    totals.boxUnits += model.boxUnits;
    totals.boxUnitsEstimated ||= model.boxUnitsEstimated;
    totals.belowMinimum += Number(model.belowMinimum);
    totals.noStock += Number(model.noStock);
    totals.shortages.plancha += model.shortages.plancha;
    totals.shortages.caja += model.shortages.caja;
    totals.shortages.otro += model.shortages.otro;
    totals.shortages.total += model.shortages.total;
    return totals;
  }, {
    models: 0,
    planchas: 0,
    cajas: 0,
    otros: 0,
    totalPallets: 0,
    boxUnits: 0,
    boxUnitsEstimated: false,
    belowMinimum: 0,
    noStock: 0,
    shortages: emptyShortages(),
  });
}
