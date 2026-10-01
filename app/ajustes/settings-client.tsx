'use client';
import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CalendarClock, ChevronDown, ChevronUp, Factory, Monitor, Package, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, Wrench } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useWarehouse } from '@/hooks/use-warehouse';
import { madridDay, type Location, type State } from '@/lib/warehouse';
import type { WorkOrderKind } from '@/lib/operations';
import type { PublicUser } from '@/lib/identity';
import { brand } from '@/lib/brand';
import { defaultAppearance, defaultBoard, defaultPriorities, describeRule, nextOccurrences, readableOn, ruleWindow, weekdayNames, weekdayOf, type Appearance, type BoardTheme, type RuleKind, type ShiftRule } from '@/lib/settings';
import { BOXES_PER_LAYER, DEFAULT_BOXES_PER_PALLET, DEFAULT_LAYERS, formatPallets, modelName, productKind, stockBySku } from '@/lib/warehouse-insights';
import AppShell from '../components/app-shell';
import { useAppReady } from '../components/app-loader';
import Logo from '../components/logo';
import ProfileSettings, { TeamSettings } from './profile-settings';
import '../components/management.css';
import './settings.css';

type Section = 'perfil' | 'equipo' | 'normas' | 'inventario' | 'apariencia' | 'pantalla';
const adminSections: [Section, string][] = [['equipo', 'Equipo'], ['normas', 'Normas'], ['inventario', 'Inventario'], ['apariencia', 'Apariencia'], ['pantalla', 'Pantalla']];
type Commit = (action: Record<string, unknown>, message: string) => Promise<boolean>;

const kindInfo: Record<WorkOrderKind, { label: string; detail: string; Icon: typeof Factory }> = {
  pedido: { label: 'Pedidos que entran', detail: 'Preparar lo que piden los clientes', Icon: Package },
  viaje: { label: 'Reposición de stock', detail: 'Viajes de producción: planchas a cajas', Icon: Factory },
  carga: { label: 'Cargas de camión', detail: 'Expediciones', Icon: ArrowUpFromLine },
  descarga: { label: 'Descargas de camión', detail: 'Mercancía que llega', Icon: ArrowDownToLine },
  mantenimiento: { label: 'Mantenimiento', detail: 'Máquinas, carretillas y equipos', Icon: Wrench },
  limpieza: { label: 'Limpieza', detail: 'Puestos y zonas comunes', Icon: Sparkles },
};
const dayLabel = (day: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(day + 'T12:00:00Z'));
/** The next date (today included) that falls on an ISO weekday. */
function nextWeekday(from: string, weekday: number) {
  const date = new Date(from + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + ((weekday - weekdayOf(from) + 7) % 7));
  return date.toISOString().slice(0, 10);
}

export default function SettingsClient({ user }: { user: PublicUser }) {
  const [profile, setProfile] = useState(user);
  if (user.role === 'pantalla') return <DisplayProfileSettings user={profile} onUpdate={setProfile}/>;
  return <ManagementSettings user={profile} onUpdate={setProfile}/>;
}

function DisplayProfileSettings({ user, onUpdate }: { user: PublicUser; onUpdate: (user: PublicUser) => void }) {
  return <div className="settings-display">
    <Toaster position="bottom-right"/>
    <header className="settings-display-bar"><Link href="/pantalla" className="btn secondary"><ArrowLeft size={16}/> Volver a la pantalla</Link><span className="settings-display-brand"><Logo size={28}/> Burriana</span></header>
    <main className="settings-display-content">
      <header className="page-head"><div><h1>Ajustes</h1><p>Tu perfil y la seguridad de tu cuenta.</p></div></header>
      <ProfileSettings user={user} onUpdate={onUpdate}/>
    </main>
  </div>;
}

function ManagementSettings({ user, onUpdate }: { user: PublicUser; onUpdate: (user: PublicUser) => void }) {
  const { data, loading, error, busy, updatedAt, refresh, save } = useWarehouse();
  const params = useSearchParams();
  const requested = params.get('seccion') as Section | null;
  const sections: [Section, string][] = [['perfil', 'Mi perfil'], ...(user.role === 'administrador' ? adminSections : [])];
  const section: Section = requested && sections.some(([key]) => key === requested) ? requested : 'perfil';
  const warehouseSection = section !== 'perfil' && section !== 'equipo';
  useAppReady(!warehouseSection || !loading);
  const today = madridDay();

  const commit: Commit = async (action, message) => {
    try { if (await save(action)) { toast.success(message); return true; } }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'No se ha podido guardar.'); }
    return false;
  };
  const go = (next: Section) => window.history.replaceState(null, '', `/ajustes?seccion=${next}`);

  return <AppShell user={user} active="ajustes" data={data} sync={{ updatedAt, error, busy, refresh }}>
    <Toaster position="bottom-right"/>
    <header className="page-head">
      <div><h1>Ajustes</h1><p>{user.role === 'administrador' ? 'Tu cuenta, los accesos del equipo y las preferencias del almacén.' : 'Tu perfil y la seguridad de tu cuenta.'}</p></div>
    </header>
    {sections.length > 1 && <div className="settings-sections"><div className="segmented" role="group" aria-label="Apartado de ajustes">{sections.map(([key, label]) => <button key={key} aria-pressed={section === key} onClick={() => go(key)}>{label}</button>)}</div></div>}
    {section === 'perfil' && <ProfileSettings user={user} onUpdate={onUpdate}/>}
    {section === 'equipo' && <TeamSettings/>}
    {warehouseSection && error && <div className="callout error banner" role="alert">{error}<button className="btn secondary" onClick={refresh}>Reintentar</button></div>}
    {warehouseSection && (loading ? <div className="loading">Cargando los ajustes…</div> : !error && <>
      {section === 'normas' && <>
        <Priorities key={JSON.stringify(data.settings.priorities)} saved={data.settings.priorities} busy={busy} commit={commit}/>
        <Rules rules={data.settings.rules} shift={data.shift} today={today} busy={busy} commit={commit}/>
      </>}
      {section === 'inventario' && <>
        <Adjustments data={data} busy={busy} commit={commit}/>
        <BoxesPerPallet data={data} busy={busy} commit={commit}/>
      </>}
      {section === 'apariencia' && <AppearanceEditor key={JSON.stringify(data.settings.appearance)} saved={data.settings.appearance} busy={busy} commit={commit}/>}
      {section === 'pantalla' && <BoardEditor key={JSON.stringify(data.settings.board)} saved={data.settings.board} logo={data.settings.appearance} busy={busy} commit={commit}/>}
    </>)}
  </AppShell>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sheet"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }

/* ─── Normas: priority ─────────────────────────────────────────────────── */
function Priorities({ saved, busy, commit }: { saved: WorkOrderKind[] | null; busy: boolean; commit: Commit }) {
  const [list, setList] = useState<WorkOrderKind[]>(saved ?? defaultPriorities());
  const dirty = !saved || JSON.stringify(list) !== JSON.stringify(saved);
  const move = (index: number, step: number) => setList(previous => { const next = [...previous]; [next[index], next[index + step]] = [next[index + step], next[index]]; return next; });
  return <section className="group">
    <div className="group-head"><div><h2>Orden de prioridad</h2><p>Lo que está en marcha y lo marcado como urgente va siempre primero. Después, el trabajo se ordena así en Organización, Inicio y la pantalla del almacén.</p></div></div>
    {!saved && <div className="pad" style={{ paddingBottom: 12 }}><div className="callout">Ahora se usa la regla original: los viajes primero y el resto por fecha. Guarda un orden para sustituirla.</div></div>}
    <ol className="priority-list">{list.map((kind, index) => { const { label, detail, Icon } = kindInfo[kind]; return <li key={kind}>
      <span className="priority-rank">{index + 1}</span><span className={'kind-tile ' + kind}><Icon size={17}/></span>
      <span className="row-main"><b>{label}</b><small>{detail}</small></span>
      <button className="icon-btn" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={18}/></button>
      <button className="icon-btn" aria-label={`Bajar ${label}`} disabled={index === list.length - 1} onClick={() => move(index, 1)}><ChevronDown size={18}/></button>
    </li>; })}</ol>
    <div className="group-foot" style={{ flexWrap: 'wrap' }}>
      <button className="btn plain" style={{ marginLeft: 0 }} onClick={() => setList(['pedido', 'viaje', 'carga', 'descarga', 'mantenimiento', 'limpieza'])}>Pedidos, después reposición y al final mantenimiento</button>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {saved && <button className="btn secondary" disabled={busy} onClick={() => commit({ type: 'settings', section: 'priorities', value: null }, 'Vuelve la regla «viajes primero».')}>Volver a viajes primero</button>}
        <button className="btn primary" disabled={busy || !dirty} onClick={() => commit({ type: 'settings', section: 'priorities', value: list }, 'Prioridad guardada.')}>Guardar prioridad</button>
      </span>
    </div>
  </section>;
}

/* ─── Normas: fixed blocks of the shift ────────────────────────────────── */
type RuleDraft = Omit<ShiftRule, 'id'> & { id?: string };
const blankRule = (today: string): RuleDraft => ({ title: '', kind: 'mantenimiento', weekday: 5, everyWeeks: 1, startDate: nextWeekday(today, 5), timing: { mode: 'final', hours: 2 }, notes: '', active: true });

function Rules({ rules, shift, today, busy, commit }: { rules: ShiftRule[]; shift: State['shift']; today: string; busy: boolean; commit: Commit }) {
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [removing, setRemoving] = useState<ShiftRule | null>(null);
  const preset = (): RuleDraft => ({ ...blankRule(today), title: 'Mantenimiento y limpieza', everyWeeks: 2, notes: 'Parar la producción, revisar carretillas y máquinas y limpiar los puestos.' });
  return <section className="group">
    <div className="group-head"><div><h2>Franjas fijas del turno</h2><p>Normas que se repiten, como dedicar las últimas horas de algunos viernes al mantenimiento. Aparecen en Inicio, Organización y la pantalla del almacén.</p></div><button className="btn primary" onClick={() => setEditing(blankRule(today))}><Plus size={15}/> Nueva norma</button></div>
    {rules.length ? <ul className="list">{rules.map(rule => { const slot = ruleWindow(rule, shift); const next = nextOccurrences(rule, today, 3); return <li className="row with-icon" key={rule.id}>
      <span className={'kind-tile ' + (rule.kind === 'otro' ? 'pedido' : rule.kind)}><CalendarClock size={17}/></span>
      <div className="row-main"><b>{rule.title}</b><small>{describeRule(rule)}: hoy sería de {slot.start} a {slot.end}.</small>{rule.active && next.length > 0 && <small>Próximas: {next.map(dayLabel).join(', ')}</small>}</div>
      <div className="row-end"><span className={'pill ' + (rule.active ? 'green' : '')}>{rule.active ? 'Activa' : 'En pausa'}</span>
        <button className="icon-btn" aria-label={`Editar ${rule.title}`} onClick={() => setEditing(rule)}><Pencil size={15}/></button>
        <button className="icon-btn" aria-label={`Borrar ${rule.title}`} onClick={() => setRemoving(rule)}><Trash2 size={15}/></button></div>
    </li>; })}</ul>
      : <div className="empty"><CalendarClock size={28} strokeWidth={1.5}/><h3>Sin normas todavía</h3><p>Por ejemplo: mantenimiento y limpieza cada dos viernes, las dos últimas horas del turno.</p><button className="btn secondary" onClick={() => setEditing(preset())}>Crear esa norma</button></div>}
    {editing && <RuleDialog draft={editing} shift={shift} today={today} busy={busy} onClose={() => setEditing(null)} onSave={async value => { if (await commit({ type: 'settings', section: 'rule', value }, value.id ? 'Norma actualizada.' : 'Norma creada.')) setEditing(null); }}/>}
    {removing && <Modal title="Borrar norma" description="Dejará de aparecer en la app y en la pantalla. Las órdenes ya creadas no cambian." onClose={() => setRemoving(null)}>
      <p className="dialog-copy">{removing.title}: {describeRule(removing).toLowerCase()}.</p>
      <div className="dialog-actions"><button className="btn secondary" onClick={() => setRemoving(null)}>Volver</button><button className="btn danger" disabled={busy} onClick={async () => { if (await commit({ type: 'settings', section: 'deleteRule', id: removing.id }, 'Norma borrada.')) setRemoving(null); }}>Borrar norma</button></div>
    </Modal>}
  </section>;
}

function RuleDialog({ draft, shift, today, busy, onClose, onSave }: { draft: RuleDraft; shift: State['shift']; today: string; busy: boolean; onClose: () => void; onSave: (value: RuleDraft) => Promise<void> }) {
  const [form, setForm] = useState<RuleDraft>(draft);
  const set = (patch: Partial<RuleDraft>) => setForm(previous => ({ ...previous, ...patch }));
  const preview = { ...form, id: 'vista', active: true } as ShiftRule;
  const consistent = weekdayOf(form.startDate) === form.weekday;
  const slot = ruleWindow(preview, shift);
  async function submit(event: FormEvent) { event.preventDefault(); await onSave(form); }
  return <Modal title={draft.id ? 'Editar norma' : 'Nueva norma'} description="Una franja que se repite dentro del turno." onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <Field label="Nombre"><input required maxLength={120} value={form.title} onChange={event => set({ title: event.target.value })} placeholder="Mantenimiento y limpieza"/></Field>
      <div className="form-grid">
        <Field label="Tipo"><select value={form.kind} onChange={event => set({ kind: event.target.value as RuleKind })}><option value="mantenimiento">Mantenimiento</option><option value="limpieza">Limpieza</option><option value="otro">Otro</option></select></Field>
        <Field label="Día de la semana"><select value={form.weekday} onChange={event => { const weekday = Number(event.target.value); set({ weekday, startDate: nextWeekday(form.startDate < today ? today : form.startDate, weekday) }); }}>{weekdayNames.map((name, index) => <option key={name} value={index + 1}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></Field>
        <Field label="Se repite"><select value={form.everyWeeks} onChange={event => set({ everyWeeks: Number(event.target.value) })}>{[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n === 1 ? 'Todas las semanas' : `Cada ${n} semanas`}</option>)}</select></Field>
        <Field label="Primer día"><input type="date" required value={form.startDate} onChange={event => set({ startDate: event.target.value })}/></Field>
      </div>
      <div className="field"><span>Cuándo, dentro del turno</span><div className="segmented" role="group" aria-label="Cuándo">
        <button type="button" aria-pressed={form.timing.mode === 'final'} onClick={() => set({ timing: { mode: 'final', hours: form.timing.mode === 'final' ? form.timing.hours : 2 } })}>Últimas horas del turno</button>
        <button type="button" aria-pressed={form.timing.mode === 'horario'} onClick={() => set({ timing: { mode: 'horario', start: slot.start, end: slot.end } })}>Horario fijo</button>
      </div></div>
      {form.timing.mode === 'final' ? <Field label="Horas al final del turno"><input type="number" min={0.25} max={12} step={0.25} required value={form.timing.hours} onChange={event => set({ timing: { mode: 'final', hours: Number(event.target.value) } })}/></Field>
        : <div className="form-grid"><Field label="Desde"><input type="time" required value={form.timing.start} onChange={event => set({ timing: { ...form.timing, mode: 'horario', start: event.target.value } as ShiftRule['timing'] })}/></Field><Field label="Hasta"><input type="time" required value={form.timing.end} onChange={event => set({ timing: { ...form.timing, mode: 'horario', end: event.target.value } as ShiftRule['timing'] })}/></Field></div>}
      <Field label="Indicaciones para el equipo (opcional)"><textarea maxLength={500} rows={2} value={form.notes} onChange={event => set({ notes: event.target.value })}/></Field>
      <label className="tick" style={{ marginBottom: 14 }}><input type="checkbox" checked={form.active} onChange={event => set({ active: event.target.checked })}/><span>Norma activa</span></label>
      <div className={'callout ' + (consistent ? '' : 'orange')}>{consistent
        ? <div><b>{describeRule(preview)}.</b> Con el turno actual ({shift.startTime}–{shift.endTime}) será de {slot.start} a {slot.end}. Próximas: {nextOccurrences(preview, today, 3).map(dayLabel).join(', ')}.</div>
        : <div>El primer día tiene que ser {weekdayNames[form.weekday - 1]}.</div>}</div>
      <div className="dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !consistent}>{busy ? 'Guardando…' : 'Guardar norma'}</button></div>
    </form>
  </Modal>;
}

/* ─── Inventario: direct corrections ───────────────────────────────────── */
function Adjustments({ data, busy, commit }: { data: State; busy: boolean; commit: Commit }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Location | null>(null);
  const names = useMemo(() => new Map(data.products.map(product => [product.sku, product.name])), [data.products]);
  const term = search.trim().toLocaleLowerCase('es');
  const rows = [...data.locations].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }))
    .filter(location => !term || `${location.code} ${location.sku} ${names.get(location.sku) ?? ''}`.toLocaleLowerCase('es').includes(term));
  return <section className="group">
    <div className="group-head"><div><h2>Corrección directa del stock</h2><p>Cambia lo que hay en un bloque sin registrar una entrada o salida. Queda anotado en Movimientos como «Ajuste», con tu nombre, la cantidad anterior y el motivo.</p></div></div>
    <div className="group-tools"><label className="search-field"><Search size={15}/><input aria-label="Buscar bloque o referencia" placeholder="Buscar bloque o referencia" value={search} onChange={event => setSearch(event.target.value)}/></label><span className="count">{rows.length} bloques</span></div>
    <div className="table-wrap"><table className="table"><thead><tr><th>Bloque</th><th>Referencia</th><th className="right">Palets</th><th className="right">Capacidad</th><th/></tr></thead><tbody>
      {rows.map(location => <tr key={location.id}>
        <td><b>{location.code}</b><small>{location.zone}</small></td>
        <td>{location.qty ? names.get(location.sku) ?? location.sku : <span style={{ color: 'var(--ink-3)' }}>Vacío</span>}</td>
        <td className="right num"><b>{formatPallets(location.qty)}</b></td>
        <td className="right num">{location.capacity}</td>
        <td className="right"><button className="btn secondary" style={{ height: 30 }} onClick={() => setEditing(location)}>Corregir</button></td>
      </tr>)}
    </tbody></table></div>
    {editing && <AdjustDialog location={editing} data={data} busy={busy} onClose={() => setEditing(null)} onSave={async action => { if (await commit(action, `Stock de ${editing.code} corregido.`)) setEditing(null); }}/>}
  </section>;
}

function AdjustDialog({ location, data, busy, onClose, onSave }: { location: Location; data: State; busy: boolean; onClose: () => void; onSave: (action: Record<string, unknown>) => Promise<void> }) {
  const [sku, setSku] = useState(location.sku);
  const [qty, setQty] = useState(location.qty);
  const [capacity, setCapacity] = useState(location.capacity);
  const [reason, setReason] = useState('');
  const products = [...data.products].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return <Modal title={`Corregir ${location.code}`} description="El cambio se guarda como un ajuste en el historial de movimientos." onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={async event => { event.preventDefault(); await onSave({ type: 'adjust', location: location.code, sku: qty ? sku : '', qty, capacity, reason }); }}>
      <Field label="Referencia"><select required={qty > 0} value={sku} onChange={event => setSku(event.target.value)}><option value="">Vacío</option>{products.map(product => <option key={product.id} value={product.sku}>{product.name} · {product.sku}</option>)}</select></Field>
      <div className="form-grid">
        <Field label="Palets que hay de verdad"><input type="number" min={0} step={0.25} max={1000000} required value={qty} onChange={event => setQty(Number(event.target.value))}/></Field>
        <Field label="Capacidad del bloque"><input type="number" min={1} step={1} max={1000000} required value={capacity} onChange={event => setCapacity(Number(event.target.value))}/></Field>
      </div>
      <Field label="Motivo"><textarea maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="Recuento físico, error de anotación…"/></Field>
      <div className="callout">Ahora: {location.qty ? `${formatPallets(location.qty)} palets de ${data.products.find(product => product.sku === location.sku)?.name ?? location.sku}` : 'vacío'}. Después: {qty ? `${formatPallets(qty)} palets${sku ? ` de ${data.products.find(product => product.sku === sku)?.name ?? sku}` : ''}` : 'vacío'}.</div>
      <div className="dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || (qty > 0 && !sku)}>{busy ? 'Guardando…' : 'Guardar corrección'}</button></div>
    </form>
  </Modal>;
}

/* ─── Inventario: boxes per pallet ─────────────────────────────────────── */
function BoxesPerPallet({ data, busy, commit }: { data: State; busy: boolean; commit: Commit }) {
  const stock = stockBySku(data);
  const cajas = data.products.filter(product => productKind(product) === 'caja').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const [values, setValues] = useState<Record<string, string>>({});
  const value = (sku: string, saved?: number) => values[sku] ?? (saved ? String(saved) : '');
  return <section className="group">
    <div className="group-head"><div><h2>Cajas por palet</h2><p>Cada capa lleva {BOXES_PER_LAYER} cajas (3 a lo largo y 2 a lo ancho) y un palet suele tener 10 u 11 capas: {BOXES_PER_LAYER * 10} o {BOXES_PER_LAYER * 11} cajas. Si un modelo no tiene dato se calcula con {DEFAULT_BOXES_PER_PALLET} ({DEFAULT_LAYERS} capas). La vista 3D usa esta cifra para la altura de cada palet.</p></div></div>
    {cajas.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Modelo</th><th className="right">Palets</th><th style={{ width: 150 }}>Cajas por palet</th><th className="right">Cajas en stock</th><th/></tr></thead><tbody>
      {cajas.map(product => { const current = value(product.sku, product.boxesPerPallet); const number = Number(current); const changed = current !== (product.boxesPerPallet ? String(product.boxesPerPallet) : ''); const pallets = stock.get(product.sku) ?? 0;
        return <tr key={product.id}>
          <td><b>{modelName(product)}</b><small className="mono">{product.sku}</small></td>
          <td className="right num">{formatPallets(pallets)}</td>
          <td><div className="field" style={{ margin: 0 }}><input type="number" min={1} step={1} inputMode="numeric" aria-label={`Cajas por palet de ${product.name}`} placeholder={`${DEFAULT_BOXES_PER_PALLET} (estimado)`} value={current} onChange={event => setValues(previous => ({ ...previous, [product.sku]: event.target.value }))} style={{ minHeight: 34, padding: '4px 10px' }}/></div></td>
          <td className="right num">{number > 0 ? Math.round(pallets * number).toLocaleString('es-ES') : `≈ ${Math.round(pallets * DEFAULT_BOXES_PER_PALLET).toLocaleString('es-ES')}`}</td>
          <td className="right">{changed && <button className="btn primary" style={{ height: 30 }} disabled={busy || (current !== '' && !(Number.isInteger(number) && number > 0))} onClick={async () => { if (await commit({ type: 'product', id: product.id, sku: product.sku, name: product.name, family: product.family, minimum: product.minimum, boxesPerPallet: current === '' ? 0 : number }, `Cajas por palet de ${modelName(product)} guardadas.`)) setValues(previous => { const next = { ...previous }; delete next[product.sku]; return next; }); }}>Guardar</button>}</td>
        </tr>; })}
    </tbody></table></div> : <p className="quiet">No hay referencias de cajas en el catálogo.</p>}
  </section>;
}

/* ─── Apariencia ───────────────────────────────────────────────────────── */
function ColorField({ label, detail, value, onChange }: { label: string; detail: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-field"><input type="color" value={value} onChange={event => onChange(event.target.value.toUpperCase())}/><span><b>{label}</b><small>{detail}</small></span><code>{value}</code></label>;
}
const appearancePresets: [string, Appearance][] = [
  ['Original', defaultAppearance()],
  ['Grupo Trimodos', { accent: brand.azul, selection: brand.negro, logoStroke: brand.lima, logoTile: brand.negro }],
  ['Stinsa', { accent: '#0E8C7B', selection: '#16302C', logoStroke: brand.turquesa, logoTile: '#16302C' }],
  ['Transargi', { accent: '#C9542A', selection: '#3A2418', logoStroke: brand.naranja, logoTile: '#2A1A12' }],
];
function AppearanceEditor({ saved, busy, commit }: { saved: Appearance; busy: boolean; commit: Commit }) {
  const [form, setForm] = useState(saved);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const vars = { '--action': form.accent, '--on-action': readableOn(form.accent), '--selection': form.selection, '--on-selection': readableOn(form.selection), '--logo-stroke': form.logoStroke, '--logo-tile': form.logoTile } as CSSProperties;
  return <div className="grid-2">
    <section className="group">
      <div className="group-head"><div><h2>Colores de la app</h2><p>Se aplican a todas las personas al guardar.</p></div></div>
      <div className="pad">
        <ColorField label="Acento" detail="Botones principales, enlaces y casillas" value={form.accent} onChange={accent => setForm({ ...form, accent })}/>
        <ColorField label="Selección" detail="Sección elegida en el menú y filtros activos" value={form.selection} onChange={selection => setForm({ ...form, selection })}/>
        <ColorField label="Logo" detail="Color del emblema" value={form.logoStroke} onChange={logoStroke => setForm({ ...form, logoStroke })}/>
        <ColorField label="Fondo del logo" detail="El cuadrado detrás del emblema" value={form.logoTile} onChange={logoTile => setForm({ ...form, logoTile })}/>
        <div className="presets">{appearancePresets.map(([name, preset]) => <button key={name} className="btn secondary" onClick={() => setForm(preset)}><i style={{ background: preset.accent }}/><i style={{ background: preset.logoStroke }}/>{name}</button>)}</div>
      </div>
      <div className="group-foot"><button className="btn secondary" style={{ marginLeft: 0 }} disabled={busy} onClick={() => commit({ type: 'settings', section: 'appearance', value: null }, 'Colores originales restaurados.')}><RotateCcw size={14}/> Restaurar originales</button><button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy || !dirty} onClick={() => commit({ type: 'settings', section: 'appearance', value: form }, 'Colores guardados.')}>Guardar colores</button></div>
    </section>
    <section className="group preview" style={vars}>
      <div className="group-head"><div><h2>Vista previa</h2></div></div>
      <div className="pad">
        <div className="preview-sidebar">
          <div className="wordmark"><span className="glyph"><Logo variant="tema" size="62%"/></span>Burriana</div>
          <div className="nav-group"><a aria-current="page"><Factory size={17}/>Organización</a><a><Package size={17}/>Existencias</a></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <button className="btn primary">Nueva orden</button><button className="btn secondary">Horarios</button><span className="link">Ver todas</span>
        </div>
        <div className="chips" style={{ marginTop: 16 }}><button aria-pressed="true">Todo <b>4</b></button><button>Pedidos <b>2</b></button></div>
      </div>
    </section>
  </div>;
}

/* ─── Pantalla ─────────────────────────────────────────────────────────── */
const boardPresets: [string, BoardTheme][] = [
  ['Oscuro', defaultBoard()],
  ['Grupo Trimodos', { background: brand.negro, panel: '#2A2A27', accent: brand.lima, text: '#F4F4EF' }],
  ['Claro', { background: '#F4F4EF', panel: '#FFFFFF', accent: brand.azul, text: brand.negro }],
  ['Alto contraste', { background: '#000000', panel: '#141414', accent: '#FFD60A', text: '#FFFFFF' }],
];
function BoardEditor({ saved, logo, busy, commit }: { saved: BoardTheme; logo: Appearance; busy: boolean; commit: Commit }) {
  const [form, setForm] = useState(saved);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const mix = (a: string, share: number, b: string) => `color-mix(in srgb, ${a} ${share}%, ${b})`;
  const vars = { background: form.background, color: form.text } as CSSProperties;
  return <div className="grid-2">
    <section className="group">
      <div className="group-head"><div><h2>Colores de la pantalla del almacén</h2><p>La pantalla los recoge sola en unos segundos, sin recargarla.</p></div><a className="btn secondary" href="/pantalla" target="_blank" rel="noreferrer"><Monitor size={15}/> Abrir</a></div>
      <div className="pad">
        <ColorField label="Fondo" detail="Detrás de todo" value={form.background} onChange={background => setForm({ ...form, background })}/>
        <ColorField label="Paneles" detail="Turno, listas y avisos" value={form.panel} onChange={panel => setForm({ ...form, panel })}/>
        <ColorField label="Acento" detail="Trabajo en marcha, almuerzo y normas activas" value={form.accent} onChange={accent => setForm({ ...form, accent })}/>
        <ColorField label="Texto" detail="Títulos y datos; los grises salen de aquí" value={form.text} onChange={text => setForm({ ...form, text })}/>
        <div className="presets">{boardPresets.map(([name, preset]) => <button key={name} className="btn secondary" onClick={() => setForm(preset)}><i style={{ background: preset.background }}/><i style={{ background: preset.accent }}/>{name}</button>)}</div>
      </div>
      <div className="group-foot"><button className="btn secondary" style={{ marginLeft: 0 }} disabled={busy} onClick={() => commit({ type: 'settings', section: 'board', value: null }, 'Colores originales de la pantalla restaurados.')}><RotateCcw size={14}/> Restaurar originales</button><button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy || !dirty} onClick={() => commit({ type: 'settings', section: 'board', value: form }, 'Colores de la pantalla guardados.')}>Guardar colores</button></div>
    </section>
    <section className="group">
      <div className="group-head"><div><h2>Vista previa</h2></div></div>
      <div className="pad"><div className="board-preview" style={vars}>
        <div className="board-preview-head"><span className="glyph" style={{ background: logo.logoTile, ['--logo-stroke' as string]: logo.logoStroke }}><Logo size="62%" variant="tema"/></span><b>Burriana</b><span style={{ marginLeft: 'auto', fontWeight: 600 }}>07:42</span></div>
        <div className="board-preview-panel" style={{ background: form.panel }}><small style={{ color: mix(form.text, 62, form.background) }}>Turno en marcha</small><b>07:00 — 15:00</b></div>
        <div className="board-preview-panel" style={{ background: form.accent, color: readableOn(form.accent) }}><b>Ahora: Mantenimiento y limpieza</b><small>hasta las 15:00</small></div>
        <div className="board-preview-panel" style={{ background: form.panel, boxShadow: `inset 0 0 0 1px ${mix(form.accent, 45, form.panel)}` }}><small style={{ color: form.accent }}>Siguiente trabajo</small><b>Producir cajas Biedronka 40x30x23</b><small style={{ color: mix(form.text, 62, form.background) }}>3 palets de plancha de CAR-03</small></div>
      </div></div>
    </section>
  </div>;
}
