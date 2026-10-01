import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getPostgresWarehouseStore } from '../../db/supabase-warehouse.ts';
import { initialState, normalizeState } from '../warehouse.ts';
import type { WarehouseSnapshot, WarehouseStore } from './warehouse-api.ts';

let localStore: WarehouseStore | undefined;

/** Explicit isolated development storage. Production always uses Postgres. */
export function getWarehouseStore(): WarehouseStore {
  const directory = process.env.WAREHOUSE_LOCAL_DATA_DIR;
  if (!directory) return getPostgresWarehouseStore();
  if (process.env.NODE_ENV === 'production') throw new Error('Local storage is disabled in production');
  if (localStore) return localStore;
  const root = resolve(directory);
  const filename = join(root, 'warehouse.json');
  const lock = join(root, 'warehouse.lock');

  async function read(): Promise<WarehouseSnapshot> {
    try {
      const snapshot = JSON.parse(await readFile(filename, 'utf8')) as WarehouseSnapshot;
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('Invalid local state');
      return { revision: snapshot.revision, state: normalizeState(snapshot.state) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, state: initialState() };
      throw error;
    }
  }

  localStore = {
    read,
    async write(expectedRevision, state) {
      await mkdir(root, { recursive: true });
      try { await mkdir(lock); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
      try {
        if ((await read()).revision !== expectedRevision) return false;
        const temp = `${filename}.${crypto.randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ revision: expectedRevision + 1, state }), { mode: 0o600 });
        await rename(temp, filename);
        return true;
      } finally { await rmdir(lock); }
    },
  };
  return localStore;
}
