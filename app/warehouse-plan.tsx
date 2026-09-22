'use client';
import { Map, ArrowUpRight } from 'lucide-react';
import { warehouseAreas, isWarehouseArea, type WarehouseArea } from '@/lib/areas';
import type { Location } from '@/lib/warehouse';

type Props = {
  locations: Location[];
  selected?: string;
  compact?: boolean;
  onSelect: (area: WarehouseArea) => void;
};
export default function WarehousePlan({ locations, selected, compact = false, onSelect }: Props) {
  const unassigned = locations.filter(location => !isWarehouseArea(location.area)).length;
  return <section className={'panel warehouse-plan ' + (compact ? 'plan-compact' : '')}>
    <div className="panel-heading"><div><span className="eyebrow">ÁMBITO DE TRABAJO</span><h2>Cartón y cajas</h2><p>Dos zonas del plano de distribución de la nave.</p></div><Map size={22}/></div>
    <div className="blueprint">
      <svg viewBox="0 0 2100 1200" role="img" aria-label="Detalle del plano: almacén de cartón a la izquierda, montaje y almacenaje de cajas a la derecha y en la franja inferior. El muelle y las oficinas quedan fuera del ámbito de stock.">
        <image href="/plano/carton-cajas.png" width="2100" height="1200"/>
        <path d="M0 0H2100V1200H0Z M32 32V1160H1935V32Z" fill="#f4f7f5" fillOpacity="0.94" fillRule="evenodd"/>
        <path d="M35 35H852V594H35Z" fill="#168769" fillOpacity={selected === 'carton' ? .22 : .08} stroke="#168769" strokeWidth={selected === 'carton' ? 10 : 5}/>
        <path d="M860 35H1929V1155H35V605H860Z" fill="#b88726" fillOpacity={selected === 'montaje' ? .22 : .07} stroke="#b88726" strokeWidth={selected === 'montaje' ? 10 : 5}/>
      </svg>
    </div>
    <div className="plan-zones">{warehouseAreas.map(area => {
      const blocks = locations.filter(location => location.area === area.value);
      return <button key={area.value} className={'plan-zone ' + area.value} aria-pressed={selected === area.value} onClick={() => onSelect(area.value)}>
        <span className="zone-caption"><span className="zone-dot"/>{area.label}<ArrowUpRight size={16}/></span>
        <span className="zone-summary"><b>{blocks.reduce((sum, location) => sum + location.qty, 0)}</b> palets <span>· {blocks.length} ubicaciones</span></span>
      </button>;
    })}</div>
    <div className="plan-source"><b>Plano 08 · distribución proyectada · diciembre de 2022</b><span>Los símbolos de palets y máquinas pertenecen al plano; no representan el inventario actual. La capacidad de cada bloque se valida en el almacén.</span>{!compact&&<span>Fuera del stock de la app: exposición y material cerámico, oficinas, instalaciones y muelle de carga. Mantener libres pasos, accesos y zonas de maquinaria.</span>}{unassigned>0&&<span className="pending-area">{unassigned} ubicaciones anteriores pendientes de asignar a una de estas zonas.</span>}</div>
  </section>;
}
