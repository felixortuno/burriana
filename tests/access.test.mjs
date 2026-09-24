import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeRequest,
  checkAccess,
  isPublicPath,
  validateMutationOrigin,
} from "../lib/server/access.ts";
import {
  createSession,
  matchesCredentials,
  readCredentials,
  SESSION_COOKIE,
} from "../lib/server/session.ts";

const user = "oficina-prueba";
const password = "fixture-solamente-no-es-un-secreto";

// No default parameters here: the "missing configuration" cases pass undefined
// on purpose, and defaults would silently turn them into a valid account.
function configure(name, secret) {
  if (name === undefined) delete process.env.WAREHOUSE_ADMIN_USER;
  else process.env.WAREHOUSE_ADMIN_USER = name;
  if (secret === undefined) delete process.env.WAREHOUSE_ADMIN_PASSWORD;
  else process.env.WAREHOUSE_ADMIN_PASSWORD = secret;
}

const useValidAccount = () => configure(user, password);

const cookie = (token) => new Headers({ cookie: `${SESSION_COOKIE}=${token}` });

async function validToken() {
  const { token } = await createSession(readCredentials());
  return token;
}

test("access stays closed until the account is configured", async (t) => {
  const originalUser = process.env.WAREHOUSE_ADMIN_USER;
  const originalPassword = process.env.WAREHOUSE_ADMIN_PASSWORD;
  try {
    await t.test("missing or unusable configuration fails closed", async () => {
      for (const [name, secret] of [
        [undefined, undefined],
        [user, undefined],
        [undefined, password],
        ["", password],
        ["   ", password],
        [user, "demasiado-corta"],
        ["con\nsalto", password],
      ]) {
        configure(name, secret);
        assert.equal(await checkAccess(new Headers()), "unconfigured");
        assert.equal((await authorizeRequest(new Headers())).status, 503);
      }
    });

    await t.test("a configured account still needs a session", async () => {
      useValidAccount();
      assert.equal(await checkAccess(new Headers()), "unauthenticated");
      const denied = await authorizeRequest(new Headers());
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "private, no-store");
    });

    await t.test("a session this deployment signed is accepted", async () => {
      useValidAccount();
      const token = await validToken();
      assert.equal(await checkAccess(cookie(token)), "ok");
      assert.equal(await authorizeRequest(cookie(token)), null);
    });

    await t.test("the cookie is found among others", async () => {
      useValidAccount();
      const token = await validToken();
      const headers = new Headers({
        cookie: `otra=1; ${SESSION_COOKIE}=${token}; ultima=2`,
      });
      assert.equal(await checkAccess(headers), "ok");
    });

    await t.test("tampered, malformed and empty tokens are rejected", async () => {
      useValidAccount();
      const token = await validToken();
      const [payload, signature] = token.split(".");
      for (const candidate of [
        "",
        "sin-punto",
        `${payload}.${signature}.extra`,
        `${payload}.`,
        `.${signature}`,
        `${payload}.${signature.slice(0, -2)}xx`,
        `${btoa("otro|9999999999999").replace(/=+$/, "")}.${signature}`,
        "no-es-base64url!!.tampoco",
      ]) {
        assert.equal(await checkAccess(cookie(candidate)), "unauthenticated", candidate);
      }
    });

    await t.test("an expired session is rejected", async () => {
      useValidAccount();
      const { token } = await createSession(readCredentials(), Date.now() - 9 * 60 * 60 * 1000);
      assert.equal(await checkAccess(cookie(token)), "unauthenticated");
    });

    await t.test("changing the password or the user invalidates open sessions", async () => {
      useValidAccount();
      const token = await validToken();

      configure(user, `${password}-rotada`);
      assert.equal(await checkAccess(cookie(token)), "unauthenticated");

      configure("otro-usuario", password);
      assert.equal(await checkAccess(cookie(token)), "unauthenticated");

      useValidAccount();
      assert.equal(await checkAccess(cookie(token)), "ok");
    });

    await t.test("credentials are compared as a whole", async () => {
      useValidAccount();
      const expected = readCredentials();
      assert.equal(await matchesCredentials({ user, password }, expected), true);
      for (const wrong of [
        { user, password: `${password}x` },
        { user, password: password.slice(0, -1) },
        { user: `${user}x`, password },
        { user: "", password: "" },
        // A split that would collide if the two fields were simply concatenated.
        { user: `${user}${password[0]}`, password: password.slice(1) },
      ]) {
        assert.equal(await matchesCredentials(wrong, expected), false, JSON.stringify(wrong));
      }
    });

    await t.test("UTF-8 users and passwords work", async () => {
      configure("oficina-ñ", "contraseña-de-prueba-con-emoji-🔑");
      const token = await validToken();
      assert.equal(await checkAccess(cookie(token)), "ok");
    });
  } finally {
    configure(originalUser, originalPassword);
  }
});

test("the login route stays reachable without a session", () => {
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/api/session"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/api/warehouse"), false);
  assert.equal(isPublicPath("/login/otra"), false);
});

test("mutation origin checks prevent browser cross-origin writes", () => {
  const url = "https://almacen.example/api/warehouse";
  assert.equal(validateMutationOrigin(new Request(url, { method: "POST" })), null);
  assert.equal(
    validateMutationOrigin(
      new Request(url, { method: "POST", headers: { origin: "https://almacen.example" } }),
    ),
    null,
  );
  for (const headers of [
    { origin: "https://otro.example" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    assert.equal(validateMutationOrigin(new Request(url, { method: "POST", headers })).status, 403);
  }
});
