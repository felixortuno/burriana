import { requireRoles } from '@/lib/server/access';
import { getWarehouseStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireRoles(request.headers, ['administrador', 'encargado', 'pantalla']);
  if (denied) return denied;
  try {
    const { revision, state } = await getWarehouseStore().read();
    // Dedicated projection: screen users never receive inventory, users or full exports.
    const workOrders = state.workOrders.map((order) => {
      const { events: _events, ...visible } = order;
      void _events;
      return visible;
    });
    return Response.json({ revision, workOrders, shift: state.shift, serverTime: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'No se puede actualizar la pantalla.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
