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

/** Session cookies ride along automatically, so writes also need an origin check. */
export function validateMutationOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null && origin !== new URL(request.url).origin)
  ) {
    return Response.json(
      { error: "Solicitud no permitida." },
      { status: 403, headers: noStore },
    );
  }
  return null;
}
