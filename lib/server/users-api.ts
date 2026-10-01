import { getCurrentUser, requireRoles, validateMutationOrigin } from './access.ts';
import { createUser, deleteUser, listUsers, updateUser, UserInputError } from './users.ts';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireRoles(request.headers, ['administrador']);
  if (denied) return denied;
  try {
    const actor = await getCurrentUser(request.headers);
    if (!actor) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
    return json({ users: await listUsers(actor) });
  } catch { return json({ error: 'No se pueden cargar los perfiles.' }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireRoles(request.headers, ['administrador']);
  if (denied) return denied;
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 8000) throw new Error('Payload too large');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    body = value as Record<string, unknown>;
  } catch { return json({ error: 'Solicitud no válida.' }, 400); }
  try {
    const actor = await getCurrentUser(request.headers);
    if (!actor) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
    switch (body.type) {
      case 'create': return json({ user: await createUser(actor, body) }, 201);
      case 'delete': return json({ user: await deleteUser(actor, body.id) });
      case 'update': return json({ user: await updateUser(actor, body) });
      default: return json({ error: 'Operación de perfiles no válida.' }, 400);
    }
  } catch (error) {
    if (error instanceof UserInputError) return json({ error: error.message }, error.status);
    return json({ error: 'No se ha podido guardar el perfil. Inténtalo de nuevo.' }, 503);
  }
}
