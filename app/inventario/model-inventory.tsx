'use client';

import { Fragment, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Download, PackageSearch, Pencil, Plus, Search, TriangleAlert, X } from 'lucide-react';
import { inventoryModels, inventoryTotals, type InventoryModel } from '@/lib/inventory-models';
import { boxesPerPallet, formatPallets, productKind, stockBySku } from '@/lib/warehouse-insights';
import type { Product, State } from '@/lib/warehouse';
import './model-inventory.css';

type Props = {
  data: State;
  search: string;
  onSearch: (value: string) => void;
  onNew: () => void;
  onEdit: (product: Product) => void;
  onMove: (kind: 'entrada' | 'salida', sku: string) => void;
  onHistory: (sku: string) => void;
};
type Filter = 'todos' | 'bajo' | 'sin-cajas' | 'sin-stock';
type Sort = 'modelo' | 'reposicion' | 'planchas' | 'cajas';
const kindNames = { plancha: 'Planchas', caja: 'Cajas', otro: 'Otros' };
const units = (value: number) => value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
const minimum = (products: Product[]) => products.reduce((sum, product) => sum + product.minimum, 0);
/** Pallets on one scale for every model, with a tick where the minimum sits. */
function QtyBar({ value, min, max, tone }: { value: number; min: number; max: number; tone: 'planchas' | 'cajas' }) {
  return <span className={'qty-bar ' + tone} aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, value / max)})` }}/>{min > 0 && <em style={{ left: `${Math.min(100, (min / max) * 100)}%` }}/>}</span>;
}

function exportModels(rows: InventoryModel[]) {
  const cells: unknown[][] = [
    ['Modelo', 'Código', 'Planchas (palets)', 'Cajas (palets)', 'Cajas (unidades)', 'Unidades estimadas', 'Otros (palets)', 'Faltan planchas (palets)', 'Faltan cajas (palets)', 'Faltan otros (palets)'],
    ...rows.map(row => [row.name, row.key, row.planchas, row.cajas, row.boxUnits, row.boxUnitsEstimated ? 'Sí' : 'No', row.otros, row.shortages.plancha, row.shortages.caja, row.shortages.otro]),
  ];
  const content = '\uFEFF' + cells.map(row => row.map(value => {
    let cell = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'inventario-por-modelo.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ModelInventory({ data, search, onSearch, onNew, onEdit, onMove, onHistory }: Props) {
  const models = useMemo(() => inventoryModels(data), [data]);
  const totals = useMemo(() => inventoryTotals(models), [models]);
  const stock = useMemo(() => stockBySku(data), [data]);
  const [filter, setFilter] = useState<Filter>('todos');
  const [sort, setSort] = useState<Sort>('modelo');
  const [expanded, setExpanded] = useState<string | null>(null);
  const term = search.trim().toLocaleLowerCase('es');
  const withoutBoxes = (row: InventoryModel) => row.cajaProducts.length > 0 && row.cajas === 0;
  const counts: Record<Filter, number> = { todos: models.length, bajo: totals.belowMinimum, 'sin-cajas': models.filter(withoutBoxes).length, 'sin-stock': totals.noStock };
  const rows = models.filter(row => (!term || `${row.name} ${row.key} ${row.products.map(product => `${product.sku} ${product.name} ${product.family}`).join(' ')}`.toLocaleLowerCase('es').includes(term)) &&
    (filter === 'todos' || (filter === 'bajo' ? row.belowMinimum : filter === 'sin-cajas' ? withoutBoxes(row) : row.noStock)))
    .sort((a, b) => (sort === 'reposicion' ? b.shortages.total - a.shortages.total : sort === 'planchas' ? b.planchas - a.planchas : sort === 'cajas' ? b.boxUnits - a.boxUnits : 0) || a.name.localeCompare(b.name, 'es', { numeric: true }));
  const otherProducts = models.flatMap(row => row.otherProducts);
  const scale = Math.max(1, ...models.map(row => Math.max(row.planchas, row.cajas, minimum(row.planchaProducts), minimum(row.cajaProducts))));

  return <div className="model-inventory">
    <div className="summary inventory-totals" aria-label="Totales del inventario">
      <div className="figure"><small>Modelos en catálogo</small><strong>{totals.models}</strong><span>{data.products.length} referencias · {totals.models - totals.noStock} modelos con stock</span></div>
      <div className="figure"><small><span className="dot planchas"/> Planchas disponibles</small><strong>{formatPallets(totals.planchas)}<span>palets</span></strong><span>Materia prima para producción</span></div>
      <div className="figure"><small><span className="dot cajas"/> Cajas montadas</small><strong>{totals.boxUnitsEstimated ? '≈ ' : ''}{units(totals.boxUnits)}</strong><span>unidades · {formatPallets(totals.cajas)} palets</span></div>
      <button className={'figure inventory-shortage' + (totals.belowMinimum ? ' has-shortage' : '')} onClick={() => setFilter(filter === 'bajo' ? 'todos' : 'bajo')} aria-pressed={filter === 'bajo'}><small>Modelos bajo mínimo</small><strong>{totals.belowMinimum}</strong><span>{totals.belowMinimum ? 'Ver qué hace falta reponer →' : 'Todos los mínimos cubiertos'}</span></button>
    </div>

    <section className="group model-catalog">
      <div className="group-head"><div><h2>Stock por modelo</h2><p>Planchas y cajas del mismo modelo, juntas. Abre el detalle para gestionar cada referencia.</p></div><button className="btn secondary" onClick={onNew}><Plus size={15}/> Referencia</button></div>
      <div className="model-tools">
        <label className="search-field"><Search size={16}/><input aria-label="Buscar modelo, medida o referencia" placeholder="Buscar modelo, medida o referencia…" value={search} onChange={event => onSearch(event.target.value)}/>{search && <button className="icon-btn" aria-label="Borrar búsqueda de modelos" onClick={() => onSearch('')}><X size={14}/></button>}</label>
        <label className="model-sort"><span>Ordenar por</span><select value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="modelo">Modelo A–Z</option><option value="reposicion">Mayor falta de stock</option><option value="planchas">Más planchas</option><option value="cajas">Más cajas (unidades)</option></select></label>
      </div>
      <div className="model-filters" role="group" aria-label="Filtrar modelos">{([['todos', 'Todos'], ['bajo', 'Bajo mínimo'], ['sin-cajas', 'Sin cajas'], ['sin-stock', 'Sin stock']] as [Filter, string][]).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<b>{counts[value]}</b></button>)}</div>

      {rows.length ? <div className="table-wrap model-table-wrap"><table className="table model-table"><caption className="sr-only">Inventario agrupado por modelo. Planchas y cajas se muestran en palets; unidades indica las cajas montadas.</caption><thead><tr>
        <th scope="col">Modelo / medida</th><th scope="col" className="right"><span className="dot planchas"/> Planchas <small>palets</small></th><th scope="col" className="right"><span className="dot cajas"/> Cajas <small>palets</small></th><th scope="col" className="right">Cajas <small>unidades</small></th>{otherProducts.length > 0 && <th scope="col" className="right">Otros <small>palets</small></th>}<th scope="col">Estado del stock</th>
      </tr></thead><tbody>{rows.map(row => <Fragment key={row.key}>
        <tr className={expanded === row.key ? 'model-selected' : ''}>
          <td><button className="model-name" aria-expanded={expanded === row.key} aria-controls={`model-${row.key}`} onClick={() => setExpanded(expanded === row.key ? null : row.key)}><ChevronDown size={15}/><span><b>{row.name}</b><small>{row.key}</small></span></button></td>
          <td className={'right num model-quantity' + (row.shortages.plancha ? ' below' : '')}>{row.planchaProducts.length ? <><b>{formatPallets(row.planchas)}</b><QtyBar value={row.planchas} min={minimum(row.planchaProducts)} max={scale} tone="planchas"/><small>{minimum(row.planchaProducts) ? `mín. ${formatPallets(minimum(row.planchaProducts))}` : 'sin mínimo'}</small></> : <span aria-label="Sin referencia de planchas">—</span>}</td>
          <td className={'right num model-quantity' + (row.shortages.caja ? ' below' : '')}>{row.cajaProducts.length ? <><b>{formatPallets(row.cajas)}</b><QtyBar value={row.cajas} min={minimum(row.cajaProducts)} max={scale} tone="cajas"/><small>{minimum(row.cajaProducts) ? `mín. ${formatPallets(minimum(row.cajaProducts))}` : 'sin mínimo'}</small></> : <span aria-label="Sin referencia de cajas">—</span>}</td>
          <td className="right num model-units">{row.cajaProducts.length ? <><b>{row.boxUnitsEstimated ? '≈ ' : ''}{units(row.boxUnits)}</b>{row.boxUnitsEstimated && <small>estimadas</small>}</> : '—'}</td>
          {otherProducts.length > 0 && <td className="right num">{row.otherProducts.length ? formatPallets(row.otros) : '—'}</td>}
          <td><span className={'pill ' + (row.belowMinimum ? 'orange' : row.noStock ? '' : 'green')}>{row.belowMinimum ? <><TriangleAlert size={12}/>Reponer</> : row.noStock ? 'Sin stock' : <><Check size={12}/>En stock</>}</span><small>{row.belowMinimum ? `Faltan ${formatPallets(row.shortages.total)} palets para mínimos` : row.noStock ? 'Sin existencias registradas' : 'Mínimos cubiertos'}</small></td>
        </tr>
        {expanded === row.key && <tr className="model-detail"><td colSpan={otherProducts.length ? 6 : 5}><div id={`model-${row.key}`} className="model-detail-content"><p>Referencias de {row.name}</p>{row.products.map(product => {
          const qty = stock.get(product.sku) ?? 0;
          const kind = productKind(product);
          const conversion = boxesPerPallet(product);
          const deficit = Math.max(0, product.minimum - qty);
          return <div className="model-reference" key={product.id}>
            <div className="model-reference-name"><span className={'pill ' + (kind === 'plancha' ? 'planchas' : kind === 'caja' ? 'cajas' : '')}>{kindNames[kind]}</span><b>{product.name}</b><small className="mono">{product.sku}</small></div>
            <div className="model-reference-stock"><b>{formatPallets(qty)} palets</b><small>{kind === 'caja' ? `${conversion.estimated && qty > 0 ? '≈ ' : ''}${units(qty * conversion.boxes)} cajas · ${conversion.boxes}/palet${conversion.estimated ? ' estimadas' : ''}` : `Mínimo: ${formatPallets(product.minimum)} palets`}</small><small className={deficit ? 'below' : ''}>{deficit ? `Reponer ${formatPallets(deficit)} palets` : kind === 'caja' ? `Mínimo: ${formatPallets(product.minimum)} palets` : 'Mínimo cubierto'}</small></div>
            <div className="model-reference-actions"><button className="btn secondary" onClick={() => onMove('entrada', product.sku)}><ArrowDownLeft size={14}/> Entrada</button><button className="btn secondary" disabled={!qty} onClick={() => onMove('salida', product.sku)}><ArrowUpRight size={14}/> Salida</button><button className="icon-btn" aria-label={`Editar ${product.sku}`} title="Editar referencia y mínimo" onClick={() => onEdit(product)}><Pencil size={15}/></button><button className="link" onClick={() => onHistory(product.sku)}>Historial</button></div>
          </div>;
        })}</div></td></tr>}
      </Fragment>)}</tbody></table></div> : <div className="empty"><PackageSearch size={30} strokeWidth={1.5}/><h3>{models.length ? 'No hay modelos en esta selección' : 'Tu inventario, modelo a modelo'}</h3><p>{models.length ? 'Prueba otro modelo, medida o filtro.' : 'Añade tus referencias de planchas y cajas para empezar a controlar sus cantidades.'}</p>{models.length ? <button className="btn secondary" onClick={() => { onSearch(''); setFilter('todos'); }}>Ver todos los modelos</button> : <button className="btn primary" onClick={onNew}><Plus size={15}/> Añadir referencia</button>}</div>}
      <div className="group-foot model-catalog-foot"><span>{rows.length} de {models.length} modelos · Cantidades en palets, admite cuartos.</span><button className="btn plain" disabled={!rows.length} onClick={() => exportModels(rows)}><Download size={14}/> Exportar selección</button></div>
    </section>
    <p className="model-footnote">Las unidades de cajas se calculan con las cajas por palet de cada referencia. «≈» indica una estimación cuando falta ese dato.{otherProducts.length > 0 && ` Otros materiales: ${formatPallets(totals.otros)} palets, separados de planchas y cajas.`}</p>
  </div>;
}
