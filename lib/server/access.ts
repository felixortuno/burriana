import { readCredentials, SESSION_COOKIE, verifySession } from "./session.ts";

const noStore = { "Cache-Control": "private, no-store" };

export const LOGIN_PATH = "/login";

/** Paths that must stay reachable without a session, or nobody could sign in. */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === "/api/session";
}

function readSessionCookie(headers: Headers): string | undefined {
  const header = headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export type AccessResult = "ok" | "unconfigured" | "unauthenticated";

export async function checkAccess(headers: Headers): Promise<AccessResult> {
  const credentials = readCredentials();
  if (!credentials) return "unconfigured";
  return await verifySession(readSessionCookie(headers), credentials)
    ? "ok"
    : "unauthenticated";
}

/** JSON gate for the API. Returns null when the request may proceed. */
export async function authorizeRequest(headers: Headers): Promise<Response | null> {
  switch (await checkAccess(headers)) {
    case "ok":
      return null;
    case "unconfigured":
      return Response.json(
        { error: "El acceso al almacén todavía no está configurado." },
        { status: 503, headers: noStore },
      );
    case "unauthenticated":
      return Response.json(
        { error: "Tu sesión ha caducado. Vuelve a entrar." },
        { status: 401, headers: noStore },
      );
  }
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
