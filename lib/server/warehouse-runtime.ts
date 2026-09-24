// Sites uses its D1 binding. Next.js replaces this module at build time.
import { warehouseDb } from '../../db/warehouse';
import { initialState, type State } from '../warehouse';
import { createWarehouseHandlers, type WarehouseStore } from './warehouse-api';

const store: WarehouseStore = {
  async read() {
    const row = await warehouseDb().prepare('SELECT revision,data FROM warehouse WHERE id=1')
      .first<{ revision: number; data: string }>();
    return row ? { revision: row.revision, state: JSON.parse(row.data) as State }
      : { revision: 0, state: initialState() };
  },
  async write(expectedRevision, state) {
    const result = await warehouseDb().prepare(
      'INSERT INTO warehouse (id, revision, data) VALUES (1, ?, ?) '
      + 'ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data '
      + 'WHERE warehouse.revision=? RETURNING revision',
    ).bind(expectedRevision + 1, JSON.stringify(state), expectedRevision).first();
    return Boolean(result);
  },
};

export const { GET, POST } = createWarehouseHandlers(() => store);
