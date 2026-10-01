'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowUpRight, ArrowRight, Check, Clock3,
  Factory, ListOrdered, LogOut, Maximize, Megaphone, Package,
  Radio, Settings2, Sparkles, Truck, Wrench, WifiOff,
} from 'lucide-react';
import Logo from '../components/logo';
import { useAppReady } from '../components/app-loader';
import { sortOperationalOrders, type ShiftSettings, type WorkOrder, type WorkOrderKind } from '@/lib/operations';
import { blocksForDay, priorityOrder, readableOn, type BoardTheme, type ShiftRule } from '@/lib/settings';
import { boardTicker } from '@/lib/board-ticker';
import ShiftTicker from './ticker';

const POLL_MS = 10_000;
const ROTATE_MS = 15_000;
const STALE_MS = 30_000;
const ZONE = 'Europe/Madrid';

type Snapshot = {
  revision: number;
  workOrders: WorkOrder[];
  shift: ShiftSettings;
  /** Older servers sent no settings; the display then keeps its defaults. */
  settings?: { priorities: WorkOrderKind[] | null; rules: ShiftRule[]; board: BoardTheme; logo?: { stroke: string; tile: string } };
  serverTime: string;
};

const kindLabels: Record<WorkOrder['kind'], string> = {
  viaje: 'Viaje · producción', pedido: 'Pedido', carga: 'Carga',
  descarga: 'Descarga', mantenimiento: 'Mantenimiento', limpieza: 'Limpieza',
};
const statusLabels: Record<WorkOrder['status'], string> = {
  pendiente: 'Pendiente', en_curso: 'En marcha', pausada: 'En pausa',
  completada: 'Terminada', cancelada: 'Cancelada',
};

function madridParts(timestamp: number) {
  const date = new Date(timestamp);
  return {
    day: new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date),
  };
}

function shortDate(day: string) {
  return day.split('-').reverse().join('/');
}

function registeredAt(value: string, today: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 'Sin fecha de registro';
  const parts = madridParts(date);
  return `${parts.day === today ? 'Hoy' : shortDate(parts.day)} · ${parts.time}`;
}

function schedule(order: WorkOrder, today: string) {
  if (!order.scheduledDate) return order.scheduledTime ? `Hora prevista ${order.scheduledTime}` : 'Sin hora prevista';
  const day = order.scheduledDate === today ? 'Hoy' : shortDate(order.scheduledDate);
  return `${day}${order.scheduledTime ? ` · ${order.scheduledTime}` : ' · hora por confirmar'}`;
}

function overdue(order: WorkOrder, today: string, time: string) {
  return order.status === 'pendiente' && !!order.scheduledDate && (
    order.scheduledDate < today || (order.scheduledDate === today && !!order.scheduledTime && order.scheduledTime < time)
  );
}

function orderIcon(kind: WorkOrder['kind']) {
  if (kind === 'viaje') return <Factory aria-hidden="true" />;
  if (kind === 'carga') return <ArrowUpRight aria-hidden="true" />;
  if (kind === 'descarga') return <ArrowDownLeft aria-hidden="true" />;
  if (kind === 'mantenimiento') return <Wrench aria-hidden="true" />;
  if (kind === 'limpieza') return <Sparkles aria-hidden="true" />;
  return <Package aria-hidden="true" />;
}

function OrderStatus({ order }: { order: WorkOrder }) {
  return <span className={`wb-order-status wb-status-${order.status}`}>
    {order.status === 'en_curso' && <span className="wb-dot" />}{statusLabels[order.status]}
  </span>;
}

function Rotation({ total, size, cycle, seconds }: { total: number; size: number; cycle: number; seconds: number }) {
  const pages = Math.ceil(total / size);
  if (pages < 2) return <span className="wb-list-count">{total} {total === 1 ? 'trabajo' : 'trabajos'}</span>;
  return <span className="wb-rotation">{cycle % pages + 1}/{pages} <span>· cambia en {seconds} s</span></span>;
}

function pageOf<T>(items: T[], size: number, cycle: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const start = (cycle % pages) * size;
  return items.slice(start, start + size);
}

function OrderRow({ order, today, time, number }: { order: WorkOrder; today: string; time: string; number?: number }) {
  return <article className={`wb-order wb-order-${order.kind}${order.priority === 'urgente' ? ' wb-order-urgent' : ''}`}>
    <div className="wb-order-mark">{number ? String(number).padStart(2, '0') : orderIcon(order.kind)}</div>
    <div className="wb-order-content">
      <div className="wb-order-top"><span className="wb-kind">{kindLabels[order.kind]}</span><OrderStatus order={order} />{order.priority === 'urgente' && <span className="wb-urgent">Urgente</span>}</div>
      <h3>{order.title}</h3>
      {order.kind === 'viaje' && order.production && <div className="wb-production-target"><Package size={15} aria-hidden="true" /><strong>{order.production.outputPallets} palets de cajas</strong><span>{order.production.outputSku}</span></div>}
      {order.kind === 'viaje' && order.production && <div className="wb-production-source">Planchas: {order.production.inputPallets} palets de <span>{order.production.inputSku}</span> en {order.production.inputLocation}</div>}
      <div className="wb-order-meta">
        {order.reference && <span className="wb-reference">{order.reference}</span>}
        {order.truck && <span><Truck size={16} aria-hidden="true" /> {order.truck}</span>}
        <span>{order.assignedTo || 'Sin asignar'}</span>
      </div>
      <div className="wb-order-times"><span className={overdue(order, today, time) ? 'wb-overdue' : ''}><Clock3 size={15} aria-hidden="true" /> Previsto: {schedule(order, today)}{overdue(order, today, time) && ' · retrasado'}</span><span>Registrado: {registeredAt(order.createdAt, today)}</span></div>
    </div>
  </article>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="wb-empty"><Check aria-hidden="true" /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

// Long instructions rotate by complete words; no part is silently truncated.
function instructionPages(instructions: string) {
  const words = instructions.trim().split(/\s+/).filter(Boolean);
  const pages: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length > 240 && current) {
      pages.push(current);
      current = word;
    } else current += `${current ? ' ' : ''}${word}`;
  }
  if (current) pages.push(current);
  return pages;
}

export default function WarehouseBoard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const [rotationStartedAt, setRotationStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exiting, setExiting] = useState(false);
  useAppReady(snapshot !== null || error !== '');

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let acceptedRevision = -1;
    let activeController: AbortController | null = null;
    let denied = false;

    async function poll() {
      if (disposed || denied || inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 9_000);
      try {
        const response = await fetch('/api/board', { cache: 'no-store', signal: controller.signal });
        if (disposed) return;
        if (response.status === 401) {
          denied = true;
          setSnapshot(null);
          setLastSuccess(null);
          window.location.replace('/login');
          return;
        }
        if (response.status === 403) {
          denied = true;
          setSnapshot(null);
          setLastSuccess(null);
          throw new Error('Esta cuenta no tiene acceso a la pantalla de trabajo.');
        }
        if (!response.ok) throw new Error('No se ha podido actualizar. Reintentando automáticamente.');
        const next = await response.json() as Snapshot;
        if (disposed) return;
        if (!Number.isSafeInteger(next.revision) || !Array.isArray(next.workOrders) || !next.shift || !Number.isFinite(Date.parse(next.serverTime))) {
          throw new Error('Respuesta incompleta del servidor. Reintentando automáticamente.');
        }
        if (next.revision < acceptedRevision) throw new Error('La última respuesta está desactualizada. Reintentando automáticamente.');
        acceptedRevision = next.revision;
        const received = Date.now();
        setSnapshot(next);
        setClockOffset(Date.parse(next.serverTime) - received);
        setLastSuccess(received);
        setRotationStartedAt(previous => previous ?? received);
        setNow(received);
        setError('');
      } catch (problem) {
        if (!disposed) setError(problem instanceof Error && problem.name !== 'AbortError' ? problem.message : 'Sin respuesta del servidor. Reintentando automáticamente.');
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        inFlight = false;
      }
    }

    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);
    return () => {
      disposed = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      activeController?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
    };
  }, []);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setNotice('');
    } catch {
      setNotice('Usa el botón de pantalla completa del navegador o la tecla F11.');
    }
  }

  async function logout() {
    setExiting(true);
    try {
      const response = await fetch('/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setSnapshot(null);
      window.location.replace('/login');
    } catch {
      setNotice('No se ha podido cerrar la sesión. Comprueba la conexión y vuelve a intentarlo.');
      setExiting(false);
    }
  }

  const currentTimestamp = now === null ? null : now + clockOffset;
  const current = currentTimestamp === null ? { day: '', time: '' } : madridParts(currentTimestamp);
  const elapsed = Math.max(0, (now ?? 0) - (rotationStartedAt ?? now ?? 0));
  const cycle = Math.floor(elapsed / ROTATE_MS);
  const seconds = Math.ceil((ROTATE_MS - elapsed % ROTATE_MS) / 1_000);
  const stale = !!error || (now !== null && lastSuccess !== null && now - lastSuccess >= STALE_MS);
  const allOrders = snapshot?.workOrders ?? [];
  const active = sortOperationalOrders(allOrders.filter(order => order.status !== 'completada' && order.status !== 'cancelada'), priorityOrder(snapshot?.settings ?? { priorities: null }));
  const running = active.filter(order => order.status === 'en_curso');
  const production = active.filter(order => order.kind === 'viaje' || order.kind === 'pedido');
  const dock = active.filter(order => order.kind === 'carga' || order.kind === 'descarga');
  const upkeep = active.filter(order => order.kind === 'mantenimiento' || order.kind === 'limpieza');
  const finishedToday = allOrders.filter(order => order.status === 'completada' && order.completedAt && madridParts(Date.parse(order.completedAt)).day === current.day).length;
  const due = active.filter(order => order.status === 'pendiente' && order.scheduledDate <= current.day);
  const upcoming = active.filter(order => order.status === 'pendiente' && order.scheduledDate > current.day);
  const focusOrders = running.length ? running : (due.length ? due : upcoming).slice(0, 1);
  const focusSlides = focusOrders.flatMap(order => {
    const pages = instructionPages(order.instructions);
    return (pages.length ? pages : ['']).map((instructions, index) => ({ order, instructions, part: index + 1, parts: Math.max(1, pages.length) }));
  });
  const focus = focusSlides.length ? focusSlides[cycle % focusSlides.length] : null;
  const shift = snapshot?.shift;
  const announcementPages = instructionPages(shift?.announcement ?? '');
  const blocks = shift && current.day ? blocksForDay(snapshot?.settings?.rules ?? [], current.day, shift) : [];
  // The stadium board: what to say now, given the shift, its blocks and the open work.
  const ticker = snapshot && shift && current.time ? boardTicker({ time: current.time, day: current.day, shift, blocks, orders: active, finishedToday, seed: Math.floor((currentTimestamp ?? 0) / 600_000) }) : null;
  const theme = snapshot?.settings?.board;
  const logo = snapshot?.settings?.logo;
  const themeStyle = theme ? Object.fromEntries([
    ['--wb-bg', theme.background], ['--wb-panel', theme.panel], ['--wb-lime', theme.accent], ['--wb-white', theme.text],
    ['--wb-on-accent', readableOn(theme.accent)], ...(logo ? [['--logo-stroke', logo.stroke], ['--logo-tile', logo.tile]] : []),
  ]) as React.CSSProperties : undefined;
  const todayLabel = currentTimestamp === null ? 'Conectando con el almacén' : new Intl.DateTimeFormat('es-ES', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(currentTimestamp));

  return <main className="wb-screen" style={themeStyle}>
    <header className="wb-header">
      <div className="wb-brand"><span className="wb-brand-icon"><Logo variant="tema" size="64%" data-logo-target="" /></span><div><strong>Burriana<span>GTR Solutions</span></strong><p>Pantalla de trabajo</p></div></div>
      <div className="wb-header-center"><span className={`wb-connection${stale ? ' wb-connection-bad' : ''}`}>{stale ? <WifiOff size={18} /> : <Radio size={18} />}{stale ? 'Datos sin actualizar' : snapshot ? 'Conectada' : 'Conectando'}</span><span>Solo información · actualiza el encargado</span></div>
      <div className="wb-clock"><time dateTime={currentTimestamp === null ? undefined : new Date(currentTimestamp).toISOString()}>{current.time || '—:—'}</time><span>{todayLabel}</span></div>
    </header>

    {stale && <div className="wb-alert" role="alert"><WifiOff aria-hidden="true" /><div><strong>{snapshot ? 'Atención: la información puede haber cambiado.' : 'No se pueden cargar los trabajos.'}</strong><span>{error || 'Han pasado más de 30 segundos sin una actualización.'} {lastSuccess !== null && `Última conexión: ${registeredAt(new Date(lastSuccess + clockOffset).toISOString(), current.day)}.`}</span></div></div>}
    {notice && <div className="wb-notice" role="status">{notice}</div>}

    {ticker && <ShiftTicker state={ticker} time={current.time} done={finishedToday} open={active.length} running={running.length} />}

    <div className={`wb-announcement${shift?.announcement ? ' wb-announcement-filled' : ''}`}><Megaphone aria-hidden="true" /><span>Aviso del encargado{announcementPages.length > 1 && ` · ${cycle % announcementPages.length + 1}/${announcementPages.length}`}</span><p>{!snapshot ? 'Esperando información del almacén.' : announcementPages[cycle % announcementPages.length] || 'Sin avisos para el turno.'}</p></div>

    {!snapshot && !error ? <section className="wb-loading" role="status"><Radio /><h1>Preparando la pantalla</h1><p>Consultando los trabajos del almacén…</p></section> : snapshot && <div className="wb-grid">
      <div className="wb-production-column">
        <section className={`wb-focus${focus?.order.priority === 'urgente' ? ' wb-focus-urgent' : ''}`} aria-label="Trabajo destacado">
          <div className="wb-focus-heading"><span className="wb-eyebrow"><span className="wb-dot" />{running.length ? 'Ahora · en marcha' : focus ? focus.order.scheduledDate > current.day ? 'Próximo programado' : 'Siguiente trabajo' : 'Turno organizado'}</span>{focusSlides.length > 1 && <span className="wb-focus-pagination">Vista {cycle % focusSlides.length + 1}/{focusSlides.length} · {seconds} s</span>}</div>
          {focus ? <>
            <div className="wb-focus-type">{orderIcon(focus.order.kind)}{kindLabels[focus.order.kind]}{focus.order.priority === 'urgente' && <span className="wb-urgent">Prioridad del encargado</span>}<OrderStatus order={focus.order} /></div>
            <h1>{focus.order.title}</h1>
            {focus.order.kind === 'viaje' && focus.order.production && <div className="wb-focus-production"><div><Package aria-hidden="true" /><strong>{focus.order.production.outputPallets} palets de cajas</strong><span>{focus.order.production.outputSku}</span></div><p>{focus.order.production.inputPallets} palets de planchas · {focus.order.production.inputSku} · {focus.order.production.inputLocation} <ArrowRight size={15} aria-hidden="true" /> {focus.order.production.outputLocation}</p></div>}
            <div className="wb-focus-details"><span>{focus.order.assignedTo || 'Responsable pendiente de asignar'}</span>{focus.order.reference && <b>{focus.order.reference}</b>}{focus.order.truck && <span><Truck size={21} /> {focus.order.truck}</span>}</div>
            {focus.instructions && <div className="wb-focus-instructions"><p>{focus.instructions}</p>{focus.parts > 1 && <span>Instrucciones {focus.part}/{focus.parts} · lectura completa en rotación</span>}</div>}
            <div className="wb-focus-bottom"><span><Clock3 size={17} /> Previsto: {schedule(focus.order, current.day)}</span>{overdue(focus.order, current.day, current.time) && <b className="wb-overdue">Pendiente desde la hora prevista</b>}<span>Registrado: {registeredAt(focus.order.createdAt, current.day)}</span></div>
          </> : <><h1>{active.length ? 'Trabajos en pausa.' : 'No hay trabajos abiertos.'}</h1><p className="wb-focus-empty">{active.length ? 'Espera las indicaciones del encargado para continuar.' : 'Los trabajos que registre el encargado aparecerán aquí automáticamente.'}</p></>}
        </section>

        <section className="wb-panel wb-production">
          <div className="wb-panel-heading"><div><ListOrdered aria-hidden="true" /><h2>Producción y pedidos</h2><span className="wb-total">{production.length}</span></div><Rotation total={production.length} size={2} cycle={cycle} seconds={seconds} /></div>
          <p className="wb-panel-explainer">Viajes: planchas → cajas para reponer stock. Las urgencias las fija el encargado.</p>
          {production.length ? <div className="wb-orders">{pageOf(production, 2, cycle).map((order, index) => <OrderRow key={order.id} order={order} today={current.day} time={current.time} number={(cycle % Math.ceil(production.length / 2)) * 2 + index + 1} />)}</div> : <EmptyState title="Sin producción ni pedidos pendientes" detail="La siguiente orden aparecerá aquí." />}
        </section>
      </div>

      <div className="wb-secondary-column">
        <section className="wb-panel wb-dock">
          <div className="wb-panel-heading"><div><Truck aria-hidden="true" /><h2>Muelle</h2><span className="wb-total">{dock.length}</span></div><Rotation total={dock.length} size={1} cycle={cycle} seconds={seconds} /></div>
          <p className="wb-panel-explainer">Camiones · cargas y descargas</p>
          {dock.length ? <div className="wb-orders">{pageOf(dock, 1, cycle).map(order => <OrderRow key={order.id} order={order} today={current.day} time={current.time} />)}</div> : <EmptyState title="Muelle sin trabajos pendientes" detail="No hay cargas ni descargas registradas." />}
        </section>
        <section className="wb-panel wb-upkeep">
          <div className="wb-panel-heading"><div><Wrench aria-hidden="true" /><h2>Puesta a punto</h2><span className="wb-total">{upkeep.length}</span></div><Rotation total={upkeep.length} size={1} cycle={cycle} seconds={seconds} /></div>
          <p className="wb-panel-explainer">Mantenimiento y limpieza · franjas previstas</p>
          {upkeep.length ? <div className="wb-orders">{pageOf(upkeep, 1, cycle).map(order => <OrderRow key={order.id} order={order} today={current.day} time={current.time} />)}</div> : <EmptyState title="Sin tareas programadas" detail="El encargado puede fijar el próximo mantenimiento o limpieza." />}
        </section>
        <div className="wb-next-note"><ArrowRight aria-hidden="true" /><p>Al terminar, avisa al encargado para que cierre el trabajo y dé paso al siguiente.</p></div>
      </div>
    </div>}

    <footer className="wb-footer"><div><span className={`wb-dot${stale ? ' wb-dot-warning' : ''}`} /><span>{lastSuccess === null ? 'Esperando primera actualización' : `Última actualización ${registeredAt(new Date(lastSuccess + clockOffset).toISOString(), current.day)}`}</span><span className="wb-footer-interval">Actualización cada 10 s · Listas cada 15 s · Hora de Madrid</span></div><div className="wb-controls"><Link href="/ajustes"><Settings2 size={16}/> Ajustes</Link><button onClick={fullscreen} aria-label="Activar o salir de pantalla completa"><Maximize size={16} /> Pantalla completa</button><button onClick={logout} disabled={exiting}><LogOut size={16} /> {exiting ? 'Saliendo…' : 'Salir'}</button></div></footer>
  </main>;
}
