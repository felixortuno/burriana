'use client';
import { warehouseAreas, isWarehouseArea, type WarehouseArea } from '@/lib/areas';
import type { Location } from '@/lib/warehouse';
import { formatPallets } from '@/lib/warehouse-insights';

type Props = {
  locations: Location[];
  selected?: string;
  onSelect: (area: WarehouseArea) => void;
};

/** Plano 08 with the two zones of the app; picking a zone filters the blocks below. */
export default function WarehousePlan({ locations, selected, onSelect }: Props) {
  const unassigned = locations.filter(location => !isWarehouseArea(location.area)).length;
  return <section className="group" style={{ marginBottom: 20 }}>
    <div className="group-head"><div><h2>Zonas del plano</h2><p>Pulsa una zona para ver solo sus bloques.</p></div></div>
    <div className="plan">
      <div className="plan-drawing">
        <svg viewBox="0 0 2100 1200" role="img" aria-label="Plano 08: almacén de cartón arriba a la izquierda; montaje y almacenaje de cajas a la derecha y en la franja inferior, desde las oficinas hacia la izquierda.">
          <image href="/plano/carton-cajas.png" width="2100" height="1200" opacity="0.55"/>
          <path d="M35 35H852V594H35Z" fill="var(--planchas)" fillOpacity={selected === 'carton' ? 0.3 : 0.12} stroke="var(--planchas)" strokeWidth={selected === 'carton' ? 10 : 4} style={{ cursor: 'pointer' }} onClick={() => onSelect('carton')}/>
          <path d="M860 35H1929V1155H35V605H860Z" fill="var(--cajas)" fillOpacity={selected === 'montaje' ? 0.22 : 0.07} stroke="var(--cajas)" strokeWidth={selected === 'montaje' ? 10 : 4} style={{ cursor: 'pointer' }} onClick={() => onSelect('montaje')}/>
        </svg>
      </div>
      <div className="plan-zones">
        {warehouseAreas.map(area => {
          const blocks = locations.filter(location => location.area === area.value);
          return <button key={area.value} className="zone" aria-pressed={selected === area.value} onClick={() => onSelect(area.value)}>
            <span className={'dot ' + area.value}/>
            <span><b>{area.label}</b><small>{blocks.length} ubicaciones · {area.value === 'carton' ? 'planchas' : 'cajas montadas'}</small></span>
            <strong>{formatPallets(blocks.reduce((sum, location) => sum + location.qty, 0))}</strong>
          </button>;
        })}
        {unassigned > 0 && <p className="plan-source" style={{ color: 'var(--orange)', padding: '8px 12px' }}>{unassigned} ubicaciones sin zona asignada.</p>}
      </div>
    </div>
    <p className="plan-source">Plano 08, distribución proyectada de diciembre de 2022. Los palets y máquinas del dibujo no representan el inventario actual; la capacidad de cada bloque se valida en el almacén. Fuera del stock de la app: cerámica, oficinas, instalaciones y muelle.</p>
  </section>;
}
