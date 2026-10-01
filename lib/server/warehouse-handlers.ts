import { getWarehouseStore } from './store';
import { createWarehouseHandlers } from './warehouse-api';
import { getCurrentUser, requireRoles, validateMutationOrigin } from './access';

export const { GET, POST } = createWarehouseHandlers(getWarehouseStore, {
  authorize: (headers) => requireRoles(headers, ['administrador', 'encargado']),
  validateMutationOrigin,
  actor: getCurrentUser,
});
