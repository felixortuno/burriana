"use client";
import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Boxes, Check, ChevronRight, ClipboardCheck, Download, Pencil, Plus, Printer, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { madridDay, checklist, type State, type Product, type Location, type Movement } from '@/lib/warehouse';
import { useWarehouse } from '@/hooks/use-warehouse';
import type { PublicUser } from '@/lib/identity';
import { warehouseAreas, areaName, isWarehouseArea } from '@/lib/areas';
import { boxesPerPallet, formatPallets, locationsToReview, modelKey, modelName, palletShape, PLANCHA_MINIMUM, productKind, stockBySku } from '@/lib/warehouse-insights';
import { layoutWarehouse, STACK_HEIGHT } from '@/lib/warehouse-layout';
import AppShell, { inventoryViews, type InventoryView } from '../components/app-shell';
import { useAppReady } from '../components/app-loader';
import type { CameraPreset, ColorMode } from '../components/warehouse-3d';
import WarehousePlan from '../warehouse-plan';
import ReferencePhoto from '../reference-photo';
import ModelInventory from './model-inventory';

const Warehouse3D = dynamic(() => import('../components/warehouse-3d'), { ssr: false, loading: () => <div className="w3d-fallback">Preparando la nave…</div> });

const views = inventoryViews.map(item => item.view);
const headings: Record<InventoryView, [string, string]> = {
  resumen: ['Inventario por modelo', 'Cuánto tienes, de qué modelo y qué necesitas reponer.'],
  '3d': ['Vista 3D', 'Cada bloque es un palet. Arrastra para girar, usa la rueda o los dedos para acercar y pulsa un bloque para ver su detalle.'],
  referencias: ['Referencias', 'El catálogo de planchas, cajas y materiales con sus cantidades y mínimos.'],
  ubicaciones: ['Ubicaciones', 'Los bloques de cada zona del plano y lo que contienen. Una referencia por bloque.'],
  movimientos: ['Movimientos', 'Entradas, salidas, traslados y producción, con un responsable en cada registro.'],
  '5s': ['Plan 5S', 'Organizar hoy para trabajar mejor mañana.'],
  cierre: ['Cierre de turno', 'La revisión de fin de turno, firmada cada día.'],
  protocolo: ['Protocolo', 'Normas de recepción, almacenamiento y expedición del equipo.'],
};
const movementNames: Record<Movement['kind'], string> = { entrada: 'Entrada', salida: 'Salida', traslado: 'Traslado', consumo: 'Consumo', produccion: 'Producción', ajuste: 'Ajuste' };
const movementTone: Record<Movement['kind'], string> = { entrada: 'green', salida: 'orange', traslado: 'blue', consumo: 'planchas', produccion: 'cajas', ajuste: 'orange' };
const boxCount = (value: number, estimated: boolean) => `${estimated ? '≈ ' : ''}${value.toLocaleString('es-ES', { maximumFractionDigits: 2 })} cajas`;
const displayDate = (d: string) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(d));
const longDate = (day: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(day + 'T12:00:00Z'));

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Choice({ label, value, onChange, options, required = true }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; required?: boolean }) {
  return <label className="field"><span>{label}</span><select required={required} value={value} onChange={e => onChange(e.target.value)}><option value="" disabled>Seleccionar…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
function Tick({ checked, onChange, children, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return <label className="tick"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}/><span>{children}</span></label>;
}
function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}</div>;
}
function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="search-field"><Search size={15}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/>{value && <button type="button" className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Borrar búsqueda" onClick={() => onChange('')}><X size={13}/></button>}</label>;
}
function Empty({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) { return <div className="empty"><Boxes size={30} strokeWidth={1.5}/><h3>{title}</h3><p>{detail}</p>{children}</div>; }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function csv(rows: unknown[][]) { return '﻿' + rows.map(r => r.map(v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(';')).join('\r\n'); }
const emptyForm = () => ({ id: '', sku: '', name: '', family: 'Planchas', minimum: PLANCHA_MINIMUM, boxesPerPallet: 0, code: '', zone: '', area: '', capacity: 1, title: '', owner: '', due: '', done: false, kind: 'entrada', qty: 1, location: '', destination: '', operator: '', document: '', notes: '', stacked: false, safe: false, labelled: false, verified: false });
type InventoryForm = ReturnType<typeof emptyForm>;

export default function Inventory({ user }: { user: PublicUser }) {
  const { data, revision, loading, error, busy, updatedAt, refresh, save: saveWarehouse } = useWarehouse();
  useAppReady(!loading);
  const params = useSearchParams();
  const requested = params.get('vista') as InventoryView | null;
  const view: InventoryView = requested && views.includes(requested) ? requested : 'resumen';
  const selectedLocation = params.get('ubicacion');
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [filter, setFilter] = useState(() => params.get('filtro') ?? 'todos');
  const [areaFilter, setAreaFilter] = useState('todos');
  const queryKey = `${view}|${params.get('q') ?? ''}|${params.get('filtro') ?? ''}`;
  const [shownQuery, setShownQuery] = useState(queryKey);
  if (shownQuery !== queryKey) { setShownQuery(queryKey); setSearch(params.get('q') ?? ''); setFilter(params.get('filtro') ?? 'todos'); setAreaFilter('todos'); }
  const [colorMode, setColorMode] = useState<ColorMode>('tipo');
  const [preset, setPreset] = useState<CameraPreset>('perspectiva');
  const [presetNonce, setPresetNonce] = useState(0);
  const [modal, setModal] = useState(''), [form, setForm] = useState<InventoryForm>(emptyForm), [formError, setFormError] = useState('');
  const [today, setToday] = useState(''), [checks, setChecks] = useState<boolean[]>([false, false, false, false, false]), [notes, setNotes] = useState('');

  useEffect(() => {
    let day = ''; let active = true;
    const update = () => { const next = madridDay(); if (active && next !== day) { day = next; setToday(next); setChecks([false, false, false, false, false]); setNotes(''); } };
    Promise.resolve().then(update); const timer = setInterval(update, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => { const ctx = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => unknown } }).modelContext; if (!ctx?.registerTool) return; const control = new AbortController(); Promise.resolve(ctx.registerTool({ name: 'read_warehouse_stock', title: 'Consultar existencias', description: 'Devuelve las referencias y ubicaciones guardadas del almacén. No modifica datos.', inputSchema: { type: 'object', properties: { sku: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async (input: unknown) => { if (!input || typeof input !== 'object' || Object.keys(input).some(k => k !== 'sku') || ('sku' in input && typeof input.sku !== 'string')) throw new Error('Indica un SKU de texto o un objeto vacío.'); const res = await fetch('/api/warehouse', { cache: 'no-store' }); const r = await res.json() as { state: State; revision: number; error?: string }; if (!res.ok) throw new Error(r.error); const sku = (input as { sku?: string }).sku?.toUpperCase(); return { products: r.state.products.filter((p: Product) => !sku || p.sku === sku), locations: r.state.locations.filter((l: Location) => !sku || l.sku === sku) }; } }, { signal: control.signal })).catch(() => {}); return () => control.abort(); }, []);

  function go(next: InventoryView, extra = '') { window.history.pushState(null, '', (next === 'resumen' ? '/inventario' : `/inventario?vista=${next}`) + (extra ? (next === 'resumen' ? '?' : '&') + extra : '')); window.scrollTo({ top: 0 }); }
  function selectLocation(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('ubicacion', id); else next.delete('ubicacion');
    window.history.replaceState(null, '', `/inventario?${next.toString()}`);
  }
  async function save(action: Record<string, unknown>) { setFormError(''); try { if (!await saveWarehouse(action)) return false; toast.success('Guardado'); return true; } catch (e) { const msg = e instanceof Error ? e.message : 'No se ha podido guardar.'; setFormError(msg); toast.error(msg); return false; } }
  function open(type: string, record: Partial<InventoryForm> = {}) { setFormError(''); setModal(type); setForm({ ...emptyForm(), operator: user.name, area: isWarehouseArea(areaFilter) ? areaFilter : '', ...record }); }
  // A new plancha starts at the warehouse minimum; switching to cajas drops that default.
  function changeFamily(family: string) {
    setForm(prev => {
      const untouched = prev.minimum === 0 || prev.minimum === PLANCHA_MINIMUM;
      if (prev.id || !untouched) return { ...prev, family };
      return { ...prev, family, minimum: productKind({ sku: prev.sku, family }) === 'plancha' ? PLANCHA_MINIMUM : 0 };
    });
  }
  const f = <K extends keyof InventoryForm>(key: K, value: InventoryForm[K]) => setForm(prev => ({ ...prev, ...(['kind', 'sku', 'qty', 'location', 'destination', 'document', 'stacked'].includes(key) ? { safe: false, labelled: false, verified: false } : {}), [key]: value }));
  async function submit(e: FormEvent) { e.preventDefault(); if (await save({ ...form, id: form.id || undefined, type: modal })) setModal(''); }

  const stockMap = useMemo(() => stockBySku(data), [data]);
  const stock = (sku: string) => stockMap.get(sku) ?? 0;
  const review = useMemo(() => locationsToReview(data), [data]);
  const layout = useMemo(() => layoutWarehouse(data.locations), [data.locations]);
  const productBySku = useMemo(() => new Map(data.products.map(p => [p.sku, p])), [data.products]);
  const completed = data.tasks.filter(t => t.done).length;
  const closure = data.closures.find(c => c.day === today);
  const matches = (value: string) => value.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'));
  const products = data.products.filter(p => matches(p.sku + ' ' + p.name + ' ' + p.family) && (filter === 'todos' || (filter === 'bajo' ? stock(p.sku) < p.minimum : productKind(p) === filter)));
  const movements = data.movements.filter(m => matches(m.sku + ' ' + m.operator + ' ' + m.document + ' ' + m.location + ' ' + m.notes) && (filter === 'todos' || (filter === 'produccion' ? ['consumo', 'produccion'].includes(m.kind) : m.kind === filter)));
  const locations = data.locations.filter(l => matches(l.code + ' ' + l.zone + ' ' + l.sku + ' ' + (productBySku.get(l.sku)?.name ?? '')) && (filter === 'todos' || (filter === 'libres' ? l.qty === 0 : l.qty > 0)) && (areaFilter === 'todos' || (areaFilter === 'pendientes' ? !isWarehouseArea(l.area) : l.area === areaFilter)));
  const highlight = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    if (view !== '3d' || !term) return null;
    return new Set(data.locations.filter(l => `${l.code} ${l.sku} ${productBySku.get(l.sku)?.name ?? ''}`.toLocaleLowerCase('es').includes(term)).map(l => l.id));
  }, [view, search, data.locations, productBySku]);
  const disabled = loading || !!error;

  function exportInventory() { download('inventario-burriana.csv', csv([['SKU', 'Referencia', 'Familia', 'Palets', 'Mínimo', 'Faltan para mínimo', 'Cajas (unidades)', 'Unidades estimadas'], ...data.products.map(p => [p.sku, p.name, p.family, stock(p.sku), p.minimum, Math.max(0, p.minimum - stock(p.sku)), productKind(p) === 'caja' ? stock(p.sku) * boxesPerPallet(p).boxes : '', productKind(p) === 'caja' && stock(p.sku) > 0 && boxesPerPallet(p).estimated ? 'Sí' : 'No'])]), 'text/csv;charset=utf-8'); }

  const actions = [
    { label: 'Registrar movimiento', Icon: ArrowLeftRight, run: () => open('movement') },
    { label: 'Ver inventario por modelo', Icon: Boxes, run: () => go('resumen') },
    { label: 'Nueva referencia', Icon: Plus, run: () => open('product') },
    { label: 'Exportar inventario', hint: 'CSV', Icon: Download, run: exportInventory },
  ];

  const [title, subtitle] = headings[view];
  const headActions = view === 'referencias' ? <><button className="btn secondary" onClick={exportInventory} disabled={disabled}><Download size={15}/> Exportar</button><button className="btn primary" disabled={disabled} onClick={() => open('product')}><Plus size={16}/> Nueva referencia</button></>
    : view === 'ubicaciones' ? <button className="btn primary" disabled={disabled} onClick={() => open('location')}><Plus size={16}/> Nueva ubicación</button>
    : view === '5s' ? <button className="btn primary" disabled={disabled} onClick={() => open('task')}><Plus size={16}/> Nueva tarea</button>
    : view === 'cierre' || view === 'protocolo' ? <button className="btn secondary" onClick={() => window.print()}><Printer size={15}/> Imprimir</button>
    : <><button className="btn secondary" onClick={exportInventory} disabled={disabled}><Download size={15}/> Exportar</button><button className="btn primary" disabled={disabled} onClick={() => open('movement')}><Plus size={16}/> Registrar movimiento</button></>;

  return <AppShell user={user} active={`inventario:${view}`} data={data} sync={{ updatedAt, error, busy, refresh }} actions={actions}>
    <Toaster position="bottom-right"/>
    <header className="page-head">
      <div>{view === 'resumen' && today && <span className="date">{longDate(today)}</span>}<h1>{title}</h1><p>{subtitle}</p></div>
      <div className="page-actions">{headActions}</div>
    </header>
    {error && <div className="callout error banner" role="alert">{error}<button className="btn secondary" onClick={refresh}>Reintentar</button></div>}
    {loading ? <div className="loading" role="status">Cargando el almacén…</div> : error ? <div className="group"><Empty title="Datos no disponibles" detail="Pulsa «Reintentar» para recuperar el inventario guardado."/></div> : <>

    {view === 'resumen' && <>
      <ModelInventory key={queryKey} data={data} search={search} onSearch={setSearch} onNew={() => open('product')} onEdit={product => open('product', product)} onMove={(kind, sku) => {
        const location = [...data.locations].filter(item => item.sku === sku && item.qty > 0 && (kind === 'salida' || item.qty < item.capacity)).sort((a, b) => b.qty - a.qty)[0];
        open('movement', { kind, sku, location: location?.code ?? '' });
      }} onHistory={sku => go('movimientos', `q=${encodeURIComponent(sku)}`)}/>
      <section className="group">
        <div className="group-head"><div><h2>Últimos movimientos</h2><p>Entradas, salidas y producción del inventario.</p></div><button className="link" onClick={() => go('movimientos')}>Ver historial<ChevronRight size={15}/></button></div>
        {data.movements.length ? <ul className="list">{data.movements.slice(0, 4).map(m => <li key={m.id} className="row"><span className={'pill ' + movementTone[m.kind]}>{movementNames[m.kind]}</span><div className="row-main"><b>{productBySku.get(m.sku)?.name ?? m.sku}</b><small>{displayDate(m.date)} · {m.operator}</small></div><div className="row-end"><strong className="num">{formatPallets(m.qty)}</strong><span>palets</span></div></li>)}</ul> : <p className="quiet">Todavía no hay movimientos.</p>}
      </section>
    </>}

    {view === '3d' && <ThreeDView data={data} review={review} layout={layout} search={search} setSearch={setSearch} highlight={highlight} colorMode={colorMode} setColorMode={setColorMode} preset={preset} setPreset={p => { setPreset(p); setPresetNonce(n => n + 1); }} presetNonce={presetNonce} selected={selectedLocation} onSelect={selectLocation} productBySku={productBySku} stock={stock} onMove={l => open('movement', { kind: 'salida', sku: l.sku, location: l.code })} onEdit={l => open('location', l)} onHistory={l => go('movimientos', `q=${encodeURIComponent(l.code)}`)}/>}

    {view === 'referencias' && <section className="group">
      <div className="group-tools" style={{ paddingTop: 16 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Buscar SKU, nombre o familia"/>
        <Segmented label="Mostrar" value={filter} onChange={setFilter} options={[['todos', 'Todas'], ['plancha', 'Planchas'], ['caja', 'Cajas'], ['bajo', 'Bajo mínimo']]}/>
        <span className="count">{products.length} referencias</span>
      </div>
      {products.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Referencia</th><th>Tipo</th><th className="right">Palets</th><th className="right">Mínimo</th><th className="right">Para reponer</th><th/></tr></thead><tbody>{products.map(p => { const kind = productKind(p); const deficit = Math.max(0, p.minimum - stock(p.sku)); return <tr key={p.id}><td><b>{p.name}</b><small className="mono">{p.sku}</small></td><td>{kind === 'otro' ? <span className="pill">{p.family}</span> : <span className={'pill ' + (kind === 'plancha' ? 'planchas' : 'cajas')}>{kind === 'plancha' ? 'Plancha' : 'Caja'}</span>}</td><td className="right num"><b>{formatPallets(stock(p.sku))}</b>{kind === 'caja' && stock(p.sku) > 0 ? <small>{boxCount(stock(p.sku) * boxesPerPallet(p).boxes, boxesPerPallet(p).estimated)} · {boxesPerPallet(p).boxes}/palet</small> : null}</td><td className="right num">{formatPallets(p.minimum)}</td><td className="right num">{deficit ? <span className="pill orange">{formatPallets(deficit)} palets</span> : '—'}</td><td className="right"><button className="icon-btn" aria-label={'Editar ' + p.sku} onClick={() => open('product', p)}><Pencil size={15}/></button></td></tr>; })}</tbody></table></div>
        : <Empty title={search || filter !== 'todos' ? 'Sin coincidencias' : 'Tu catálogo empieza aquí'} detail="Añade cada referencia con un SKU único. El stock se calcula a partir de los movimientos."><button className="btn primary" onClick={() => open('product')}><Plus size={15}/> Añadir referencia</button></Empty>}
      <div className="group-foot">Unidad de stock: palets, en cuartos (por ejemplo 22,5 o 6,75).</div>
    </section>}

    {view === 'ubicaciones' && <>
      <WarehousePlan locations={data.locations} selected={areaFilter} onSelect={area => setAreaFilter(areaFilter === area ? 'todos' : area)}/>
      <section className="group">
        <div className="group-tools" style={{ paddingTop: 16 }}>
          <SearchField value={search} onChange={setSearch} placeholder="Buscar bloque o referencia"/>
          <Segmented label="Mostrar" value={filter} onChange={setFilter} options={[['todos', 'Todas'], ['ocupadas', 'Con stock'], ['libres', 'Libres']]}/>
          {data.locations.some(l => !isWarehouseArea(l.area)) && <Segmented label="Zona" value={areaFilter === 'pendientes' ? 'pendientes' : 'todas'} onChange={v => setAreaFilter(v === 'pendientes' ? 'pendientes' : 'todos')} options={[['todas', 'Todas las zonas'], ['pendientes', 'Sin zona']]}/>}
          <span className="count">{locations.length} ubicaciones</span>
        </div>
        {locations.length ? [...warehouseAreas.map(a => a.value as string), 'pendientes'].map(area => {
          const list = locations.filter(l => area === 'pendientes' ? !isWarehouseArea(l.area) : l.area === area).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
          if (!list.length) return null;
          return <div key={area}><div className="block-zone"><span className={'dot ' + area}/>{area === 'pendientes' ? 'Pendientes de asignar zona' : areaName(area)}</div><div className="blocks">{list.map(l => <button className={'block' + (l.qty ? '' : ' empty-block')} key={l.id} onClick={() => open('location', l)}>
            <b>{l.code}</b><span>{l.qty ? (productBySku.has(l.sku) ? modelName(productBySku.get(l.sku)!) : l.sku) : 'Libre'}</span><small>{formatPallets(l.qty)} de {l.capacity} palets</small><div className="meter"><i style={{ width: `${Math.min(100, l.qty / l.capacity * 100)}%` }}/></div>
          </button>)}</div></div>;
        }) : <Empty title={search || areaFilter !== 'todos' || filter !== 'todos' ? 'No hay ubicaciones en esta selección' : 'Define los bloques de cartón y cajas'} detail="Asigna cada bloque a una zona del plano con su capacidad real en palets."><button className="btn secondary" onClick={() => open('location')}><Plus size={15}/> Añadir ubicación</button></Empty>}
      </section>
    </>}

    {view === 'movimientos' && <section className="group">
      <div className="group-tools" style={{ paddingTop: 16 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Buscar SKU, albarán, ubicación o nota"/>
        <Segmented label="Tipo" value={filter} onChange={setFilter} options={[['todos', 'Todos'], ['entrada', 'Entradas'], ['salida', 'Salidas'], ['traslado', 'Traslados'], ['produccion', 'Producción']]}/>
        <span className="count">{movements.length} movimientos</span>
      </div>
      {movements.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th className="right">Palets</th><th>Ubicación</th><th>Responsable</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}>
        <td className="nowrap">{displayDate(m.date)}</td>
        <td><span className={'pill ' + movementTone[m.kind]}>{['entrada', 'produccion'].includes(m.kind) ? <ArrowDownLeft size={12}/> : <ArrowUpRight size={12}/>}{movementNames[m.kind]}</span></td>
        <td><b>{productBySku.get(m.sku)?.name ?? m.sku}</b><small className="mono">{m.sku}</small></td>
        <td className="right num"><b>{formatPallets(m.qty)}</b></td>
        <td className="nowrap">{m.location}{m.destination && <> → {m.destination}</>}</td>
        <td>{m.operator}<small>{[m.document || 'Sin documento', m.stacked && 'Apilado revisado'].filter(Boolean).join(' · ')}</small>{m.notes && <small style={{ maxWidth: 360, whiteSpace: 'normal' }}>{m.notes}</small>}</td>
      </tr>)}</tbody></table></div> : <Empty title={search || filter !== 'todos' ? 'Sin coincidencias' : 'Sin movimientos registrados'} detail="Registra una entrada por referencia y ubicación para empezar."><button className="btn primary" onClick={() => open('movement')}><Plus size={15}/> Registrar movimiento</button></Empty>}
      <div className="group-foot">Exporta el historial filtrado para auditoría o contabilidad.<button className="btn plain" onClick={() => download('movimientos-burriana.csv', csv([['Fecha', 'Tipo', 'SKU', 'Palets', 'Ubicación', 'Destino', 'Responsable', 'Albarán', 'Notas', 'Orden de producción'], ...movements.map(m => [m.date, m.kind, m.sku, m.qty, m.location, m.destination, m.operator, m.document, m.notes, m.workOrderId || ''])]), 'text/csv;charset=utf-8')}><Download size={13}/> Exportar historial</button></div>
    </section>}

    {view === '5s' && <>
      <div className="callout banner">Tareas de puesta en marcha del almacén de cartón y de la zona de cajas. El mantenimiento y la limpieza que deben verse en la pantalla se programan en Organización.</div>
      <section className="group">
        <div className="group-head"><div><h2>Responsables por zona</h2><p>Con 4 o 5 operarios, reparte también el stock por pasillo o familia.</p></div></div>
        <ul className="list">{[['Muelle y expediciones', 'Zona despejada y control de palets vacíos.', 'Operario 1'], ['Producción y montaje', 'Film, flejes y etiquetas disponibles.', 'Operario 2'], ['Residuos y maquinaria', 'Residuos separados y carga de máquinas.', 'Operario 3']].map(([zone, detail, who]) => <li className="row" key={zone}><div className="row-main"><b>{zone}</b><small>{detail}</small></div><div className="row-end">{who}</div></li>)}</ul>
      </section>
      <section className="group">
        <div className="group-head"><div><h2>Plan de puesta a punto</h2><p>{completed} de {data.tasks.length} tareas completadas.</p></div><span className={'pill ' + (completed === data.tasks.length && data.tasks.length ? 'green' : '')}>{data.tasks.length ? Math.round(completed / data.tasks.length * 100) : 0} %</span></div>
        <div className="pad" style={{ paddingBottom: 8 }}><div className="meter"><i style={{ width: `${data.tasks.length ? completed / data.tasks.length * 100 : 0}%` }}/></div></div>
        {data.tasks.map(t => <div className={'task' + (t.done ? ' done' : '')} key={t.id}><Tick disabled={busy} checked={t.done} onChange={v => save({ ...t, type: 'task', done: v })}><b>{t.title}</b><small>{t.zone} · {t.owner}{t.due && ' · ' + t.due.split('-').reverse().join('/')}</small></Tick><button className="icon-btn" aria-label={'Editar ' + t.title} onClick={() => open('task', t)}><Pencil size={15}/></button></div>)}
      </section>
    </>}

    {view === 'cierre' && <div className="grid-2">
      <section className="group">
        <div className="group-head"><div><h2>{today ? longDate(today) : 'Hoy'}</h2><p>Revisión de las zonas de cartón y cajas. El encargado decide cuándo parar la producción para preparar el turno siguiente.</p></div><span className={'pill ' + (closure ? 'green' : 'orange')}>{closure ? 'Firmado' : 'Pendiente'}</span></div>
        <div className="pad">
          <div className="checks" style={{ marginBottom: 18 }}>{checklist.map(([t, detail], i) => <Tick key={t} checked={closure ? true : checks[i]} disabled={!!closure || busy} onChange={v => setChecks(c => c.map((x, j) => j === i ? v : x))}><b>{t}</b><small>{detail}</small></Tick>)}</div>
          {closure ? <div className="callout success signed"><Check size={18}/><div><b>Firmado por {closure.operator}</b><br/>{displayDate(closure.date)}{closure.notes && ' · ' + closure.notes}</div></div>
            : <form onSubmit={async e => { e.preventDefault(); await save({ type: 'closure', checks, operator: user.name, notes }); }}>
              <Field label="Firma"><input required maxLength={180} value={user.name} readOnly/></Field>
              <Field label="Observaciones (opcional)"><textarea maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Incidencias resueltas o información para mañana"/></Field>
              <button className="btn primary large full" disabled={busy || !checks.every(Boolean)}><ClipboardCheck size={17}/>{busy ? 'Guardando…' : 'Firmar el cierre de hoy'}</button>
              <p className="form-note" style={{ margin: '10px 0 0' }}>La firma guarda tu nombre, la fecha y la hora. Completa los cinco puntos para firmar.</p>
            </form>}
        </div>
      </section>
      <section className="group">
        <div className="group-head"><div><h2>Historial</h2><p>Un cierre firmado por día.</p></div></div>
        {data.closures.length ? <div className="history">{data.closures.map(c => <div key={c.id}><b>{c.day.split('-').reverse().join('/')}</b> <span className="pill green" style={{ float: 'right' }}>5 de 5</span><p>{c.operator}, {displayDate(c.date)}</p>{c.notes && <small>{c.notes}</small>}</div>)}</div> : <p className="quiet">El primer cierre firmado aparecerá aquí.</p>}
      </section>
    </div>}

    {view === 'protocolo' && <>
      <div className="callout banner">Se aplica al almacén de cartón y a la zona de montaje y almacenaje de cajas del plano 08. Las zonas de cerámica quedan fuera de esta aplicación.</div>
      <div className="grid-3">{([['Recepción y almacenaje', [['Identifica cada palet', 'Etiqueta visible en al menos dos caras, con su referencia.'], ['Revisa antes de apilar', 'Para apilar a doble altura, revisa el palet inferior. Si hay humedad en el cartón o madera astillada, no apiles encima. La revisión visual no sustituye la validación de estabilidad y capacidad.'], ['Respeta cada ubicación', 'Una referencia por bloque. Mantén libres los pasillos de tránsito; no dejes palets provisionalmente.']]], ['Preparación y expedición', [['Trabaja con el albarán', 'Comprueba el pedido en papel. El operario que lo prepara firma con su nombre.'], ['Revisa referencia y cantidad', 'Haz un doble control visual antes de flejar y filmar. La salida exige confirmarlo y registrar el número de albarán.'], ['Prepara la carga', 'Deja el palet terminado en la zona de expedición delimitada. Registra la salida cuando salga del almacén.']]], ['Orden y responsabilidad', [['Zonas con responsable', 'Muelle y expediciones: operario 1. Producción y montaje: operario 2. Residuos y maquinaria: operario 3.'], ['Ubicaciones identificadas', 'Usa códigos únicos como CAR-01. Señaliza los bloques y mantén el catálogo de SKU al día.'], ['Cierra según el encargado', 'Estaciona maquinaria, revisa la carga, limpia pasillos, repón consumibles y revisa residuos. Firma el checklist diario.']]]] as [string, string[][]][]).map(([heading, steps]) => <section className="group" key={heading}><div className="group-head"><h2>{heading}</h2></div><div style={{ paddingBottom: 8 }}>{steps.map(([h, p], i) => <div className="step" key={h}><span className="step-num">{i + 1}</span><div><h3>{h}</h3><p>{p}</p></div></div>)}</div></section>)}</div>
    </>}
    </>}

    <footer className="page-foot"><span>Burriana · GTR Solutions</span><button className="btn plain" onClick={() => download('burriana-' + today + '.json', JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), revision, ...data }, null, 2), 'application/json')} disabled={disabled}><Download size={13}/> Descargar copia de datos</button></footer>

    <Dialog open={!!modal} onOpenChange={o => { if (!busy && !o) setModal(''); }}><DialogContent className="sheet"><DialogHeader><DialogTitle>{modal === 'product' ? (form.id ? 'Editar referencia' : 'Nueva referencia') : modal === 'location' ? (form.id ? 'Editar ubicación' : 'Nueva ubicación') : modal === 'task' ? (form.id ? 'Editar tarea' : 'Nueva tarea') : 'Registrar movimiento'}</DialogTitle><DialogDescription>{modal === 'movement' ? 'El stock se actualiza al guardar. Admite cuartos de palet.' : modal === 'location' ? 'Un bloque real del suelo y su capacidad validada en palets.' : 'Completa los datos y guarda los cambios.'}</DialogDescription></DialogHeader><form onSubmit={submit}>
      {modal === 'product' && <>{!form.id && <ReferencePhoto disabled={busy} onRead={r => { if (r.sku) f('sku', r.sku.toUpperCase()); if (r.name) f('name', r.name); if (r.family) changeFamily(r.family); }}/>}<Field label="Código único (SKU)"><input required readOnly={!!form.id} maxLength={180} value={form.sku} onChange={e => f('sku', e.target.value.toUpperCase())} placeholder="BIEDRONKA-40X30X23-CJ"/></Field><Field label="Nombre"><input required maxLength={180} value={form.name} onChange={e => f('name', e.target.value)} placeholder="Modelo, medida y tipo"/></Field><div className="form-grid"><Field label="Familia"><input required maxLength={180} list="families" value={form.family} onChange={e => changeFamily(e.target.value)}/><datalist id="families"><option value="Planchas"/><option value="Cajas"/></datalist></Field><Field label="Stock mínimo (palets)"><input required type="number" min="0" max="1000000" step="1" value={form.minimum} onChange={e => f('minimum', Number(e.target.value))}/></Field></div>{productKind({ sku: form.sku, family: form.family }) === 'caja' && <Field label="Cajas por palet (opcional)"><input type="number" min="0" max="1000000" step="1" value={form.boxesPerPallet || ''} placeholder="Sin indicar" onChange={e => f('boxesPerPallet', Number(e.target.value))}/></Field>}<p className="form-note">El stock se añade con una entrada. El SKU no cambia para conservar el historial.</p></>}
      {modal === 'location' && <><Choice label="Zona del plano" value={form.area ?? ''} onChange={v => f('area', v)} options={warehouseAreas.map(a => ({ value: a.value, label: a.label }))}/><div className="form-grid"><Field label="Código de bloque"><input required readOnly={!!form.id} maxLength={180} value={form.code} onChange={e => f('code', e.target.value.toUpperCase())} placeholder={form.area === 'montaje' ? 'CAJ-01' : 'CAR-01'}/></Field><Field label="Pasillo o sector"><input required maxLength={180} value={form.zone} onChange={e => f('zone', e.target.value)} placeholder="Pasillo A"/></Field></div><Field label="Capacidad validada (palets)"><input required type="number" min="1" max="1000000" step="1" value={form.capacity} onChange={e => f('capacity', Number(e.target.value))}/></Field><p className="form-note">Incluye la segunda altura solo si está autorizada para esa carga. No ocupes pasillos, accesos ni puestos de maquinaria.</p>{form.id && <div className="callout"><div><b>{formatPallets(form.qty)} palets almacenados</b><br/>{form.sku ? productBySku.get(form.sku)?.name ?? form.sku : 'Ubicación libre'}</div></div>}</>}
      {modal === 'task' && <><Field label="Tarea"><input required maxLength={180} value={form.title} onChange={e => f('title', e.target.value)}/></Field><Field label="Zona"><input required maxLength={180} value={form.zone} onChange={e => f('zone', e.target.value)}/></Field><div className="form-grid"><Field label="Responsable"><input required maxLength={180} value={form.owner} onChange={e => f('owner', e.target.value)} placeholder="Nombre del operario"/></Field><Field label="Fecha objetivo (opcional)"><input type="date" value={form.due} onChange={e => f('due', e.target.value)}/></Field></div><Tick checked={form.done} onChange={v => f('done', v)}>Tarea completada</Tick></>}
      {modal === 'movement' && <>{(!data.products.length || !data.locations.length) ? <div className="callout"><div>Necesitas al menos una referencia y una ubicación para registrar movimientos.</div><button type="button" className="btn secondary" onClick={() => { setModal(''); go(!data.products.length ? 'referencias' : 'ubicaciones'); }}>Configurar</button></div> : <>
        <div className="field"><span>Tipo de movimiento</span><Segmented label="Tipo de movimiento" value={form.kind} onChange={v => { f('kind', v); f('location', ''); f('destination', ''); }} options={[['entrada', 'Entrada'], ['salida', 'Salida'], ['traslado', 'Traslado']]}/></div>
        <Choice label="Referencia" value={form.sku} onChange={v => { f('sku', v); f('location', ''); f('destination', ''); }} options={data.products.map(p => ({ value: p.sku, label: `${p.name} · ${p.sku}` }))}/>
        <div className="form-grid"><Choice label={form.kind === 'entrada' ? 'Ubicación de entrada' : 'Ubicación de origen'} value={form.location} onChange={v => f('location', v)} options={data.locations.filter(l => form.kind === 'entrada' ? (!l.qty || l.sku === form.sku) : l.qty > 0 && l.sku === form.sku).map(l => ({ value: l.code, label: `${l.code} · ${formatPallets(l.qty)}/${l.capacity} palets` }))}/><Field label="Palets"><input required type="number" min="0.25" max="1000000" step="0.25" value={form.qty} onChange={e => f('qty', Number(e.target.value))}/></Field></div>
        {form.kind === 'traslado' && <Choice label="Ubicación de destino" value={form.destination} onChange={v => f('destination', v)} options={data.locations.filter(l => l.code !== form.location && (!l.qty || l.sku === form.sku)).map(l => ({ value: l.code, label: `${l.code} · ${formatPallets(l.qty)}/${l.capacity} palets` }))}/>}
        <div className="form-grid"><Field label="Responsable"><input required maxLength={180} value={user.name} readOnly/></Field><Field label={form.kind === 'salida' ? 'Número de albarán' : 'Documento (opcional)'}><input required={form.kind === 'salida'} maxLength={180} value={form.document} onChange={e => f('document', e.target.value)} placeholder="N.º de documento"/></Field></div>
        <Field label="Observaciones (opcional)"><textarea maxLength={1000} value={form.notes} onChange={e => f('notes', e.target.value)}/></Field>
        <div className="checks">{form.kind === 'salida' ? <Tick checked={form.verified} onChange={v => f('verified', v)}>He hecho el doble control de referencia y cantidad antes de flejar y filmar.</Tick> : <><Tick checked={form.labelled} onChange={v => f('labelled', v)}>Etiquetas de referencia visibles en dos caras.</Tick><Tick checked={form.stacked} onChange={v => f('stacked', v)}>Hay que apilar a doble altura.</Tick>{form.stacked && <Tick checked={form.safe} onChange={v => f('safe', v)}>Apilado autorizado y palet inferior revisado: estable, sin humedad ni madera dañada.</Tick>}</>}</div>
      </>}</>}
      {formError && <div className="callout error form-error" role="alert">{formError}</div>}
      <div className="dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => setModal('')}>Cancelar</button><button className="btn primary" disabled={busy || (modal === 'movement' && (!data.products.length || !data.locations.length))}>{busy ? 'Guardando…' : 'Guardar ' + (modal === 'movement' ? 'movimiento' : modal === 'product' ? 'referencia' : modal === 'location' ? 'ubicación' : 'tarea')}</button></div>
    </form></DialogContent></Dialog>
  </AppShell>;
}

type ThreeDProps = {
  data: State; review: Set<string>; layout: ReturnType<typeof layoutWarehouse>; search: string; setSearch: (v: string) => void; highlight: Set<string> | null;
  colorMode: ColorMode; setColorMode: (m: ColorMode) => void; preset: CameraPreset; setPreset: (p: CameraPreset) => void; presetNonce: number;
  selected: string | null; onSelect: (id: string | null) => void; productBySku: Map<string, Product>; stock: (sku: string) => number;
  onMove: (l: Location) => void; onEdit: (l: Location) => void; onHistory: (l: Location) => void;
};
function ThreeDView({ data, review, layout, search, setSearch, highlight, colorMode, setColorMode, preset, setPreset, presetNonce, selected, onSelect, productBySku, stock, onMove, onEdit, onHistory }: ThreeDProps) {
  const location = selected ? data.locations.find(l => l.id === selected && l.qty > 0) : undefined;
  const product = location ? productBySku.get(location.sku) : undefined;
  const entry = location ? data.movements.find(m => m.location === location.code && m.kind === 'entrada') : undefined;
  const pair = product ? data.products.filter(p => p.sku !== product.sku && modelKey(p.sku) === modelKey(product.sku)) : [];
  const matchCount = highlight?.size ?? 0;
  // Floor taken by box pallets: each position holds a stack of the model's footprint.
  const boxArea = layout.stacks.filter(stack => stack.area === 'montaje').reduce((sum, stack) => { const shape = palletShape(productBySku.get(stack.sku) ?? { sku: stack.sku }); return sum + shape.width * shape.depth; }, 0);
  return <>
    <div className="viewer">
      <Warehouse3D data={data} colorMode={colorMode} review={review} highlight={highlight} selected={location?.id ?? null} onSelect={onSelect} preset={preset} presetNonce={presetNonce}/>
      <div className="viewer-top">
        <SearchField value={search} onChange={setSearch} placeholder="Buscar en la nave"/>
        <Segmented label="Color" value={colorMode} onChange={setColorMode} options={[['tipo', 'Tipo'], ['modelo', 'Modelo'], ['revisar', 'Por revisar']]}/>
        <div className="legend glass">
          {colorMode === 'tipo' && <><span><i className="dot planchas"/>Planchas</span><span><i className="dot cajas"/>Cajas montadas</span></>}
          {colorMode === 'modelo' && <span>Mismo color: planchas y cajas del mismo modelo</span>}
          {colorMode === 'revisar' && <><span><i className="dot review"/>{review.size} por revisar</span><span><i className="dot quiet"/>Confirmado</span></>}
          {highlight && <span>{matchCount ? `${matchCount} ${matchCount === 1 ? 'ubicación coincide' : 'ubicaciones coinciden'}` : 'Ninguna ubicación coincide'}</span>}
        </div>
      </div>
      {location && <aside className="detail glass" aria-label="Detalle de la ubicación">
        <div className="detail-head"><h3>{product?.name ?? location.sku}</h3><button className="icon-btn" aria-label="Cerrar detalle" onClick={() => onSelect(null)}><X size={16}/></button></div>
        <p className="code"><span className={'dot ' + location.area}/> {location.code} · {areaName(location.area)}</p>
        <dl>
          <dt>En este bloque</dt><dd>{formatPallets(location.qty)} palets</dd>
          {location.area === 'montaje' && <><dt>Cajas en el bloque</dt><dd>{boxCount(location.qty * boxesPerPallet(product).boxes, boxesPerPallet(product).estimated)}</dd></>}
          <dt>Posiciones de suelo</dt><dd>{Math.ceil(location.qty / STACK_HEIGHT)} a {STACK_HEIGHT} alturas</dd>
          <dt>Capacidad</dt><dd>{location.capacity} palets</dd>
          <dt>Total de la referencia</dt><dd>{formatPallets(stock(location.sku))} palets</dd>
          {pair.map(p => <Fragment key={p.sku}><dt>{productKind(p) === 'plancha' ? 'Planchas del modelo' : 'Cajas del modelo'}</dt><dd>{formatPallets(stock(p.sku))} palets</dd></Fragment>)}
        </dl>
        {review.has(location.id) && <div className="callout orange">Lectura del cuaderno por confirmar.</div>}
        {entry?.notes && <p className="note">{entry.notes}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => onMove(location)}>Registrar salida</button>
          <button className="btn secondary" onClick={() => onEdit(location)}>Editar</button>
          <button className="btn plain" onClick={() => onHistory(location)}>Movimientos</button>
        </div>
      </aside>}
      <div className="viewer-bottom"><Segmented label="Vista" value={preset} onChange={setPreset} options={[['perspectiva', 'Perspectiva'], ['planta', 'Planta'], ['carton', 'Cartón'], ['cajas', 'Cajas']]}/></div>
    </div>
    <div className="viewer-note">
      <span>Posición orientativa: los bloques se ordenan por código dentro de su zona del plano 08, a {STACK_HEIGHT} alturas.</span>
      <span>Planchas: {layout.positions.carton} posiciones de suelo.</span>
      <span>Cajas: {layout.positions.montaje} posiciones, unos {Math.round(boxArea)} m² de suelo; palets de 5 cajas por capa y 10–11 capas.</span>
      {layout.overflow > 0 && <span>{layout.overflow} posiciones de cajas no caben en la franja inferior y se muestran junto a las máquinas.</span>}
      {layout.hidden > 0 && <span>{layout.hidden} pilas no caben en el plano y no se dibujan.</span>}
      {layout.unplaced.length > 0 && <span>{layout.unplaced.length} ubicaciones con stock no tienen zona y no se dibujan.</span>}
    </div>
  </>;
}
