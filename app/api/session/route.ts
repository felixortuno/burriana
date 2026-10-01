import { getCurrentUser, validateMutationOrigin } from '../../../lib/server/access.ts';
import {
  createUserSession,
  readCredentials,
  SESSION_COOKIE,
} from '../../../lib/server/session.ts';
import { authenticateUser } from '../../../lib/server/users.ts';
import { localUsersForbidden } from '../../../lib/server/users-store.ts';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...extra } });
}

function cookie(value: string, maxAgeSeconds: number) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Plain http on localhost would drop a Secure cookie and nobody could sign in.
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

// This counter is local to each server instance; deployment rate limiting should
// additionally protect public logins across instances.
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;

export async function GET(request: Request) {
  if (!readCredentials() || localUsersForbidden()) return json({ error: 'El acceso al almacén todavía no está configurado.' }, 503);
  try {
    const user = await getCurrentUser(request.headers);
    return user ? json({ user }, 200) : json({ error: 'Tu sesión ha caducado. Vuelve a entrar.', user: null }, 401);
  } catch { return json({ error: 'No se puede comprobar tu perfil. Inténtalo de nuevo.' }, 503); }
}

export async function POST(request: Request) {
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;

  const credentials = readCredentials();
  if (!credentials || localUsersForbidden()) {
    return json({ error: 'El acceso al almacén todavía no está configurado.' }, 503);
  }

  const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconocido';
  const now = Date.now();
  if (attempts.size > 1000) {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size > 10000) return json({ error: 'Demasiados intentos. Espera un minuto y vuelve a probar.' }, 429);
  }
  const record = attempts.get(source);
  if (record && record.until > now && record.count >= MAX_ATTEMPTS) {
    return json({ error: 'Demasiados intentos. Espera un minuto y vuelve a probar.' }, 429);
  }

  let body: { user?: unknown; username?: unknown; password?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 4000) throw new Error('Payload too large');
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Solicitud no válida.' }, 400);
  }

  const submittedUser = body?.user ?? body?.username;
  const username = typeof submittedUser === 'string' ? submittedUser.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  let identity;
  try { identity = await authenticateUser(username, password); }
  catch { return json({ error: 'No se puede comprobar tu perfil. Inténtalo de nuevo.' }, 503); }
  if (!identity) {
    attempts.set(source, {
      count: record && record.until > now ? record.count + 1 : 1,
      until: now + LOCKOUT_MS,
    });
    return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  }

  attempts.delete(source);
  const { token, maxAgeSeconds } = await createUserSession(identity, credentials, now);
  const { id, username: canonicalUsername, name, role } = identity;
  return json({ ok: true, user: { id, username: canonicalUsername, name, role } }, 200, { 'Set-Cookie': cookie(token, maxAgeSeconds) });
}

export async function DELETE(request: Request) {
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}
