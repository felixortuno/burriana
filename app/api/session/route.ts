import { validateMutationOrigin } from '@/lib/server/access';
import {
  createSession,
  matchesCredentials,
  readCredentials,
  SESSION_COOKIE,
} from '@/lib/server/session';

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

// One office account, so a single wrong attempt is worth slowing down. Serverless
// instances do not share this counter: it blunts a careless script, and is not a
// substitute for a platform rate limit.
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;

export async function POST(request: Request) {
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;

  const credentials = readCredentials();
  if (!credentials) {
    return json({ error: 'El acceso al almacén todavía no está configurado.' }, 503);
  }

  const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconocido';
  const now = Date.now();
  const record = attempts.get(source);
  if (record && record.until > now && record.count >= MAX_ATTEMPTS) {
    return json({ error: 'Demasiados intentos. Espera un minuto y vuelve a probar.' }, 429);
  }

  let body: { user?: unknown; password?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 4000) throw new Error('Payload too large');
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Solicitud no válida.' }, 400);
  }

  const user = typeof body?.user === 'string' ? body.user.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!await matchesCredentials({ user, password }, credentials)) {
    attempts.set(source, {
      count: record && record.until > now ? record.count + 1 : 1,
      until: now + LOCKOUT_MS,
    });
    return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  }

  attempts.delete(source);
  const { token, maxAgeSeconds } = await createSession(credentials, now);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(token, maxAgeSeconds) });
}

export async function DELETE(request: Request) {
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}
