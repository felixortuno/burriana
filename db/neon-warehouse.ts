import { neon } from '@neondatabase/serverless';
import {
  createPostgresWarehouseStore,
  WAREHOUSE_INIT_LOCK_SQL,
  WAREHOUSE_SCHEMA_SQL,
} from './postgres-warehouse.ts';
import type { WarehouseStore } from '../lib/server/warehouse-api.ts';

let store: WarehouseStore | undefined;

export function getPostgresWarehouseStore(): WarehouseStore {
  if (store) return store;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for the Vercel database');

  const sql = neon(connectionString);
  store = createPostgresWarehouseStore({
    async initialize() {
      await sql.transaction([
        sql.query(WAREHOUSE_INIT_LOCK_SQL),
        sql.query(WAREHOUSE_SCHEMA_SQL),
      ], { fetchOptions: { signal: AbortSignal.timeout(15000) } });
    },
    async query(query, params) {
      return await sql.query(query, params, {
        fetchOptions: { signal: AbortSignal.timeout(15000) },
      });
    },
  });
  return store;
}
