/**
 * Administrator settings stored with the warehouse: work priorities, fixed time
 * blocks of the shift (normas), and the colours of the app and of the display.
 */
import { brand } from './brand.ts';

const KINDS = ['viaje', 'pedido', 'carga', 'descarga', 'mantenimiento', 'limpieza'] as const;
type Kind = typeof KINDS[number];

export type RuleKind = 'mantenimiento' | 'limpieza' | 'otro';
export type RuleTiming = { mode: 'final'; hours: number } | { mode: 'horario'; start: string; end: string };
/** A block of the shift that repeats: «cada 2 viernes, las 2 últimas horas». */
export type ShiftRule = {
  id: string;
  title: string;
  kind: RuleKind;
  /** ISO weekday: 1 Monday … 7 Sunday. */
  weekday: number;
  everyWeeks: number;
  /** First day it applies; later occurrences count whole weeks from here. */
  startDate: string;
  timing: RuleTiming;
  notes: string;
  active: boolean;
};
export type Appearance = { accent: string; selection: string; logoStroke: string; logoTile: string };
export type BoardTheme = { background: string; panel: string; accent: string; text: string };
export type Settings = {
  /** Order in which work kinds are done; null keeps the original rule (viajes first, the rest by date). */
  priorities: Kind[] | null;
  rules: ShiftRule[];
  appearance: Appearance;
  board: BoardTheme;
};

export const defaultAppearance = (): Appearance => ({ accent: '#0071E3', selection: '#1D1D1F', logoStroke: brand.lima, logoTile: brand.negro });
export const defaultBoard = (): BoardTheme => ({ background: '#000000', panel: '#1C1C1E', accent: '#30D158', text: '#F5F5F7' });
export const defaultPriorities = (): Kind[] => [...KINDS];
export function defaultSettings(): Settings {
  return { priorities: null, rules: [], appearance: defaultAppearance(), board: defaultBoard() };
}

export const weekdayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const fail = (message: string): never => { throw new Error(message); };
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const hex = (value: unknown, label: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fail(`El color «${label}» debe tener el formato #RRGGBB.`);
const text = (value: unknown, label: string, required = true, max = 120) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Revisa el campo «${label}».`);
  return (value as string).trim();
};

/** ISO weekday (1 Monday … 7 Sunday) of a calendar day. */
export function weekdayOf(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
}
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
const fromDayNumber = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

function parsePriorities(value: unknown): Kind[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== KINDS.length || new Set(value).size !== KINDS.length || !value.every(kind => KINDS.includes(kind))) {
    fail('La prioridad debe incluir cada tipo de trabajo una sola vez.');
  }
  return (value as Kind[]).slice();
}

export function parseRule(value: unknown, id?: string): ShiftRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Norma no válida.');
  const rule = value as Record<string, unknown>;
  const weekday = rule.weekday;
  if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) fail('Elige el día de la semana de la norma.');
  const everyWeeks = rule.everyWeeks;
  if (typeof everyWeeks !== 'number' || !Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > 8) fail('La norma se repite cada 1 a 8 semanas.');
  if (!isDay(rule.startDate)) fail('Indica desde qué día se aplica la norma.');
  if (weekdayOf(rule.startDate as string) !== weekday) fail(`El primer día de la norma tiene que ser ${weekdayNames[(weekday as number) - 1]}.`);
  const timing = rule.timing as Record<string, unknown> | undefined;
  let parsedTiming: RuleTiming;
  if (timing?.mode === 'final') {
    const hours = timing.hours;
    if (typeof hours !== 'number' || !Number.isInteger(hours * 4) || hours <= 0 || hours > 12) fail('Indica cuántas horas del final del turno (de 0,25 a 12).');
    parsedTiming = { mode: 'final', hours: hours as number };
  } else if (timing?.mode === 'horario') {
    if (!isTime(timing.start) || !isTime(timing.end) || (timing.start as string) >= (timing.end as string)) fail('Indica un horario válido: la hora de inicio antes que la de fin.');
    parsedTiming = { mode: 'horario', start: timing.start as string, end: timing.end as string };
  } else {
    parsedTiming = fail('Elige cuándo se aplica la norma dentro del turno.');
  }
  const kind = rule.kind;
  if (kind !== 'mantenimiento' && kind !== 'limpieza' && kind !== 'otro') fail('Tipo de norma no válido.');
  if (typeof rule.active !== 'boolean') fail('Indica si la norma está activa.');
  return {
    id: id ?? text(rule.id, 'Identificador'),
    title: text(rule.title, 'Nombre de la norma'),
    kind: kind as RuleKind,
    weekday: weekday as number,
    everyWeeks: everyWeeks as number,
    startDate: rule.startDate as string,
    timing: parsedTiming,
    notes: text(rule.notes ?? '', 'Indicaciones', false, 500),
    active: rule.active as boolean,
  };
}

function parseAppearance(value: unknown): Appearance {
  const source = (value ?? {}) as Record<string, unknown>;
  return { accent: hex(source.accent, 'Acento'), selection: hex(source.selection, 'Selección'), logoStroke: hex(source.logoStroke, 'Logo'), logoTile: hex(source.logoTile, 'Fondo del logo') };
}
function parseBoard(value: unknown): BoardTheme {
  const source = (value ?? {}) as Record<string, unknown>;
  return { background: hex(source.background, 'Fondo'), panel: hex(source.panel, 'Paneles'), accent: hex(source.accent, 'Acento'), text: hex(source.text, 'Texto') };
}

/** Fills what older data lacks; anything present must already be valid. */
export function normalizeSettings(value: unknown): Settings {
  if (value === undefined) return defaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Los ajustes guardados no son válidos.');
  const source = value as Record<string, unknown>;
  const rules = source.rules ?? [];
  if (!Array.isArray(rules)) fail('Las normas guardadas no son válidas.');
  return {
    priorities: source.priorities === undefined ? null : parsePriorities(source.priorities),
    rules: (rules as unknown[]).map(rule => parseRule(rule)),
    appearance: source.appearance === undefined ? defaultAppearance() : parseAppearance(source.appearance),
    board: source.board === undefined ? defaultBoard() : parseBoard(source.board),
  };
}

/** One section at a time, so two administrators editing different things never collide. */
export function applySettings(current: Settings, action: Record<string, unknown>, newId: () => string): Settings {
  const next = structuredClone(current);
  switch (action.section) {
    case 'priorities': next.priorities = parsePriorities(action.value); break;
    case 'appearance': next.appearance = action.value === null ? defaultAppearance() : parseAppearance(action.value); break;
    case 'board': next.board = action.value === null ? defaultBoard() : parseBoard(action.value); break;
    case 'rule': {
      const value = action.value as Record<string, unknown> | undefined;
      const existing = typeof value?.id === 'string' ? next.rules.findIndex(rule => rule.id === value.id) : -1;
      if (typeof value?.id === 'string' && existing < 0) fail('Norma no encontrada.');
      const rule = parseRule(value, existing >= 0 ? next.rules[existing].id : newId());
      if (existing >= 0) next.rules[existing] = rule; else next.rules.push(rule);
      if (next.rules.length > 30) fail('Como máximo 30 normas.');
      break;
    }
    case 'deleteRule': {
      const index = next.rules.findIndex(rule => rule.id === action.id);
      if (index < 0) fail('Norma no encontrada.');
      next.rules.splice(index, 1);
      break;
    }
    default: fail('Ajuste no válido.');
  }
  return next;
}

export function ruleOccursOn(rule: ShiftRule, day: string) {
  if (!rule.active || day < rule.startDate || weekdayOf(day) !== rule.weekday) return false;
  return ((dayNumber(day) - dayNumber(rule.startDate)) / 7) % rule.everyWeeks === 0;
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** Start and end of the block on a given shift; «las 2 últimas horas» ends with the shift. */
export function ruleWindow(rule: ShiftRule, shift: { startTime: string; endTime: string }) {
  if (rule.timing.mode === 'horario') return { start: rule.timing.start, end: rule.timing.end };
  const end = minutes(shift.endTime);
  return { start: clock(Math.max(minutes(shift.startTime), Math.round(end - rule.timing.hours * 60))), end: shift.endTime };
}

export function nextOccurrences(rule: ShiftRule, fromDay: string, count = 3): string[] {
  if (!rule.active) return [];
  const start = Math.max(dayNumber(fromDay), dayNumber(rule.startDate));
  const offset = (start - dayNumber(rule.startDate)) % (7 * rule.everyWeeks);
  let day = offset === 0 ? start : start + 7 * rule.everyWeeks - offset;
  const result: string[] = [];
  while (result.length < count) { result.push(fromDayNumber(day)); day += 7 * rule.everyWeeks; }
  return result;
}

/** Blocks that apply on a day, in time order, with their window for that shift. */
export function blocksForDay(rules: ShiftRule[], day: string, shift: { startTime: string; endTime: string }) {
  return rules.filter(rule => ruleOccursOn(rule, day)).map(rule => ({ rule, ...ruleWindow(rule, shift) })).sort((a, b) => a.start.localeCompare(b.start));
}

export function describeRule(rule: ShiftRule) {
  const day = weekdayNames[rule.weekday - 1];
  const every = rule.everyWeeks === 1 ? `Cada ${day}` : `Cada ${rule.everyWeeks} ${day === 'sábado' || day === 'domingo' ? `${day}s` : day}`;
  const when = rule.timing.mode === 'final' ? `las ${String(rule.timing.hours).replace('.', ',')} últimas ${rule.timing.hours === 1 ? 'hora' : 'horas'} del turno` : `de ${rule.timing.start} a ${rule.timing.end}`;
  return `${every}, ${when}`;
}

/** Order used by every list and by the display: a configured order, or the original rule. */
export function priorityOrder(settings: Pick<Settings, 'priorities'>): Kind[] | 'viajes_primero' {
  return settings.priorities ?? 'viajes_primero';
}

/** Black or white, whichever reads better on a colour (WCAG relative luminance). */
export function readableOn(color: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#1C1C1A' : '#FFFFFF';
}
