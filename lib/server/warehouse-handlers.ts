import { getPostgresWarehouseStore } from '../../db/supabase-warehouse';
import { createWarehouseHandlers } from './warehouse-api';
import { authorizeRequest, validateMutationOrigin } from './access';

export const { GET, POST } = createWarehouseHandlers(getPostgresWarehouseStore, {
  authorize: authorizeRequest,
  validateMutationOrigin,
});
