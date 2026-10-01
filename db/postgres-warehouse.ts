import { initialState, normalizeState, type State } from '../lib/warehouse.ts';
import type { WarehouseStore } from '../lib/server/warehouse-api.ts';

export const WAREHOUSE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS public.warehouse (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL CHECK (revision >= 0),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
)`;

// The app connects as the table owner through Postgres, never through the Data
// API. Keep API roles out even if the project grants them access by default.
// Do not FORCE RLS: the owner must still read and write the office inventory.
export const WAREHOUSE_RLS_SQL = 'ALTER TABLE public.warehouse ENABLE ROW LEVEL SECURITY';
export const WAREHOUSE_REVOKE_SQL = 'REVOKE ALL PRIVILEGES ON TABLE public.warehouse FROM anon, authenticated, PUBLIC';

// Serialize first-time initialization across concurrent serverless instances.
export const WAREHOUSE_INIT_LOCK_SQL = 'SELECT pg_advisory_xact_lock(75017329)';

export interface PostgresExecutor {
  initialize(): Promise<void>;
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export function createPostgresWarehouseStore(client: PostgresExecutor): WarehouseStore {
  let ready: Promise<void> | undefined;
  function initialize() {
    ready ??= client.initialize().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }

  return {
    async read() {
      await initialize();
      const [row] = await client.query('SELECT revision, data FROM public.warehouse WHERE id = 1', []);
      if (!row) return { revision: 0, state: initialState() };
      return { revision: Number(row.revision), state: normalizeState(row.data as State) };
    },
    async write(expectedRevision, state) {
      await initialize();
      const rows = await client.query(
        `INSERT INTO public.warehouse (id, revision, data) VALUES (1, $1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, data = EXCLUDED.data
         WHERE warehouse.revision = $3 RETURNING revision`,
        [expectedRevision + 1, JSON.stringify(state), expectedRevision],
      );
      return rows.length === 1;
    },
  };
}
