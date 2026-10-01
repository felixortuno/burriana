import { readCredentials, readSessionCookie, readUserSession, verifySession } from "./session.ts";
import { ROLES, type PublicUser, type Role } from '../identity.ts';
import { bootstrapUser, publicUser } from './users.ts';
import { getUsersStore, localUsersForbidden } from './users-store.ts';

const noStore = { "Cache-Control": "private, no-store" };

export const LOGIN_PATH = "/login";

/** Paths that must stay reachable without a session, or nobody could sign in. */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === "/api/session";
}

export type AccessResult = "ok" | "unconfigured" | "unauthenticated" | "unavailable";

/** Resolve roles and active status from the current server record on every request. */
export async function getCurrentUser(headers: Headers): Promise<PublicUser | null> {
  const credentials = readCredentials();
  if (!credentials || localUsersForbidden()) return null;
  const token = readSessionCookie(headers);
  // Existing administrator cookies remain valid through this upgrade.
  if (await verifySession(token, credentials)) return bootstrapUser();
  const identity = await readUserSession(token, credentials);
  if (!identity) return null;
  if (identity.id === 'bootstrap') return identity.sessionVersion === 1 ? bootstrapUser() : null;
  const user = await getUsersStore().findById(identity.id);
  return user?.active && user.sessionVersion === identity.sessionVersion ? publicUser(user) : null;
}

export async function checkAccess(headers: Headers): Promise<AccessResult> {
  const credentials = readCredentials();
  if (!credentials || localUsersForbidden()) return "unconfigured";
  try { return await getCurrentUser(headers) ? 'ok' : 'unauthenticated'; }
  catch { return 'unavailable'; }
}

/** JSON gate for the API. Returns null when the request may proceed. */
export async function authorizeRequest(headers: Headers): Promise<Response | null> {
  return requireRoles(headers, ROLES);
}

export async function requireRoles(headers: Headers, roles: readonly Role[]): Promise<Response | null> {
  if (!readCredentials() || localUsersForbidden()) {
    return Response.json({ error: 'El acceso al almacén todavía no está configurado.' }, { status: 503, headers: noStore });
  }
  let user: PublicUser | null;
  try { user = await getCurrentUser(headers); }
  catch { return Response.json({ error: 'No se puede comprobar tu perfil. Inténtalo de nuevo.' }, { status: 503, headers: noStore }); }
  if (!user) return Response.json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, { status: 401, headers: noStore });
  if (!roles.includes(user.role)) return Response.json({ error: 'Tu perfil no tiene permiso para realizar esta acción.' }, { status: 403, headers: noStore });
  return null;
}

/**
 * Session cookies ride along automatically, so writes also need a CSRF check.
 *
 * The Origin header is compared against the Host the request arrived on, not
 * against request.url: behind Vercel's proxy that URL carries an internal origin
 * that never matches what the browser sent, which would reject every real login.
 */
export function validateMutationOrigin(request: Request): Response | null {
  const denied = Response.json(
    { error: "Solicitud no permitida." },
    { status: 403, headers: noStore },
  );

  if (request.headers.get("sec-fetch-site") === "cross-site") return denied;

  const origin = request.headers.get("origin");
  // Non-browser clients send no Origin; sec-fetch-site above covers browsers.
  if (origin === null) return null;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return denied;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return denied;
  }
  // Hosts, not full origins: the proxy terminates TLS, so the scheme can differ.
  return originHost === host ? null : denied;
}
