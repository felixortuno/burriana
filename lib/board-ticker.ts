import type { ShiftSettings, WorkOrder } from './operations.ts';

/**
 * What the stadium-style board on the warehouse display says at each moment of
 * the shift. Messages come in priority order; the board scrolls through them.
 */
export type TickerTone = 'descanso' | 'aviso' | 'norma' | 'urgente' | 'camion' | 'cierre' | 'animo' | 'info' | 'fuera';
export type TickerMessage = { tone: TickerTone; text: string };
export type TimelineSegment = { kind: 'almuerzo' | 'norma'; label: string; start: string; end: string; from: number; to: number };
export type TickerState = {
  messages: TickerMessage[];
  timeline: { start: string; end: string; progress: number; segments: TimelineSegment[] } | null;
};
type Block = { rule: { title: string; notes: string }; start: string; end: string };
type Input = {
  time: string;
  day: string;
  shift: ShiftSettings;
  blocks: Block[];
  /** Open orders, already sorted by priority. */
  orders: WorkOrder[];
  finishedToday: number;
  /** Changes every few minutes so the encouragement does not repeat all day. */
  seed: number;
};

export const NOTICE = { almuerzo: 15, norma: 30, cierre: 30, camion: 20, inicio: 30 };

/** Said when the day is heavy: many open jobs, or several with little shift left. */
export const encouragement = [
  '¡Vamos, equipo! Quedan {n} trabajos y los vamos a sacar',
  'Esto se gana jugada a jugada: un palet bien hecho y a por el siguiente',
  'Hoy aprieta, pero este equipo puede con todo',
  'Con orden y sin prisas: {n} trabajos por delante, uno detrás de otro',
  'Cada viaje cuenta. ¡A por ello!',
];

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function duration(total: number) {
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function boardTicker({ time, day, shift, blocks, orders, finishedToday, seed }: Input): TickerState {
  const now = minutes(time), start = minutes(shift.startTime), end = minutes(shift.endTime);
  const lunch = shift.lunchStart && shift.lunchEnd ? { start: minutes(shift.lunchStart), end: minutes(shift.lunchEnd) } : null;
  const span = Math.max(1, end - start);
  const at = (value: number) => Math.min(1, Math.max(0, (value - start) / span));
  const segments: TimelineSegment[] = [
    ...(lunch ? [{ kind: 'almuerzo' as const, label: 'Almuerzo', start: shift.lunchStart, end: shift.lunchEnd, from: at(lunch.start), to: at(lunch.end) }] : []),
    ...blocks.map(block => ({ kind: 'norma' as const, label: block.rule.title, start: block.start, end: block.end, from: at(minutes(block.start)), to: at(minutes(block.end)) })),
  ];
  const timeline = { start: shift.startTime, end: shift.endTime, progress: at(now), segments };
  const pending = orders.filter(order => order.scheduledDate <= day && order.status !== 'pausada');
  const messages: TickerMessage[] = [];

  if (now < start) return { timeline, messages: [{ tone: 'fuera', text: `Buenos días. El turno empieza a las ${shift.startTime}` }] };
  if (now >= end) {
    return { timeline, messages: [{ tone: 'fuera', text: `Turno terminado. ¡Gracias por el trabajo de hoy, equipo!${finishedToday ? ` ${plural(finishedToday, 'trabajo terminado', 'trabajos terminados')}` : ''}` }] };
  }

  // The break first: announced like a stadium board as it approaches.
  if (lunch && now >= lunch.start && now < lunch.end) {
    messages.push({ tone: 'descanso', text: `¡Buen provecho! Volvemos a las ${shift.lunchEnd} · quedan ${duration(lunch.end - now)}` });
  } else if (lunch && lunch.start > now && lunch.start - now <= NOTICE.almuerzo) {
    const left = lunch.start - now;
    messages.push({ tone: 'aviso', text: left <= 5 ? `Descanso en ${duration(left)} · id dejando el puesto recogido` : `Descanso en ${duration(left)} · de ${shift.lunchStart} a ${shift.lunchEnd}` });
  }
  for (const block of blocks) {
    const from = minutes(block.start), to = minutes(block.end);
    if (now >= from && now < to) messages.push({ tone: 'norma', text: `Ahora: ${block.rule.title}, hasta las ${block.end}${block.rule.notes ? ` · ${block.rule.notes}` : ''}` });
    else if (from > now && from - now <= NOTICE.norma) messages.push({ tone: 'aviso', text: `En ${duration(from - now)}: ${block.rule.title} (${block.start}–${block.end})` });
  }
  for (const order of orders.filter(item => item.priority === 'urgente').slice(0, 2)) messages.push({ tone: 'urgente', text: `Urgente: ${order.title}` });
  for (const order of orders) {
    if ((order.kind !== 'carga' && order.kind !== 'descarga') || order.scheduledDate !== day || !order.scheduledTime || order.status === 'en_curso') continue;
    const left = minutes(order.scheduledTime) - now;
    if (left >= 0 && left <= NOTICE.camion) messages.push({ tone: 'camion', text: `Camión en ${duration(left)} · ${order.kind === 'carga' ? 'carga' : 'descarga'}${order.truck ? ` ${order.truck}` : `: ${order.title}`}` });
  }
  if (end - now <= NOTICE.cierre) messages.push({ tone: 'cierre', text: `Quedan ${duration(end - now)} de turno · cierre a las ${shift.endTime} · dejad el puesto listo para mañana` });

  // Encouragement when the day is heavy; a pat on the back when it goes well.
  const lunchLeft = lunch && lunch.end > now ? lunch.end - Math.max(now, lunch.start) : 0;
  const workLeft = end - now - lunchLeft;
  if (pending.length >= 5 || (pending.length >= 3 && workLeft < 120)) {
    const pick = (offset: number) => encouragement[(seed + offset) % encouragement.length].replace('{n}', String(pending.length));
    messages.push({ tone: 'animo', text: pick(0) }, { tone: 'animo', text: pick(1) });
  } else if (finishedToday > 0) {
    messages.push({ tone: 'animo', text: `¡Buen ritmo! ${plural(finishedToday, 'trabajo terminado', 'trabajos terminados')} hoy` });
  }

  if (now - start < NOTICE.inicio) messages.push({ tone: 'info', text: `¡Buenos días, equipo! Hoy hay ${plural(pending.length, 'trabajo previsto', 'trabajos previstos')}` });
  const next = lunch && lunch.start > now ? ` · almuerzo a las ${shift.lunchStart}` : '';
  messages.push({ tone: 'info', text: `Turno de ${shift.startTime} a ${shift.endTime} · quedan ${duration(end - now)}${next}` });
  return { timeline, messages };
}
