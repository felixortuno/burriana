import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeRequest,
  validateMutationOrigin,
} from "../lib/server/vercel-access.ts";
import { authorizeRequest as authorizeSitesRequest } from "../lib/server/deployment-access.ts";

const user = "oficina-prueba";
const password = "fixture-solamente-no-es-un-secreto";
const basic = (name = user, secret = password) =>
  new Headers({ authorization: `Basic ${Buffer.from(`${name}:${secret}`).toString("base64")}` });

test("Vercel access is closed until configured and requires valid credentials", async (t) => {
  const originalUser = process.env.WAREHOUSE_ADMIN_USER;
  const originalPassword = process.env.WAREHOUSE_ADMIN_PASSWORD;
  try {
    await t.test("missing or invalid configuration fails closed even with credentials", async () => {
      for (const [name, secret] of [
        [undefined, undefined],
        [user, undefined],
        [undefined, password],
        [" ", password],
        ["invalid:user", password],
        ["invalid\nuser", password],
        [user, "short-password"],
      ]) {
        if (name === undefined) delete process.env.WAREHOUSE_ADMIN_USER;
        else process.env.WAREHOUSE_ADMIN_USER = name;
        if (secret === undefined) delete process.env.WAREHOUSE_ADMIN_PASSWORD;
        else process.env.WAREHOUSE_ADMIN_PASSWORD = secret;
        const response = authorizeRequest(basic());
        assert.equal(response.status, 503);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.equal(response.headers.get("www-authenticate"), null);
        assert.equal((await response.text()).includes(password), false);
      }
    });

    process.env.WAREHOUSE_ADMIN_USER = user;
    process.env.WAREHOUSE_ADMIN_PASSWORD = password;

    await t.test("missing, wrong and malformed authentication is rejected without caching", async () => {
      const badHeaders = [
        new Headers(),
        basic("wrong-user"),
        basic(user, "wrong-password"),
        new Headers({ authorization: "Bearer sample-token" }),
        new Headers({ authorization: "Basic %%%%" }),
        new Headers({ authorization: "Basic YQ===" }),
        new Headers({ authorization: "Basic /w==" }),
        new Headers({ authorization: `${basic().get("authorization")}, Basic YQ==` }),
        new Headers({ authorization: `Basic ${"A".repeat(8192)}` }),
        new Headers({ "oai-authenticated-user-id": "spoofed", "oai-authenticated-user-email": "fake@example.com" }),
      ];
      for (const headers of badHeaders) {
        const response = authorizeRequest(headers);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("www-authenticate"), 'Basic realm="BURRIANA", charset="UTF-8"');
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.equal((await response.text()).includes(password), false);
      }
    });

    await t.test("correct credentials work, including UTF-8 and colons in passwords", () => {
      assert.equal(authorizeRequest(basic()), null);
      const lowerCaseScheme = basic();
      lowerCaseScheme.set("authorization", lowerCaseScheme.get("authorization").replace("Basic", "basic"));
      assert.equal(authorizeRequest(lowerCaseScheme), null);
      process.env.WAREHOUSE_ADMIN_USER = "oficina-ñ";
      process.env.WAREHOUSE_ADMIN_PASSWORD = "contraseña:fixture-de-prueba-🔑";
      assert.equal(authorizeRequest(basic(process.env.WAREHOUSE_ADMIN_USER, process.env.WAREHOUSE_ADMIN_PASSWORD)), null);
    });

    await t.test("Sites remains protected by its platform and does not require Basic config", () => {
      delete process.env.WAREHOUSE_ADMIN_USER;
      delete process.env.WAREHOUSE_ADMIN_PASSWORD;
      assert.equal(authorizeSitesRequest(new Headers()), null);
      assert.equal(authorizeRequest(basic()).status, 503);
    });
  } finally {
    if (originalUser === undefined) delete process.env.WAREHOUSE_ADMIN_USER;
    else process.env.WAREHOUSE_ADMIN_USER = originalUser;
    if (originalPassword === undefined) delete process.env.WAREHOUSE_ADMIN_PASSWORD;
    else process.env.WAREHOUSE_ADMIN_PASSWORD = originalPassword;
  }
});

test("mutation origin checks prevent browser cross-origin writes", () => {
  const url = "https://warehouse.example.com/api/warehouse";
  const request = (headers) => new Request(url, { method: "POST", headers });
  assert.equal(validateMutationOrigin(request({ origin: "https://warehouse.example.com", "sec-fetch-site": "same-origin" })), null);
  assert.equal(validateMutationOrigin(request({})), null); // Authenticated server clients need no Origin.
  for (const headers of [
    { origin: "https://attacker.example" },
    { origin: "https://warehouse.example.com.attacker.example" },
    { origin: "https://warehouse.example.com:444" },
    { origin: "http://warehouse.example.com" },
    { origin: "null" },
    { origin: "https://warehouse.example.com/path" },
    { "sec-fetch-site": "cross-site" },
    { origin: "https://warehouse.example.com", "sec-fetch-site": "cross-site" },
    { origin: "https://sibling.example.com", "sec-fetch-site": "same-site" },
  ]) {
    const response = validateMutationOrigin(request(headers));
    assert.equal(response.status, 403);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});
