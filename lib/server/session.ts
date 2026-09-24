// Session cookie for the office login. Web Crypto only, so the same code runs in
// the proxy and in route handlers.

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
