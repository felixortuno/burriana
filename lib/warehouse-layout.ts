import type { WarehouseArea } from './areas.ts';
import type { Location } from './warehouse.ts';

/**
 * Places the stock of each location on the pallet positions drawn in plano 08.
 * The result is orientative: blocks are laid out in order inside their zone, not
 * at a surveyed position. Plan coordinates are pixels of the 2000×1143 drawing;
 * one pallet square measures 26 px, which is taken as 1.2 m.
 */
export const PLAN_SCALE = 1.2 / 26;
const SLOT = 26;
export const PLAN_SIZE = { width: 1980, depth: 1130 };

type Rect = { x: number; y: number; w: number; h: number };
export type Slot = Rect & { area: WarehouseArea; index: number };
export type Stack = {
  locationId: string;
  code: string;
  sku: string;
  area: WarehouseArea;
  slot: Slot;
  /** Fill of each level from the floor up: 1 is a full pallet, 0.5 half a pallet. */
  levels: number[];
};
export type WarehouseLayout = {
  slots: Slot[];
  stacks: Stack[];
  stackHeight: Record<WarehouseArea, number>;
  /** Stacks that did not fit in the zone and were placed in the open floor near the machines. */
  overflow: number;
  /** Stacks that fit nowhere on the drawing and are left out of the view. */
  hidden: number;
  /** Floor positions used per zone, overflow included. */
  positions: Record<WarehouseArea, number>;
  unplaced: Location[];
};

/** Pallets are stored two high everywhere in the building. */
export const STACK_HEIGHT = 2;

const range = (count: number, start: number, step: number) => Array.from({ length: count }, (_, i) => start + i * step);

/** Cardboard store: the walled square at the top left, two blocks of 7 rows. */
const cartonColumns = [35, 125, 155, 296, 326, 417, 447, 538, 568, 659, 689, 779];
const cartonRows = [...range(7, 40, 30.5), ...range(7, 353, 30.5)];
/** Assembled boxes: the bottom strip, 12 rows deep. */
const cajasColumns = [35, 147, 177, 290, 320, 432, 462, 575, 605, 817, 847, 959, 989, 1101, 1131, 1244, 1274, 1387, 1417, 1529, 1559, 1672, 1702];
const cajasRows = range(12, 741, 30.3);
/** Open floor left of the assembly machines, used only when a zone is full. */
const overflowColumns = range(8, 880, 30);
const overflowRows = range(16, 60, 30.5);

function grid(area: WarehouseArea, columns: number[], rows: number[]): Slot[] {
  const slots: Slot[] = [];
  for (const x of columns) for (const y of rows) slots.push({ x, y, w: SLOT, h: SLOT, area, index: slots.length });
  return slots;
}

export const cartonSlots = grid('carton', cartonColumns, cartonRows);
/** Filled from the offices (right) towards the bottom-left corner. */
export const cajasSlots = grid('montaje', [...cajasColumns].reverse(), cajasRows);
const overflowSlots = grid('montaje', overflowColumns, overflowRows);

/** Splits a quantity into stacks of at most `height` levels; the last level may be partial. */
export function stackLevels(qty: number, height: number): number[][] {
  const stacks: number[][] = [];
  let remaining = qty;
  while (remaining > 0) {
    const levels: number[] = [];
    while (remaining > 0 && levels.length < height) {
      const level = Math.min(1, remaining);
      levels.push(level);
      remaining = Math.round((remaining - level) * 4) / 4;
    }
    stacks.push(levels);
  }
  return stacks;
}

const byCode = (a: Location, b: Location) => a.code.localeCompare(b.code, 'es', { numeric: true });

function placeArea(area: WarehouseArea, locations: Location[], slots: Slot[], usedOverflow: { next: number }) {
  const stacks: Stack[] = [];
  let next = 0;
  let overflow = 0;
  let hidden = 0;
  for (const location of [...locations].sort(byCode)) {
    for (const levels of stackLevels(location.qty, STACK_HEIGHT)) {
      let slot = slots[next++];
      if (!slot) {
        slot = overflowSlots[usedOverflow.next++];
        if (!slot) { hidden++; continue; }
        overflow++;
      }
      stacks.push({ locationId: location.id, code: location.code, sku: location.sku, area, slot, levels });
    }
  }
  return { stacks, overflow, hidden };
}

export function layoutWarehouse(locations: Location[]): WarehouseLayout {
  const stocked = locations.filter(location => location.qty > 0);
  const carton = stocked.filter(location => location.area === 'carton');
  const montaje = stocked.filter(location => location.area === 'montaje');
  const usedOverflow = { next: 0 };
  const a = placeArea('carton', carton, cartonSlots, usedOverflow);
  const b = placeArea('montaje', montaje, cajasSlots, usedOverflow);
  return {
    slots: [...cartonSlots, ...cajasSlots],
    stacks: [...a.stacks, ...b.stacks],
    stackHeight: { carton: STACK_HEIGHT, montaje: STACK_HEIGHT },
    overflow: a.overflow + b.overflow,
    hidden: a.hidden + b.hidden,
    positions: { carton: a.stacks.length, montaje: b.stacks.length },
    unplaced: stocked.filter(location => location.area !== 'carton' && location.area !== 'montaje'),
  };
}

/** Fixed elements of plano 08, in plan pixels. Heights are in metres. */
export const planFeatures = {
  outer: { x: 25, y: 25, w: 1930, h: 1083 },
  /** Cardboard store walls as segments; gaps are the doors of the drawing. */
  cartonWalls: [
    [28, 28, 815, 28], [28, 28, 28, 572], [815, 28, 815, 248], [815, 345, 815, 572],
    [28, 572, 195, 572], [282, 572, 815, 572],
  ] as [number, number, number, number][],
  offices: { x: 1843, y: 655, w: 112, h: 450, height: 3 },
  machines: [
    { x: 1148, y: 371, w: 44, h: 130, height: 1.6 }, { x: 1213, y: 371, w: 44, h: 86, height: 1.6 },
    { x: 1278, y: 371, w: 44, h: 86, height: 1.6 }, { x: 1473, y: 371, w: 44, h: 86, height: 1.6 },
    { x: 1537, y: 371, w: 44, h: 86, height: 1.6 }, { x: 1602, y: 371, w: 44, h: 86, height: 1.6 },
    { x: 1667, y: 371, w: 44, h: 86, height: 1.6 }, { x: 1732, y: 371, w: 44, h: 86, height: 1.6 },
    { x: 1648, y: 62, w: 43, h: 50, height: 2.2 }, { x: 1760, y: 62, w: 58, h: 60, height: 2.2 },
  ],
  pillars: [{ x: 1069, y: 567 }, { x: 1328, y: 567 }, { x: 1587, y: 567 }],
  docks: [{ x: 1893, y: 492, w: 64, h: 43 }, { x: 1893, y: 600, w: 64, h: 43 }],
  labels: {
    carton: { x: 420, y: 300 },
    montaje: { x: 1000, y: 680 },
    offices: { x: 1899, y: 880 },
  },
};
