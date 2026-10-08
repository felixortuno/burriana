import { normalizeSettings, type Settings } from './settings.ts';

/** Operational work is separate from inventory: scheduling never changes stock. */
export const workOrderKinds = ['viaje', 'pedido', 'carga', 'descarga', 'mantenimiento', 'limpieza'] as const;
export const workOrderStatuses = ['pendiente', 'en_curso', 'pausada', 'completada', 'cancelada'] as const;
export const workOrderPriorities = ['normal', 'urgente'] as const;
export type WorkOrderKind = typeof workOrderKinds[number];
export type WorkOrderStatus = typeof workOrderStatuses[number];
export type WorkOrderPriority = typeof workOrderPriorities[number];
export type OperationActor = { id: string; name: string };
export type ProductionSpecification = {
  inputSku: string;
  inputLocation: string;
  inputPallets: number;
  outputSku: string;
  outputLocation: string;
  outputPallets: number;
};
export type WorkOrderEvent = {
  id: string;
  kind: 'created' | 'updated' | 'status';
  date: string;
  actorId: string;
  actorName: string;
  status: WorkOrderStatus;
};
export type WorkOrder = {
  id: string;
  kind: WorkOrderKind;
  title: string;
  reference: string;
  truck: string;
  assignedTo: string;
  instructions: string;
  boxSku?: string;
  boxQuantity?: number;
  scheduledDate: string;
  scheduledTime: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  repeatEveryDays: number;
  previousOrderId: string | null;
  nextOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  completedAt: string | null;
  production?: ProductionSpecification;
  events: WorkOrderEvent[];
};
export type ShiftSettings = {
  startTime: string;
  endTime: string;
  lunchStart: string;
  lunchEnd: string;
  announcement: string;
};
export type OperationalState = { workOrders: WorkOrder[]; shift: ShiftSettings; settings: Settings };
export type OperationalSortMode = 'viajes_primero' | 'fecha_programada';

export function defaultShiftSettings(): ShiftSettings {
  return { startTime: '07:00', endTime: '15:00', lunchStart: '', lunchEnd: '', announcement: '' };
}

/** Only fills fields absent from older backups; it never seeds invented work. */
export function normalizeOperationalState(state: {
  workOrders?: WorkOrder[];
  shift?: Partial<ShiftSettings>;
  settings?: unknown;
}): OperationalState {
  if (state.workOrders !== undefined && !Array.isArray(state.workOrders)) {
    throw new Error('El registro de trabajo guardado no es válido.');
  }
  if (state.shift !== undefined && (!state.shift || typeof state.shift !== 'object' || Array.isArray(state.shift))) {
    throw new Error('La configuración de turno guardada no es válida.');
  }
  return {
    workOrders: state.workOrders ?? [],
    shift: { ...defaultShiftSettings(), ...state.shift },
    settings: normalizeSettings(state.settings),
  };
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function text(value: unknown, label: string, required = true, max = 180): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`Revisa el campo «${label}».`);
  }
  return value.trim();
}

function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`Revisa el campo «${label}».`);
  }
  return value as T;
}

export function resolveOperationActor(actor?: OperationActor): OperationActor {
  // Explicit attribution for legacy callers, never a name supplied in action.
  if (!actor) return { id: 'legacy-office', name: 'Cuenta de oficina heredada' };
  return { id: text(actor.id, 'Identidad'), name: text(actor.name, 'Nombre de usuario') };
}

export function parseProduction(value: unknown): ProductionSpecification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Indica las planchas consumidas y las cajas producidas antes de completar el viaje.');
  }
  const source = value as Record<string, unknown>;
  const pallets = (value: unknown, label: string) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000) {
      throw new Error(`«${label}» debe ser un número entero entre 1 y 1.000.000 palets.`);
    }
    return value;
  };
  const production = {
    inputSku: text(source.inputSku, 'Referencia de planchas').toUpperCase(),
    inputLocation: text(source.inputLocation, 'Ubicación de planchas').toUpperCase(),
    inputPallets: pallets(source.inputPallets, 'Palets de planchas'),
    outputSku: text(source.outputSku, 'Referencia de cajas').toUpperCase(),
    outputLocation: text(source.outputLocation, 'Ubicación de cajas').toUpperCase(),
    outputPallets: pallets(source.outputPallets, 'Palets de cajas'),
  };
  if (production.inputSku === production.outputSku) {
    throw new Error('Las referencias de planchas y cajas deben ser distintas.');
  }
  if (production.inputLocation === production.outputLocation) {
    throw new Error('Las ubicaciones de planchas y cajas deben ser distintas.');
  }
  return production;
}

function event(kind: WorkOrderEvent['kind'], actor: OperationActor, now: string, status: WorkOrderStatus): WorkOrderEvent {
  return { id: crypto.randomUUID(), kind, date: now, actorId: actor.id, actorName: actor.name, status };
}

export function isOpenWorkOrder(order: Pick<WorkOrder, 'status'>): boolean {
  return order.status !== 'completada' && order.status !== 'cancelada';
}

/**
 * Sorts a copy, with explicit urgency overriding the normal priority. The priority
 * is either a mode or the administrator's order of work kinds.
 */
export function sortOperationalOrders(orders: readonly WorkOrder[], mode: OperationalSortMode | readonly WorkOrderKind[] = 'viajes_primero'): WorkOrder[] {
  const rank = (order: WorkOrder) => [
    isOpenWorkOrder(order) ? 0 : 1,
    order.status === 'en_curso' ? 0 : 1,
    order.priority === 'urgente' ? 0 : 1,
    Array.isArray(mode) ? mode.indexOf(order.kind) : mode === 'viajes_primero' && order.kind === 'viaje' ? 0 : 1,
  ];
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...orders].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return compareText(a.scheduledDate, b.scheduledDate)
      || compareText(a.scheduledTime || '23:59', b.scheduledTime || '23:59')
      || compareText(a.createdAt, b.createdAt)
      || compareText(a.id, b.id);
  });
}

function nextDateFromCompletion(now: Date, days: number): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const next = date.toISOString().slice(0, 10);
  if (!isValidCalendarDate(next)) throw new Error('La siguiente fecha queda fuera del calendario admitido.');
  return next;
}

function validateShift(action: Record<string, unknown>): ShiftSettings {
  const startTime = text(action.startTime, 'Inicio de turno');
  const endTime = text(action.endTime, 'Fin de turno');
  const lunchStart = text(action.lunchStart ?? '', 'Inicio de almuerzo', false);
  const lunchEnd = text(action.lunchEnd ?? '', 'Fin de almuerzo', false);
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    throw new Error('Indica un turno válido: el inicio debe ser anterior al final del mismo día.');
  }
  if (Boolean(lunchStart) !== Boolean(lunchEnd)) {
    throw new Error('Indica el inicio y el final del almuerzo, o deja ambos vacíos.');
  }
  if (lunchStart && (!isValidTime(lunchStart) || !isValidTime(lunchEnd)
    || lunchStart >= lunchEnd || lunchStart < startTime || lunchEnd > endTime)) {
    throw new Error('El almuerzo debe estar dentro del turno y terminar después de empezar.');
  }
  return { startTime, endTime, lunchStart, lunchEnd, announcement: text(action.announcement ?? '', 'Aviso del turno', false, 1000) };
}

/** Mutates only the already-cloned operational state owned by applyAction. */
export function applyOperationalAction(
  state: OperationalState,
  action: Record<string, unknown>,
  now = new Date(),
  suppliedActor?: OperationActor,
): void {
  const actor = resolveOperationActor(suppliedActor);
  const timestamp = now.toISOString();
  if (action.type === 'shift') {
    state.shift = validateShift(action);
    return;
  }
  if (action.type === 'workOrder') {
    const hasId = action.id !== undefined;
    const orderId = hasId ? text(action.id, 'Identificador del trabajo') : undefined;
    const existing = orderId ? state.workOrders.find(order => order.id === orderId) : undefined;
    if (hasId && !existing) throw new Error('Trabajo no encontrado.');
    if (existing && !isOpenWorkOrder(existing)) throw new Error('Un trabajo cerrado no se puede editar. Crea uno nuevo.');
    const kind = choice(action.kind, workOrderKinds, 'Tipo de trabajo');
    const scheduledDate = text(action.scheduledDate, 'Fecha programada');
    const scheduledTime = text(action.scheduledTime ?? '', 'Hora programada', false);
    if (!isValidCalendarDate(scheduledDate)) throw new Error('Fecha programada no válida.');
    if (scheduledTime && !isValidTime(scheduledTime)) throw new Error('Hora programada no válida. Usa HH:mm.');
    const repeatEveryDays = action.repeatEveryDays ?? 0;
    if (typeof repeatEveryDays !== 'number' || !Number.isInteger(repeatEveryDays) || repeatEveryDays < 0 || repeatEveryDays > 365) {
      throw new Error('La repetición debe ser un número entero entre 0 y 365 días.');
    }
    if (repeatEveryDays > 0 && kind !== 'mantenimiento' && kind !== 'limpieza') {
      throw new Error('Solo mantenimiento y limpieza pueden repetirse automáticamente.');
    }
    const production = action.production === undefined ? existing?.production
      : action.production === null ? undefined : parseProduction(action.production);
    if (production && kind !== 'viaje') {
      throw new Error('Solo un viaje de producción puede consumir planchas y producir cajas.');
    }
    const boxSku = action.boxSku === undefined ? existing?.boxSku : text(action.boxSku ?? '', 'Referencia de caja', false);
    const boxQuantity = action.boxQuantity === undefined ? existing?.boxQuantity : Number(action.boxQuantity);
    if (kind === 'pedido') {
      if (!boxSku) throw new Error('Indica la referencia de caja del pedido.');
      if (!Number.isSafeInteger(boxQuantity) || boxQuantity < 1 || boxQuantity > 1000000) {
        throw new Error('La cantidad de cajas debe ser un entero entre 1 y 1.000.000.');
      }
    }
    const fields = {
      kind,
      title: text(action.title, 'Trabajo'),
      reference: text(action.reference ?? '', 'Referencia', false),
      truck: text(action.truck ?? '', 'Camión', false),
      assignedTo: text(action.assignedTo ?? '', 'Asignación', false),
      instructions: text(action.instructions ?? '', 'Instrucciones', false, 1500),
      ...(kind === 'pedido' ? { boxSku, boxQuantity } : {}),
      scheduledDate,
      scheduledTime,
      priority: choice(action.priority ?? 'normal', workOrderPriorities, 'Prioridad'),
      repeatEveryDays,
      updatedAt: timestamp,
      updatedBy: actor.id,
    };
    if (existing) {
      Object.assign(existing, fields);
      if (production) existing.production = production;
      else delete existing.production;
      existing.events.push(event('updated', actor, timestamp, existing.status));
    } else {
      state.workOrders.push({
        ...fields,
        id: crypto.randomUUID(), status: 'pendiente', createdAt: timestamp, createdBy: actor.id,
        completedAt: null, previousOrderId: null, nextOrderId: null,
        ...(production ? { production } : {}),
        events: [event('created', actor, timestamp, 'pendiente')],
      });
    }
    return;
  }
  if (action.type === 'workOrderStatus') {
    const orderId = text(action.id, 'Identificador del trabajo');
    const order = state.workOrders.find(item => item.id === orderId);
    if (!order) throw new Error('Trabajo no encontrado.');
    const status = choice(action.status, workOrderStatuses, 'Estado');
    if (order.status === status) return;
    if (!isOpenWorkOrder(order)) throw new Error('Un trabajo cerrado no se puede reabrir. Crea uno nuevo.');
    const production = order.kind === 'viaje' && status === 'completada'
      ? parseProduction(action.production ?? order.production) : undefined;
    // Derive the next instance before mutating, so validation cannot leave half a completion.
    const recurring = status === 'completada' && order.repeatEveryDays > 0;
    const nextDate = recurring ? nextDateFromCompletion(now, order.repeatEveryDays) : null;
    order.status = status;
    order.updatedAt = timestamp;
    order.updatedBy = actor.id;
    order.completedAt = status === 'completada' ? timestamp : null;
    if (production) order.production = production;
    order.events.push(event('status', actor, timestamp, status));
    if (nextDate && !order.nextOrderId) {
      // Both instances are saved in the same warehouse revision; retrying completion is a no-op.
      const existingNext = state.workOrders.find(item => item.previousOrderId === order.id);
      if (existingNext) {
        order.nextOrderId = existingNext.id;
      } else {
        const nextId = crypto.randomUUID();
        order.nextOrderId = nextId;
        state.workOrders.push({
          ...order,
          id: nextId, status: 'pendiente', scheduledDate: nextDate, completedAt: null,
          previousOrderId: order.id, nextOrderId: null,
          createdAt: timestamp, updatedAt: timestamp, createdBy: actor.id, updatedBy: actor.id,
          events: [event('created', actor, timestamp, 'pendiente')],
        });
      }
    }
    return;
  }
  throw new Error('Operación de trabajo no válida.');
}
