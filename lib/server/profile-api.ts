import { authorizeRequest, getCurrentUser, validateMutationOrigin } from './access.ts';
import { updateOwnProfile } from './profile.ts';
import { createUserSession, readCredentials, readSessionCookie, readUserSession, SESSION_COOKIE } from './session.ts';
import { publicUser, UserInputError } from './users.ts';

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...extra } });
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeRequest(request.headers);
  if (denied) return denied;
  try {
    const user = await getCurrentUser(request.headers);
    if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
    return json({ user, editable: user.id !== 'bootstrap' });
  } catch { return json({ error: 'No se pueden cargar tus ajustes. Inténtalo de nuevo.' }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeRequest(request.headers);
  if (denied) return denied;
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4000) throw new Error('Payload too large');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    input = value as Record<string, unknown>;
  } catch { return json({ error: 'Solicitud no válida.' }, 400); }

  try {
    const credentials = readCredentials();
    const actor = await getCurrentUser(request.headers);
    if (!credentials || !actor) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
    // Legacy bootstrap tokens have no version, and updateOwnProfile rejects
    // bootstrap edits before using it. Managed profiles always need a v2 token.
    const identity = await readUserSession(readSessionCookie(request.headers), credentials);
    const updated = await updateOwnProfile(actor, input, identity?.sessionVersion ?? 0);
    const extra: Record<string, string> = {};
    if (input.action === 'password') {
      const { token, maxAgeSeconds } = await createUserSession(updated, credentials);
      extra['Set-Cookie'] = sessionCookie(token, maxAgeSeconds);
    }
    return json({ user: publicUser(updated), editable: true }, 200, extra);
  } catch (error) {
    if (error instanceof UserInputError) {
      return json({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    }
    return json({ error: 'No se han podido guardar tus ajustes. Inténtalo de nuevo.' }, 503);
  }
}
