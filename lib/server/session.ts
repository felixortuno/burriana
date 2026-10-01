// Signed session cookies. Kept free of database and Node imports so proxy can
// perform an inexpensive check; route handlers also resolve the current user.

/** One morning shift: 07:00 to 15:00. Signing back in each day is the intent. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const SESSION_COOKIE = "burriana_sesion";

export type Credentials = { user: string; password: string };

/**
 * Reads the single office account from the environment. Returns null when it is
 * missing or unusable, which every caller must treat as "closed", never "open".
 */
export function readCredentials(): Credentials | null {
  const user = process.env.WAREHOUSE_ADMIN_USER;
  const password = process.env.WAREHOUSE_ADMIN_PASSWORD;
  if (!user?.trim() || /[\u0000-\u001f\u007f]/.test(user)) return null;
  // Any non-empty password is accepted, by explicit choice of the account owner.
  // An unset one still fails closed, so the app never opens without a password.
  if (!password) return null;
  return { user: user.trim(), password };
}

const encoder = new TextEncoder();

/**
 * Compares submitted credentials without leaking how much of them was right.
 * Hashing first keeps both operands the same length whatever was typed.
 */
export async function matchesCredentials(
  submitted: Credentials,
  expected: Credentials,
): Promise<boolean> {
  const digest = async ({ user, password }: Credentials) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(`${user.length}|${user}|${password}`)),
    );
  const [a, b] = await Promise.all([digest(submitted), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

// The password is the signing key, so changing it invalidates every session.
async function signingKey(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`burriana.sesion.v1|${password}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** Builds a signed token that expires one shift from now. */
export async function createSession(
  credentials: Credentials,
  now = Date.now(),
): Promise<{ token: string; maxAgeSeconds: number }> {
  const payload = `${credentials.user}|${now + SESSION_TTL_MS}`;
  const key = await signingKey(credentials.password);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return {
    token: `${toBase64Url(encoder.encode(payload))}.${toBase64Url(signature)}`,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * True only for a token this deployment signed, for the account currently
 * configured, that has not expired.
 */
export async function verifySession(
  token: string | undefined,
  credentials: Credentials,
  now = Date.now(),
): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  if (!encodedPayload || !encodedSignature || rest.length) return false;

  const payloadBytes = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return false;

  const key = await signingKey(credentials.password);
  if (!await crypto.subtle.verify("HMAC", key, signature, payloadBytes)) return false;

  const separator = new TextDecoder().decode(payloadBytes).lastIndexOf("|");
  if (separator < 0) return false;
  const payload = new TextDecoder().decode(payloadBytes);
  if (payload.slice(0, separator) !== credentials.user) return false;

  const expiresAt = Number(payload.slice(separator + 1));
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

export type IdentitySession = { id: string; sessionVersion: number };

/** The token identifies the account; it deliberately contains no authorization role. */
export async function createUserSession(
  user: IdentitySession,
  credentials: Credentials,
  now = Date.now(),
): Promise<{ token: string; maxAgeSeconds: number }> {
  const payload = JSON.stringify({ v: 2, sub: user.id, sv: user.sessionVersion, issuer: credentials.user, exp: now + SESSION_TTL_MS });
  const key = await signingKey(`identity.v2|${credentials.password}`);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return { token: `${toBase64Url(encoder.encode(payload))}.${toBase64Url(signature)}`, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export async function readUserSession(token: string | undefined, credentials: Credentials, now = Date.now()): Promise<IdentitySession | null> {
  if (!token || token.length > 1024) return null;
  const [encoded, signed, ...rest] = token.split('.');
  if (!encoded || !signed || rest.length) return null;
  const payload = fromBase64Url(encoded);
  const signature = fromBase64Url(signed);
  if (!payload || !signature) return null;
  const key = await signingKey(`identity.v2|${credentials.password}`);
  if (!await crypto.subtle.verify('HMAC', key, signature, payload)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payload));
    if (!claims || claims.v !== 2 || claims.issuer !== credentials.user
      || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128
      || !Number.isSafeInteger(claims.sv) || claims.sv < 1
      || !Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
    return { id: claims.sub, sessionVersion: claims.sv };
  } catch { return null; }
}

export function readSessionCookie(headers: Headers): string | undefined {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** Proxy pre-filter only. Account status and current permissions are checked in access.ts. */
export async function checkSessionSignature(headers: Headers): Promise<'ok' | 'unconfigured' | 'unauthenticated'> {
  const credentials = readCredentials();
  if (!credentials || (process.env.WAREHOUSE_LOCAL_DATA_DIR && process.env.NODE_ENV === 'production')) return 'unconfigured';
  const token = readSessionCookie(headers);
  return (await verifySession(token, credentials) || await readUserSession(token, credentials)) ? 'ok' : 'unauthenticated';
}
