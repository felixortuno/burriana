import { applyAction, type State } from '../warehouse.ts';

export type WarehouseSnapshot = { revision: number; state: State };
export interface WarehouseStore {
  read(): Promise<WarehouseSnapshot>;
  write(expectedRevision: number, state: State): Promise<boolean>;
}

type AccessOptions = {
  authorize?: (headers: Headers) => Promise<Response | null>;
  validateMutationOrigin?: (request: Request) => Response | null;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createWarehouseHandlers(getStore: () => WarehouseStore, access: AccessOptions = {}) {
  return {
    async GET(request: Request) {
      const denied = await access.authorize?.(request.headers);
      if (denied) return denied;
      try {
        return json(await getStore().read());
      } catch (error) {
        // Database errors can contain connection details; never log their payload.
        console.error('warehouse read failed', error instanceof Error ? error.name : 'unknown');
        return json({ error: 'No se pueden cargar los datos. Inténtalo de nuevo.' }, 503);
      }
    },
    async POST(request: Request) {
      const denied = await access.authorize?.(request.headers);
      if (denied) return denied;
      if (request.headers.get('sec-fetch-site') === 'cross-site') {
        return json({ error: 'Solicitud no permitida.' }, 403);
      }
      const originDenied = access.validateMutationOrigin?.(request);
      if (originDenied) return originDenied;

      let body: { revision: number; action: Record<string, unknown> };
      try {
        const raw = await request.text();
        if (raw.length > 12000) throw new Error('Payload too large');
        body = JSON.parse(raw);
        if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0
          || !body.action || typeof body.action !== 'object' || Array.isArray(body.action)) {
          throw new Error('Invalid request');
        }
      } catch {
        return json({ error: 'Solicitud no válida.' }, 400);
      }

      try {
        const store = getStore();
        const current = await store.read();
        if (body.revision !== current.revision) {
          return json({ error: 'Los datos han cambiado. Actualiza y vuelve a guardar.' }, 409);
        }
        let state: State;
        try {
          state = applyAction(current.state, body.action);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Revisa los datos.' }, 400);
        }
        if (!await store.write(current.revision, state)) {
          return json({ error: 'Otro cambio se ha guardado antes. Actualiza y vuelve a intentarlo.' }, 409);
        }
        return json({ state, revision: current.revision + 1 });
      } catch (error) {
        console.error('warehouse write failed', error instanceof Error ? error.name : 'unknown');
        return json({ error: 'No se ha podido guardar. Conserva los datos e inténtalo de nuevo.' }, 503);
      }
    },
  };
}
