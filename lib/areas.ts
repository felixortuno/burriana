export const warehouseAreas = [
  { value: 'carton', label: 'Almacén de cartón', prefix: 'CAR', description: 'Recinto situado a la izquierda de la zona de montaje.' },
  { value: 'montaje', label: 'Montaje y almacenaje de cajas', prefix: 'CAJ', description: 'Zona de montaje y espacio de almacenaje inferior contiguo.' },
] as const;
export type WarehouseArea = typeof warehouseAreas[number]['value'];
export function isWarehouseArea(value: unknown): value is WarehouseArea {
  return value === 'carton' || value === 'montaje';
}
export function areaName(value?: string) {
  return warehouseAreas.find(area => area.value === value)?.label ?? 'Pendiente de asignar zona';
}
