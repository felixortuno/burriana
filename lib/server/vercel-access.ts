import { createHash, timingSafeEqual } from "node:crypto";

const noStore = { "Cache-Control": "private, no-store" };

function unauthorized(): Response {
  return Response.json(
    { error: "Introduce las credenciales de acceso al almacén." },
    {
      status: 401,
      headers: {
        ...noStore,
        "WWW-Authenticate": 'Basic realm="BURRIANA", charset="UTF-8"',
      },
    },
  );
}

/** Called both by the page proxy and by the Vercel API handler. */
export function authorizeRequest(headers: Headers): Response | null {
  const user = process.env.WAREHOUSE_ADMIN_USER;
  const password = process.env.WAREHOUSE_ADMIN_PASSWORD;
  if (
    !user?.trim() ||
    /[:\u0000-\u001f\u007f]/.test(user) ||
    !password ||
    password.length < 20
  ) {
    return Response.json(
      { error: "El acceso al almacén todavía no está configurado." },
      { status: 503, headers: noStore },
    );
  }

  const authorization = headers.get("authorization");
  if (!authorization || authorization.length > 8192) return unauthorized();
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return unauthorized();

  const encoded = match[1];
  const bytes = Buffer.from(encoded, "base64");
  // Buffer's decoder ignores some malformed input; require canonical base64.
  if (bytes.toString("base64") !== encoded) return unauthorized();

  let credentials: string;
  try {
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unauthorized();
  }

  // Hash first so the constant-time comparison always receives equal sizes.
  const actual = createHash("sha256").update(credentials).digest();
  const expected = createHash("sha256").update(`${user}:${password}`).digest();
  return timingSafeEqual(actual, expected) ? null : unauthorized();
}

/** Browser Basic credentials are sent automatically, so writes also need CSRF checks. */
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
