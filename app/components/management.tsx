'use client';

import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownToLine, ArrowRight, CalendarClock, ArrowUpFromLine, Check, ChevronRight, ClipboardList, Clock3, Coffee, Factory, Monitor, Package, Pause, Play, Plus, Rotate3d, Search, Settings2, ShieldCheck, Sparkles, Truck, Users, Wrench, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWarehouse } from '@/hooks/use-warehouse';
import { madridDay, type Location, type State } from '@/lib/warehouse';
import { sortOperationalOrders, type ProductionSpecification, type ShiftSettings, type WorkOrder, type WorkOrderKind, type WorkOrderStatus } from '@/lib/operations';
import { blocksForDay, nextOccurrences, priorityOrder } from '@/lib/settings';
import { cajaDestinations, formatPallets, linkPlancha, modelName, pairedCaja, planchaSources, productKind, stockBySku } from '@/lib/warehouse-insights';
import type { PublicUser } from '@/lib/identity';
import AppShell from './app-shell';
import { useAppReady } from './app-loader';
import './management.css';

const kinds: { value: WorkOrderKind; label: string; Icon: typeof Factory; description: string }[] = [
  { value: 'viaje', label: 'Viaje de producción', Icon: Factory, description: 'Transformar planchas en cajas y reponer stock' },
  { value: 'pedido', label: 'Pedido', Icon: Package, description: 'Preparar un pedido recibido' },
  { value: 'carga', label: 'Carga de camión', Icon: ArrowUpFromLine, description: 'Preparar y cargar una expedición' },
  { value: 'descarga', label: 'Descarga de camión', Icon: ArrowDownToLine, description: 'Recibir y descargar mercancía' },
  { value: 'mantenimiento', label: 'Mantenimiento', Icon: Wrench, description: 'Máquinas, carretillas y equipos' },
  { value: 'limpieza', label: 'Limpieza', Icon: Sparkles, description: 'Puestos de trabajo y zonas comunes' },
];
const statuses: Record<WorkOrderStatus, string> = { pendiente: 'Pendiente', en_curso: 'En curso', pausada: 'En pausa', completada: 'Completada', cancelada: 'Cancelada' };
const dateTime = (date: string) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(date));
const longDate = (day: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(day + 'T12:00:00Z'));
const kindInfo = (kind: WorkOrderKind) => kinds.find(item => item.value === kind)!;
const shortKind: Record<WorkOrderKind, string> = { viaje: 'viajes', pedido: 'pedidos', carga: 'cargas', descarga: 'descargas', mantenimiento: 'mantenimiento', limpieza: 'limpieza' };
const shortDay = (day: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(day + 'T12:00:00Z'));
const isOpen = (order: WorkOrder) => !['completada', 'cancelada'].includes(order.status);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const scheduleText = (order: WorkOrder) => `${order.scheduledDate.split('-').reverse().join('/')}, ${order.scheduledTime || 'sin hora fija'}`;

export default function Management({ section, user }: { section: 'dashboard' | 'operaciones' | 'usuarios'; user: PublicUser }) {
  const router = useRouter();
  const { data, loading, error, busy, updatedAt, refresh, save } = useWarehouse();
  useAppReady(!loading);
  const [today, setToday] = useState('');
  const [editor, setEditor] = useState<WorkOrder | 'new' | null>(null);
  const [initialKind, setInitialKind] = useState<WorkOrderKind>('viaje');
  const [shiftOpen, setShiftOpen] = useState(false);
  const [completion, setCompletion] = useState<WorkOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<WorkOrder | null>(null);
  const [feedback, setFeedback] = useState('');
  const [failure, setFailure] = useState('');
  const [filter, setFilter] = useState('activas');
  const [kindFilter, setKindFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const title = section === 'usuarios' ? 'Personas y accesos' : section === 'operaciones' ? 'Organización del turno' : user.role === 'administrador' ? 'El almacén, hoy' : 'Tu turno';
  const subtitle = section === 'usuarios' ? 'Un acceso para cada persona y un perfil de consulta para la pantalla.' : 'Viajes de producción, pedidos y muelle, coordinados en un mismo lugar.';

  useEffect(() => {
    const update = () => setToday(madridDay());
    const timer = window.setInterval(update, 30000);
    Promise.resolve().then(update);
    return () => window.clearInterval(timer);
  }, []);

  const all = data.workOrders;
  const priority = priorityOrder(data.settings);
  const active = sortOperationalOrders(all.filter(isOpen), priority);
  const due = active.filter(order => order.scheduledDate <= today);
  const current = due.find(order => order.status === 'en_curso') ?? due.find(order => order.status !== 'pausada');
  const completedToday = all.filter(order => order.completedAt && madridDay(new Date(order.completedAt)) === today);
  const totalStock = data.locations.reduce((sum, location) => sum + location.qty, 0);
  const stock = (sku: string) => data.locations.filter(location => location.sku === sku).reduce((sum, location) => sum + location.qty, 0);
  // Most urgent first: the largest shortfall against each reference's minimum.
  const low = data.products.filter(product => stock(product.sku) < product.minimum).sort((a, b) => (b.minimum - stock(b.sku)) - (a.minimum - stock(a.sku)));
  const trucks = due.filter(order => ['carga', 'descarga'].includes(order.kind));
  const care = active.filter(order => ['mantenimiento', 'limpieza'].includes(order.kind));
  const filtered = sortOperationalOrders(all.filter(order =>
    (filter === 'todas' || (filter === 'activas' ? isOpen(order) : filter === 'hoy' ? order.scheduledDate === today : order.status === filter)) &&
    (kindFilter === 'todos' || order.kind === kindFilter) &&
    `${order.title} ${order.reference} ${order.truck} ${order.assignedTo}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')),
  ), priority);
  const disabled = loading || !!error;
  // Fixed blocks of the shift (normas): today's, or the next one coming.
  const todayBlocks = today ? blocksForDay(data.settings.rules, today, data.shift) : [];
  const nextRule = today && !todayBlocks.length ? data.settings.rules.map(rule => ({ rule, day: nextOccurrences(rule, today, 1)[0] })).filter(entry => entry.day).sort((a, b) => a.day.localeCompare(b.day))[0] : undefined;
  const priorityText = Array.isArray(priority) ? `Prioridad: ${priority.map(kind => shortKind[kind]).join(', ')}` : 'Los viajes van primero; el encargado puede marcar una urgencia.';
  const nameOf = (sku: string) => data.products.find(product => product.sku === sku)?.name ?? sku;

  function newOrder(kind: WorkOrderKind = 'viaje') { setInitialKind(kind); setEditor('new'); setFailure(''); setFeedback(''); }
  async function commit(action: Record<string, unknown>, message: string) {
    setFailure(''); setFeedback('');
    try { if (await save(action)) { setFeedback(message); return true; } }
    catch (reason) { setFailure(reason instanceof Error ? reason.message : 'No se ha podido guardar. Revisa los datos antes de reintentar.'); }
    return false;
  }
  async function changeStatus(order: WorkOrder, status: WorkOrderStatus) {
    if (status === 'completada') { setCompletion(order); return; }
    if (status === 'cancelada') { setCancelOrder(order); return; }
    await commit({ type: 'workOrderStatus', id: order.id, status }, `Orden ${statuses[status].toLowerCase()}.`);
  }

  const actions = section === 'usuarios' ? [] : [
    { label: 'Nuevo viaje de producción', Icon: Factory, run: () => newOrder('viaje') },
    { label: 'Programar carga de camión', Icon: ArrowUpFromLine, run: () => newOrder('carga') },
    { label: 'Programar descarga de camión', Icon: ArrowDownToLine, run: () => newOrder('descarga') },
    { label: 'Horarios y aviso del turno', Icon: Settings2, run: () => setShiftOpen(true) },
    { label: 'Abrir vista 3D del almacén', Icon: Rotate3d, run: () => router.push('/inventario?vista=3d') },
  ];

  return <AppShell user={user} active={section === 'dashboard' ? 'inicio' : section} data={data} sync={{ updatedAt, error, busy, refresh }} actions={actions}>
    <header className="page-head">
      <div>{today && <span className="date">{longDate(today)}</span>}<h1>{title}</h1><p>{subtitle}</p></div>
      {section !== 'usuarios' && <div className="page-actions"><button className="btn secondary" onClick={() => setShiftOpen(true)} disabled={disabled}><Settings2 size={15}/> Horarios y aviso</button><button className="btn primary" onClick={() => newOrder()} disabled={disabled}><Plus size={16}/> Nueva orden</button></div>}
    </header>
    {feedback && <div className="callout success banner" role="status"><Check size={17}/>{feedback}<button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label="Cerrar mensaje" onClick={() => setFeedback('')}><X size={15}/></button></div>}
    {(error || failure) && <div className="callout error banner" role="alert">{failure || error}<button className="btn secondary" onClick={refresh}>Actualizar datos</button></div>}
    {section === 'usuarios' ? <UsersPanel user={user}/> : loading ? <div className="loading" role="status">Cargando el estado del almacén…</div> : <>
      <div className="shiftbar"><span><Clock3 size={16}/><b>Turno</b> {data.shift.startTime}–{data.shift.endTime}</span><span><Coffee size={16}/><b>Almuerzo</b> {data.shift.lunchStart && data.shift.lunchEnd ? `${data.shift.lunchStart}–${data.shift.lunchEnd}` : 'por definir'}</span>{todayBlocks.map(block => <span key={block.rule.id}><CalendarClock size={16}/><b>Hoy {block.start}–{block.end}</b> {block.rule.title}</span>)}{nextRule && <span><CalendarClock size={16}/><b>{shortDay(nextRule.day)}</b> {nextRule.rule.title}</span>}<span className="note">{priorityText}</span></div>
      {data.shift.announcement && <div className="callout blue announcement"><div><b>Aviso publicado.</b> {data.shift.announcement}</div></div>}
      {section === 'dashboard' ? <>
        <div className="summary">
          <div className="figure"><small>Órdenes pendientes</small><strong>{active.length}</strong><span>{count(active.filter(order => order.kind === 'viaje').length, 'viaje de producción', 'viajes de producción')}</span></div>
          <div className="figure"><small>Camiones</small><strong>{trucks.length}</strong><span>{count(trucks.filter(order => order.kind === 'carga').length, 'carga', 'cargas')} y {count(trucks.filter(order => order.kind === 'descarga').length, 'descarga', 'descargas')}</span></div>
          <div className="figure"><small>Completadas hoy</small><strong>{completedToday.length}</strong><span>{count(completedToday.filter(order => order.kind === 'viaje').length, 'viaje terminado', 'viajes terminados')}</span></div>
          <div className="figure"><small>En stock</small><strong>{formatPallets(totalStock)}<span>palets</span></strong><span>{low.length ? `${count(low.length, 'referencia', 'referencias')} bajo mínimo` : count(data.products.length, 'referencia', 'referencias')}</span></div>
        </div>
        <div className="grid-2" style={{ marginTop: 20 }}>
          <section className="group">{current ? <div className="now">
            <div className="now-head">{current.status === 'en_curso' ? <><i className="live"/>En marcha</> : 'Siguiente trabajo'}<span className={'pill status ' + current.status} style={{ marginLeft: 'auto' }}>{statuses[current.status]}</span></div>
            <div><span className="pill" style={{ marginBottom: 10 }}>{kindInfo(current.kind).label}{current.reference && ` · ${current.reference}`}</span><h2>{current.title}</h2></div>
            <p>{current.instructions || kindInfo(current.kind).description}</p>
            <div className="now-meta"><span><Clock3 size={15}/>{scheduleText(current)}</span><span><Users size={15}/>{current.assignedTo || 'Equipo de almacén'}</span>{current.truck && <span><Truck size={15}/>{current.truck}</span>}</div>
            {current.production && <ProductionLine production={current.production} nameOf={nameOf}/>}
            <div className="now-foot">{current.status === 'en_curso' ? <button className="btn secondary" disabled={busy || !!error} onClick={() => changeStatus(current, 'pausada')}><Pause size={14}/> Pausar</button> : <button className="btn secondary" disabled={busy || !!error} onClick={() => changeStatus(current, 'en_curso')}><Play size={14}/> {current.status === 'pausada' ? 'Reanudar' : 'Empezar'}</button>}<button className="btn primary" disabled={busy || !!error} onClick={() => changeStatus(current, 'completada')}><Check size={14}/> Completar</button><Link className="link" href="/operaciones" style={{ marginLeft: 'auto' }}>Todas las órdenes<ChevronRight size={15}/></Link></div>
          </div> : <Empty title="Todavía no hay trabajo para hoy" text="Crea un viaje, un pedido o una operación de muelle. Aparecerá en la pantalla del almacén."><button className="btn primary" onClick={() => newOrder()}><Plus size={15}/> Crear la primera orden</button></Empty>}</section>
          <section className="group">
            <div className="group-head"><div><h2>Muelle</h2><p>Cargas y descargas de hoy o pendientes.</p></div><button onClick={() => newOrder('carga')} className="btn plain"><Plus size={15}/> Añadir</button></div>
            {trucks.length ? <div className="list">{trucks.slice(0, 5).map(order => <CompactOrder key={order.id} order={order} onClick={() => setSelected(order)}/>)}</div> : <p className="quiet">Sin camiones pendientes. Programa cada carga y descarga con su hora y matrícula.</p>}
          </section>
        </div>
        <div className="grid-2" style={{ marginTop: 20 }}>
          <section className="group">
            <div className="group-head"><div><h2>Mantenimiento y limpieza</h2><p>Carretillas, máquinas y puestos de trabajo.</p></div><button onClick={() => newOrder('mantenimiento')} className="btn plain"><Plus size={15}/> Programar</button></div>
            {care.length ? <div className="list">{care.slice(0, 5).map(order => <CompactOrder key={order.id} order={order} onClick={() => setSelected(order)}/>)}</div> : <p className="quiet">Define cuándo se hacen los cuidados del equipo y si deben repetirse.</p>}
          </section>
          <section className="group">
            <div className="group-head"><div><h2>Almacén</h2><p>{low.length ? 'Referencias por debajo del mínimo definido.' : 'Stock por encima de los mínimos.'}</p></div><Link className="link" href={low.length ? '/inventario?vista=referencias&filtro=bajo' : '/inventario'}>{low.length === 1 ? 'Ver la referencia' : low.length ? `Ver las ${low.length}` : 'Existencias'}<ChevronRight size={15}/></Link></div>
            {low.length ? <ul className="list">{low.slice(0, 5).map(product => <li className="row" key={product.id}><div className="row-main"><b>{product.name}</b><small className="mono">{product.sku}</small></div><div className="row-end"><strong className="num">{formatPallets(stock(product.sku))}</strong>de {product.minimum}</div></li>)}</ul>
              : <Link className="row" href="/inventario?vista=3d"><span className="row-icon"><Rotate3d size={17}/></span><span className="row-main"><b>Ver la nave en 3D</b><small>{formatPallets(totalStock)} palets colocados sobre el plano</small></span><ChevronRight size={16} color="var(--ink-3)"/></Link>}
          </section>
        </div>
        <section className="group" style={{ marginTop: 20 }}>
          <div className="group-head"><div><h2>Terminadas recientemente</h2></div><Link className="link" href="/operaciones">Ver todas<ChevronRight size={15}/></Link></div>
          {all.some(order => order.status === 'completada') ? <div className="list">{all.filter(order => order.status === 'completada').sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)).slice(0, 5).map(order => <CompactOrder key={order.id} order={order} onClick={() => setSelected(order)}/>)}</div> : <p className="quiet">Cuando el encargado complete las primeras órdenes, aparecerán aquí.</p>}
        </section>
      </> : <>
        <div className="chips" role="group" aria-label="Tipo de trabajo">
          <button aria-pressed={kindFilter === 'todos'} onClick={() => setKindFilter('todos')}>Todo <b>{active.length}</b></button>
          {kinds.map(({ value, label, Icon }) => <button key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(kindFilter === value ? 'todos' : value)}><Icon size={15}/>{label} <b>{active.filter(order => order.kind === value).length}</b></button>)}
        </div>
        <section className="group">
          <div className="group-tools" style={{ paddingTop: 16 }}>
            <label className="search-field"><Search size={15}/><input aria-label="Buscar órdenes" placeholder="Buscar orden, referencia o matrícula" value={search} onChange={event => setSearch(event.target.value)}/></label>
            <select className="select-sm" aria-label="Mostrar" value={filter} onChange={event => setFilter(event.target.value)}><option value="activas">Activas</option><option value="hoy">Programadas para hoy</option><option value="en_curso">En curso</option><option value="pausada">En pausa</option><option value="completada">Completadas</option><option value="cancelada">Canceladas</option><option value="todas">Todo el historial</option></select>
            <span className="count">{count(filtered.length, 'orden', 'órdenes')}</span>
          </div>
          {filtered.length ? <div>{filtered.map(order => <OrderRow key={order.id} order={order} nameOf={nameOf} today={today} busy={busy || !!error} onEdit={() => setEditor(order)} onDetail={() => setSelected(order)} onStatus={status => changeStatus(order, status)}/>)}</div> : <Empty title={all.length ? 'No hay órdenes en esta selección' : 'Organiza el primer turno'} text={all.length ? 'Cambia los filtros o crea una orden nueva.' : 'Los viajes de producción van primero. Programa también pedidos, camiones y cuidados del almacén.'}><button className="btn primary" onClick={() => newOrder()}><Plus size={15}/> Nueva orden</button></Empty>}
        </section>
      </>}
    </>}
    <footer className="page-foot"><span>Burriana · GTR Solutions</span><span>El encargado organiza; el equipo ve las instrucciones en la pantalla del almacén.</span></footer>
    {editor && <OrderEditor order={editor === 'new' ? undefined : editor} kind={initialKind} data={data} busy={busy} onClose={() => setEditor(null)} onSave={async action => { if (await commit(action, 'Orden guardada. La pantalla se actualizará sola.')) { setEditor(null); return true; } return false; }} failure={failure}/>}
    {shiftOpen && <ShiftEditor shift={data.shift} busy={busy} failure={failure} onClose={() => setShiftOpen(false)} onSave={async shift => { if (await commit({ type: 'shift', ...shift }, 'Horarios y aviso publicados.')) setShiftOpen(false); }}/>}
    {completion && <CompletionDialog order={completion} data={data} busy={busy} failure={failure} onClose={() => setCompletion(null)} onSave={async action => { if (await commit(action, completion.kind === 'viaje' ? 'Viaje completado. Consumo y producción registrados en el inventario.' : 'Orden completada.')) setCompletion(null); }}/>}
    {cancelOrder && <Modal title="Cancelar orden" description="La orden conserva su historial y deja de aparecer entre los trabajos activos." onClose={() => setCancelOrder(null)}><p className="dialog-copy">{cancelOrder.title}</p><div className="dialog-actions"><button className="btn secondary" onClick={() => setCancelOrder(null)}>Volver</button><button className="btn danger" disabled={busy} onClick={async () => { if (await commit({ type: 'workOrderStatus', id: cancelOrder.id, status: 'cancelada' }, 'Orden cancelada.')) setCancelOrder(null); }}>Cancelar orden</button></div></Modal>}
    {selected && <Modal title={selected.title} description={`${kindInfo(selected.kind).label}, ${statuses[selected.status].toLowerCase()}`} onClose={() => setSelected(null)}><dl className="details"><dt>Programación</dt><dd>{scheduleText(selected)}</dd><dt>Registrada</dt><dd>{dateTime(selected.createdAt)}</dd><dt>Referencia</dt><dd>{selected.reference || 'Sin referencia'}</dd><dt>Asignada a</dt><dd>{selected.assignedTo || 'Equipo de almacén'}</dd>{selected.truck && <><dt>Camión</dt><dd>{selected.truck}</dd></>}<dt>Instrucciones</dt><dd>{selected.instructions || 'Sin instrucciones adicionales'}</dd>{selected.completedAt && <><dt>Completada</dt><dd>{dateTime(selected.completedAt)}</dd></>}</dl>{selected.production && <div style={{ marginTop: 16 }}><ProductionLine production={selected.production} nameOf={nameOf}/></div>}<h3 className="detail-title">Trazabilidad</h3><ol className="events">{selected.events.map(event => <li key={event.id}><b>{statuses[event.status]}</b><span>{event.actorName}, {dateTime(event.date)}</span></li>)}</ol></Modal>}
  </AppShell>;
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) { return <div className="empty"><ClipboardList size={28} strokeWidth={1.5}/><h3>{title}</h3><p>{text}</p>{children}</div>; }
function CompactOrder({ order, onClick }: { order: WorkOrder; onClick: () => void }) { const { Icon, label } = kindInfo(order.kind); return <button className="row with-icon" onClick={onClick}><span className={'kind-tile ' + order.kind}><Icon size={17}/></span><span className="row-main"><b>{order.title}</b><small>{label}{order.truck && `, ${order.truck}`} · {order.completedAt ? dateTime(order.completedAt) : scheduleText(order)}</small></span><span className={'pill status ' + order.status}>{statuses[order.status]}</span></button>; }
function OrderRow({ order, nameOf, today, busy, onEdit, onDetail, onStatus }: { order: WorkOrder; nameOf: (sku: string) => string; today: string; busy: boolean; onEdit: () => void; onDetail: () => void; onStatus: (status: WorkOrderStatus) => void }) {
  const { Icon, label } = kindInfo(order.kind);
  return <article className={'order' + (order.status === 'en_curso' ? ' running' : '')}>
    <span className={'kind-tile ' + order.kind}><Icon size={18}/></span>
    <div className="order-body">
      <div className="order-tags"><span className="pill">{label}</span><span className={'pill status ' + order.status}>{statuses[order.status]}</span>{order.priority === 'urgente' && <span className="pill red">Urgente</span>}{isOpen(order) && order.scheduledDate < today && <span className="pill orange">De un día anterior</span>}</div>
      <button className="order-title" onClick={onDetail}>{order.title}</button>
      <div className="order-meta"><span><Clock3 size={13}/>{scheduleText(order)}</span>{order.reference && <span>Ref. {order.reference}</span>}{order.truck && <span><Truck size={13}/>{order.truck}</span>}<span><Users size={13}/>{order.assignedTo || 'Equipo de almacén'}</span></div>
      {order.instructions && <p>{order.instructions}</p>}
      {order.production && <ProductionLine production={order.production} nameOf={nameOf}/>}
      {order.repeatEveryDays > 0 && <small className="order-repeat">Se repite cada {order.repeatEveryDays} días tras completarse.</small>}
    </div>
    {isOpen(order) && <div className="order-actions">
      <div className="buttons">{order.status === 'en_curso' ? <button className="btn secondary" disabled={busy} onClick={() => onStatus('pausada')}><Pause size={14}/> Pausar</button> : <button className="btn secondary" disabled={busy} onClick={() => onStatus('en_curso')}><Play size={14}/> {order.status === 'pausada' ? 'Reanudar' : 'Empezar'}</button>}<button className="btn primary" disabled={busy} onClick={() => onStatus('completada')}><Check size={14}/> Completar</button></div>
      <div className="more"><button className="btn plain" disabled={busy} onClick={onEdit}>Editar</button><button className="btn plain" disabled={busy} onClick={() => onStatus('cancelada')}>Cancelar</button></div>
    </div>}
  </article>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) { return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sheet"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>; }
function InputField({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }

/** Plancha taken, from which block, and where the produced cajas go: the link a viaje is built on. */
function ProductionLine({ production, nameOf }: { production: ProductionSpecification; nameOf: (sku: string) => string }) {
  return <div className="production"><span className="dot planchas"/><span>{production.inputPallets} palets de <b>{nameOf(production.inputSku)}</b> de {production.inputLocation}</span><ArrowRight size={14}/><span className="dot cajas"/><span>{production.outputPallets} palets de <b>{nameOf(production.outputSku)}</b> a {production.outputLocation}</span></div>;
}

function ProductionFields({ value, onChange, data, onPlancha }: { value: ProductionSpecification; onChange: (value: ProductionSpecification) => void; data: State; onPlancha?: (model: string) => void }) {
  const stock = stockBySku(data);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es');
  const planchas = data.products.filter(product => productKind(product) === 'plancha').sort(byName);
  const others = data.products.filter(product => productKind(product) === 'otro').sort(byName);
  const cajas = data.products.filter(product => productKind(product) !== 'plancha' && product.sku !== value.inputSku).sort(byName);
  const withStock = planchas.filter(product => stock.get(product.sku));
  const withoutStock = planchas.filter(product => !stock.get(product.sku));
  // An order saved earlier keeps its blocks listed even if the stock has moved since.
  const keep = (list: Location[], code: string) => { const saved = data.locations.find(location => location.code === code); return saved && !list.includes(saved) ? [saved, ...list] : list; };
  const sources = value.inputSku ? keep(planchaSources(data, value.inputSku), value.inputLocation) : [];
  const destinations = value.outputSku ? keep(cajaDestinations(data, value.outputSku, value.inputLocation), value.outputLocation) : [];
  const source = data.locations.find(location => location.code === value.inputLocation);
  const target = data.locations.find(location => location.code === value.outputLocation);
  const available = source?.sku === value.inputSku ? source.qty : 0;
  const room = target ? target.capacity - target.qty : 0;
  function choosePlancha(sku: string) {
    onChange({ ...value, ...linkPlancha(data, sku) });
    const chosen = data.products.find(product => product.sku === sku);
    if (chosen) onPlancha?.(modelName(chosen));
  }
  const planchaOption = (product: State['products'][number]) => <option key={product.sku} value={product.sku}>{modelName(product)}{stock.get(product.sku) ? ` · ${formatPallets(stock.get(product.sku)!)} palets` : ''}</option>;
  return <div className="production-plan">
    <div className="form-section"><Factory size={17}/>De planchas a cajas<small>Palets completos</small></div>
    {!planchas.length && !others.length ? <div className="callout orange">Da de alta las planchas en Referencias para poder planificar viajes.</div> : <InputField label="Plancha que se va a usar">
      <select required value={value.inputSku} onChange={event => choosePlancha(event.target.value)}>
        <option value="" disabled>Elegir plancha…</option>
        {withStock.length > 0 && <optgroup label="Con stock">{withStock.map(planchaOption)}</optgroup>}
        {withoutStock.length > 0 && <optgroup label="Sin stock ahora">{withoutStock.map(planchaOption)}</optgroup>}
        {others.length > 0 && <optgroup label="Otras referencias">{others.map(product => <option key={product.sku} value={product.sku}>{product.name}</option>)}</optgroup>}
      </select>
    </InputField>}
    {value.inputSku && <>
      <div className="form-grid">
        <InputField label="Se coge del bloque"><select required value={value.inputLocation} onChange={event => onChange({ ...value, inputLocation: event.target.value })}><option value="" disabled>Elegir bloque…</option>{sources.map(location => <option key={location.code} value={location.code}>{location.code} · {location.sku === value.inputSku && location.qty ? `${formatPallets(location.qty)} palets` : 'sin esta plancha'}</option>)}</select></InputField>
        <InputField label="Palets de planchas"><input required type="number" min="1" max="1000000" step="1" value={value.inputPallets} onChange={event => onChange({ ...value, inputPallets: Number(event.target.value) })}/></InputField>
        <InputField label="Caja que se produce"><select required value={value.outputSku} onChange={event => onChange({ ...value, outputSku: event.target.value, outputLocation: cajaDestinations(data, event.target.value, value.inputLocation)[0]?.code ?? '' })}><option value="" disabled>Elegir caja…</option>{cajas.map(product => <option key={product.sku} value={product.sku}>{product.name}</option>)}</select></InputField>
        <InputField label="Palets de cajas"><input required type="number" min="1" max="1000000" step="1" value={value.outputPallets} onChange={event => onChange({ ...value, outputPallets: Number(event.target.value) })}/></InputField>
      </div>
      {value.outputSku && (destinations.length ? <InputField label="Las cajas van al bloque"><select required value={value.outputLocation} onChange={event => onChange({ ...value, outputLocation: event.target.value })}><option value="" disabled>Elegir bloque…</option>{destinations.map(location => <option key={location.code} value={location.code}>{location.code} · {location.qty ? `${formatPallets(location.qty)} palets` : 'libre'}, caben {formatPallets(location.capacity - location.qty)} más</option>)}</select></InputField>
        : <div className="callout orange banner">No hay ningún bloque libre para estas cajas. Crea una ubicación en Ubicaciones.</div>)}
      {!pairedCaja(data, value.inputSku) && productKind(data.products.find(product => product.sku === value.inputSku) ?? { sku: value.inputSku, family: '' }) === 'plancha' && <p className="form-note">Este modelo todavía no tiene referencia de caja. Elige la caja en la lista o créala en Referencias.</p>}
      {source && (available === 0 ? <div className="callout orange banner">Ahora no hay stock de esta plancha en {source.code}. Puedes programar el viaje, pero para completarlo tendrá que haberlo.</div>
        : value.inputPallets > available ? <div className="callout orange banner">En {source.code} solo hay {formatPallets(available)} palets de esta plancha.</div>
        : target && value.outputPallets > room ? <div className="callout orange banner">En {target.code} solo caben {formatPallets(room)} palets más.</div>
        : target && <div className="callout banner">Quedarán {formatPallets(available - value.inputPallets)} palets de plancha en {source.code} y {formatPallets(target.qty + value.outputPallets)} de {target.capacity} en {target.code}.</div>)}
    </>}
  </div>;
}
const emptyProduction = (): ProductionSpecification => ({ inputSku: '', inputLocation: '', inputPallets: 1, outputSku: '', outputLocation: '', outputPallets: 1 });

function OrderEditor({ order, kind, data, busy, failure, onClose, onSave }: { order?: WorkOrder; kind: WorkOrderKind; data: State; busy: boolean; failure: string; onClose: () => void; onSave: (action: Record<string, unknown>) => Promise<boolean> }) {
  const [form, setForm] = useState({ kind: order?.kind ?? kind, title: order?.title ?? '', reference: order?.reference ?? '', truck: order?.truck ?? '', assignedTo: order?.assignedTo ?? '', instructions: order?.instructions ?? '', scheduledDate: order?.scheduledDate ?? madridDay(), scheduledTime: order?.scheduledTime ?? '', priority: order?.priority ?? 'normal', repeatEveryDays: order?.repeatEveryDays ?? 0 });
  const [production, setProduction] = useState(order?.production ?? emptyProduction());
  const [suggested, setSuggested] = useState('');
  const field = (key: string, value: string | number) => setForm(previous => ({ ...previous, [key]: value }));
  // Picking a plancha names the order, unless the person already wrote their own title.
  function suggestTitle(model: string) {
    const next = `Producir cajas ${model}`;
    setForm(previous => !previous.title.trim() || previous.title === suggested ? { ...previous, title: next } : previous);
    setSuggested(next);
  }
  async function submit(event: FormEvent) { event.preventDefault(); await onSave({ type: 'workOrder', ...(order ? { id: order.id } : {}), ...form, repeatEveryDays: ['mantenimiento', 'limpieza'].includes(form.kind) ? form.repeatEveryDays : 0, production: form.kind === 'viaje' ? production : null }); }
  return <Modal title={order ? 'Editar orden' : 'Nueva orden de trabajo'} description="Define el trabajo del equipo. El encargado decide cuándo empieza y cuándo se completa." onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}>
    <div className="form-grid"><InputField label="Tipo de trabajo"><select value={form.kind} disabled={!!order} onChange={event => field('kind', event.target.value)}>{kinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></InputField><InputField label="Prioridad"><select value={form.priority} onChange={event => field('priority', event.target.value)}><option value="normal">Normal, viajes primero</option><option value="urgente">Urgente</option></select></InputField></div>
    {form.kind === 'viaje' && <ProductionFields value={production} onChange={setProduction} data={data} onPlancha={suggestTitle}/>}
    <InputField label="Qué tiene que hacer el equipo"><input required maxLength={180} value={form.title} onChange={event => field('title', event.target.value)} placeholder={form.kind === 'viaje' ? 'Producir cajas para reponer la referencia…' : kindInfo(form.kind).description}/></InputField>
    <div className="form-grid"><InputField label="Día"><input required type="date" value={form.scheduledDate} onChange={event => field('scheduledDate', event.target.value)}/></InputField><InputField label="Hora prevista (opcional)"><input type="time" value={form.scheduledTime} onChange={event => field('scheduledTime', event.target.value)}/></InputField><InputField label="Referencia o pedido"><input maxLength={180} value={form.reference} onChange={event => field('reference', event.target.value)} placeholder="Número de pedido"/></InputField><InputField label="Asignada a"><input maxLength={180} value={form.assignedTo} onChange={event => field('assignedTo', event.target.value)} placeholder="Equipo de almacén"/></InputField></div>
    {['carga', 'descarga'].includes(form.kind) && <InputField label="Matrícula o transportista"><input maxLength={180} value={form.truck} onChange={event => field('truck', event.target.value)} placeholder="1234 ABC, transportista"/></InputField>}
    <InputField label="Instrucciones para la pantalla"><textarea maxLength={1000} value={form.instructions} onChange={event => field('instructions', event.target.value)} placeholder="Cantidad prevista, máquina, zona o indicaciones para el equipo" rows={3}/></InputField>
    {['mantenimiento', 'limpieza'].includes(form.kind) && <InputField label="Repetir después de completar"><select value={form.repeatEveryDays} onChange={event => field('repeatEveryDays', Number(event.target.value))}><option value={0}>Solo esta vez</option><option value={1}>Al día siguiente</option><option value={7}>A los 7 días</option><option value={14}>A los 14 días</option><option value={30}>A los 30 días</option><option value={90}>A los 90 días</option></select></InputField>}
    {form.kind === 'viaje' && <p className="form-note">El stock se actualiza al completar el viaje; entonces se confirman las cantidades reales.</p>}
    {failure && <div className="callout error form-error" role="alert">{failure}</div>}
    <div className="dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Volver</button><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar orden'}</button></div>
  </form></Modal>;
}

function ShiftEditor({ shift, busy, failure, onClose, onSave }: { shift: ShiftSettings; busy: boolean; failure: string; onClose: () => void; onSave: (shift: ShiftSettings) => Promise<void> }) {
  const [form, setForm] = useState(shift);
  return <Modal title="Horarios y aviso" description="Se muestran en la pantalla del almacén. El almuerzo se repite cada día hasta que lo cambies." onClose={() => { if (!busy) onClose(); }}><form onSubmit={async event => { event.preventDefault(); await onSave(form); }}>
    <div className="form-grid">{([['startTime', 'Inicio del turno'], ['endTime', 'Fin del turno'], ['lunchStart', 'Inicio del almuerzo'], ['lunchEnd', 'Fin del almuerzo']] as const).map(([key, label]) => <InputField key={key} label={label}><input type="time" required={key === 'startTime' || key === 'endTime'} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}/></InputField>)}</div>
    <p className="form-note">Deja vacías las horas del almuerzo si todavía no está acordado.</p>
    <InputField label="Aviso para el equipo"><textarea rows={4} maxLength={1000} value={form.announcement} onChange={event => setForm({ ...form, announcement: event.target.value })} placeholder="Instrucciones generales para este turno"/></InputField>
    {failure && <div className="callout error form-error" role="alert">{failure}</div>}
    <div className="dialog-actions"><button type="button" className="btn secondary" onClick={onClose} disabled={busy}>Volver</button><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Publicar'}</button></div>
  </form></Modal>;
}

function CompletionDialog({ order, data, busy, failure, onClose, onSave }: { order: WorkOrder; data: State; busy: boolean; failure: string; onClose: () => void; onSave: (action: Record<string, unknown>) => Promise<void> }) {
  const [production, setProduction] = useState(order.production ?? emptyProduction());
  const [labelled, setLabelled] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [safe, setSafe] = useState(false);
  const viaje = order.kind === 'viaje';
  return <Modal title={viaje ? 'Completar viaje y actualizar stock' : 'Completar orden'} description={order.title} onClose={() => { if (!busy) onClose(); }}><form onSubmit={async event => { event.preventDefault(); await onSave({ type: 'workOrderStatus', id: order.id, status: 'completada', ...(viaje ? { production, labelled, stacked, safe } : {}) }); }}>
    {viaje ? <><ProductionFields value={production} onChange={value => { setProduction(value); setLabelled(false); setSafe(false); }} data={data}/><p className="form-note">Confirma las cantidades reales. El consumo de planchas y el alta de cajas se guardan juntos, vinculados a este viaje.</p>
      <div className="checks"><label className="tick"><input type="checkbox" required checked={labelled} onChange={event => setLabelled(event.target.checked)}/><span>He comprobado cantidades y etiquetas visibles en las cajas producidas.</span></label><label className="tick"><input type="checkbox" checked={stacked} onChange={event => { setStacked(event.target.checked); setSafe(false); }}/><span>La producción se almacena a doble altura.</span></label>{stacked && <label className="tick"><input type="checkbox" required checked={safe} onChange={event => setSafe(event.target.checked)}/><span>Apilado autorizado y palet inferior revisado.</span></label>}</div></>
      : <p className="dialog-copy">Confirma que el trabajo está terminado.{['carga', 'descarga'].includes(order.kind) && ' Este cierre registra el trabajo del camión; la entrada o salida de palets se registra aparte, en Movimientos.'}{order.repeatEveryDays > 0 && ` La siguiente se programará dentro de ${order.repeatEveryDays} días.`}</p>}
    {failure && <div className="callout error form-error" role="alert">{failure}</div>}
    <div className="dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Volver</button><button className="btn primary" disabled={busy || (viaje && (!labelled || (stacked && !safe)))}>{busy ? 'Guardando…' : viaje ? 'Completar y registrar' : 'Confirmar'}</button></div>
  </form></Modal>;
}

interface ManagedUser extends PublicUser { active: boolean; bootstrap?: boolean }
function UsersPanel({ user }: { user: PublicUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'encargado' });
  const [loaded, setLoaded] = useState(false);
  async function load() {
    try { const response = await fetch('/api/users', { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pueden cargar los usuarios.'); setUsers(result.users); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sin conexión.'); }
    finally { setLoaded(true); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/users', { cache: 'no-store', signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pueden cargar los usuarios.'); return result; })
      .then(result => { setUsers(result.users); setLoaded(true); })
      .catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Sin conexión.'); setLoaded(true); } });
    return () => controller.abort();
  }, []);
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se puede guardar.'); await load(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sin conexión.'); return false; }
    finally { setBusy(false); }
  }
  const roleName: Record<string, string> = { administrador: 'Administrador', encargado: 'Encargado', pantalla: 'Pantalla' };
  return <>
    <div className="roles">
      <div className="group"><ShieldCheck size={22}/><h3>Administrador</h3><p>Visión global, todas las operaciones y gestión de accesos.</p></div>
      <div className="group"><ClipboardList size={22}/><h3>Encargado</h3><p>Organiza el turno, registra producción y gestiona el inventario.</p></div>
      <div className="group"><Monitor size={22}/><h3>Pantalla</h3><p>Consulta las instrucciones del turno. No modifica datos.</p></div>
    </div>
    <section className="group">
      <div className="group-head"><div><h2>Accesos al almacén</h2><p>Desactivar un perfil revoca su acceso y conserva la autoría de lo que hizo.</p></div><button className="btn primary" onClick={() => { setError(''); setForm({ name: '', username: '', password: '', role: 'encargado' }); setOpen(true); }}><Plus size={15}/> Añadir perfil</button></div>
      {error && !open && !removing && <div className="pad"><div className="callout error" role="alert">{error}</div></div>}
      {!loaded ? <p className="quiet">Cargando perfiles…</p> : <div className="list">{users.map(account => <div className="row with-icon" key={account.id}>
        <span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span>
        <div className="row-main"><b>{account.name}</b><small>{account.username}, {roleName[account.role] ?? account.role}</small></div>
        <div className="row-end"><span className={'pill ' + (account.active ? 'green' : '')}>{account.active ? 'Activo' : 'Desactivado'}</span>{account.bootstrap ? <span>Cuenta principal</span> : account.id === user.id ? <span>Tu cuenta</span> : account.active && <button className="btn plain" style={{ color: 'var(--red)' }} onClick={() => { setError(''); setRemoving(account); }}>Desactivar</button>}</div>
      </div>)}</div>}
    </section>
    {open && <Modal title="Añadir perfil" description="Un acceso individual, o uno de consulta para el dispositivo de la pantalla." onClose={() => { if (!busy) setOpen(false); }}><form onSubmit={async event => { event.preventDefault(); if (await send({ type: 'create', ...form })) { setOpen(false); setForm({ name: '', username: '', password: '', role: 'encargado' }); } }}>
      <InputField label="Nombre"><input required maxLength={100} autoComplete="off" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></InputField>
      <InputField label="Usuario"><input required maxLength={64} autoComplete="off" autoCapitalize="none" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })}/></InputField>
      <InputField label="Perfil"><select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}><option value="encargado">Encargado</option><option value="administrador">Administrador</option><option value="pantalla">Pantalla de solo lectura</option></select></InputField>
      <InputField label="Contraseña (mínimo 12 caracteres)"><input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })}/></InputField>
      {error && <div className="callout error form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="btn secondary" onClick={() => setOpen(false)} disabled={busy}>Volver</button><button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear perfil'}</button></div>
    </form></Modal>}
    {removing && <Modal title="Desactivar acceso" description="La persona o pantalla pierde el acceso, también si tenía una sesión abierta." onClose={() => { if (!busy) setRemoving(null); }}><p className="dialog-copy">Se desactivará el perfil de <b>{removing.name}</b>. Sus órdenes y operaciones se conservan.</p>{error && <div className="callout error form-error" role="alert">{error}</div>}<div className="dialog-actions"><button className="btn secondary" onClick={() => setRemoving(null)} disabled={busy}>Volver</button><button className="btn danger" disabled={busy} onClick={async () => { if (await send({ type: 'delete', id: removing.id })) setRemoving(null); }}>{busy ? 'Desactivando…' : 'Desactivar perfil'}</button></div></Modal>}
  </>;
}

