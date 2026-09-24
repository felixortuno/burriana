import { getPostgresWarehouseStore } from '../../db/neon-warehouse';
import { createWarehouseHandlers } from './warehouse-api';
import { authorizeRequest, validateMutationOrigin } from './vercel-access';

export const { GET, POST } = createWarehouseHandlers(getPostgresWarehouseStore, {
  authorize: authorizeRequest,
  validateMutationOrigin,
});
