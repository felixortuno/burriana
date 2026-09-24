import postgres from 'postgres';
import {
  createPostgresWarehouseStore,
  WAREHOUSE_INIT_LOCK_SQL,
  WAREHOUSE_SCHEMA_SQL,
} from './postgres-warehouse.ts';
import type { WarehouseStore } from '../lib/server/warehouse-api.ts';

const TEXT_OID = 25;

let store: WarehouseStore | undefined;

export function getPostgresWarehouseStore(): WarehouseStore {
  if (store) return store;
  // The Supabase integration publishes POSTGRES_URL; DATABASE_URL stays supported
  // so an existing deployment keeps working while the variable is renamed.
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for the Supabase database');

  const sql = postgres(connectionString, {
    // Supabase's pooler runs in transaction mode, which cannot reuse prepared
    // statements, and each serverless instance only ever serves one request.
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    connection: { statement_timeout: 15000 },
    // Every cold start re-runs CREATE TABLE IF NOT EXISTS, whose "already exists"
    // notice is expected and would otherwise be logged on each instance.
    onnotice: () => {},
  });

  store = createPostgresWarehouseStore({
    async initialize() {
      // The advisory lock is transaction scoped, so it must share the transaction
      // that creates the table.
      await sql.begin(async (tx) => {
        await tx.unsafe(WAREHOUSE_INIT_LOCK_SQL);
        await tx.unsafe(WAREHOUSE_SCHEMA_SQL);
      });
    },
    async query(query, params) {
      // postgres.js infers json for plain strings and encodes them a second time,
      // which would store the state as a JSON string instead of an object. Sending
      // strings as text leaves the explicit ::jsonb casts in the SQL in charge.
      const typed = params.map((param) =>
        typeof param === 'string' ? sql.typed(param, TEXT_OID) : param,
      );
      return [...(await sql.unsafe(query, typed as never[]))] as Record<string, unknown>[];
    },
  });
  return store;
}
