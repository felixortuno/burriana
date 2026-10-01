import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GET as getUsers, POST as postUsers } from '../lib/server/users-api.ts';
import { GET as getSession, POST as login } from '../app/api/session/route.ts';
import { getCurrentUser, requireRoles } from '../lib/server/access.ts';
import { createSession, createUserSession, readCredentials, readUserSession, SESSION_COOKIE } from '../lib/server/session.ts';
import { authenticateUser, createUser, hashPassword, verifyPassword } from '../lib/server/users.ts';
import { createLocalUsersStore, createPostgresUsersStore, getUsersStore } from '../lib/server/users-store.ts';

test('individual accounts, permissions and revocation stay isolated from real inventory', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'burriana-users-test-'));
  const keys = ['WAREHOUSE_LOCAL_DATA_DIR', 'WAREHOUSE_ADMIN_USER', 'WAREHOUSE_ADMIN_PASSWORD', 'NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.WAREHOUSE_LOCAL_DATA_DIR = directory;
  process.env.NODE_ENV = 'test';
  process.env.WAREHOUSE_ADMIN_USER = 'test-admin';
  process.env.WAREHOUSE_ADMIN_PASSWORD = 'bootstrap-only-test';
  // Deliberately unusable: every read/write below must use the local adapter.
  process.env.DATABASE_URL = 'postgres://unreachable.invalid/never-connect';
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
  const credentials = readCredentials();
  const admin = { id: 'bootstrap', username: credentials.user, name: credentials.user, role: 'administrador' };
  const oldSession = await createSession(credentials);
  const adminCookie = `${SESSION_COOKIE}=${oldSession.token}`;
  const request = (cookie, body, extra = {}) => new Request('http://localhost/api/users', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, host: 'localhost', origin: 'http://localhost', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const sessionCookie = async (username, password) => {
    const identity = await authenticateUser(username, password);
    assert.ok(identity);
    const session = await createUserSession(identity, credentials);
    return `${SESSION_COOKIE}=${session.token}`;
  };
  let manager;
  let screen;
  let managerCookie;
  let screenCookie;
  try {
    await t.test('legacy bootstrap cookies remain administrators and only public fields are returned', async () => {
      assert.deepEqual(await getCurrentUser(new Headers({ cookie: adminCookie })), admin);
      const response = await getSession(request(adminCookie));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: admin });
      const listing = await getUsers(request(adminCookie));
      assert.deepEqual(await listing.json(), { users: [{ ...admin, active: true, bootstrap: true }] });
    });

    await t.test('administrator creates individual profiles with hashes and server-assigned IDs', async () => {
      for (const role of ['encargado', 'pantalla']) {
        const response = await postUsers(request(adminCookie, {
          type: 'create', username: role.toUpperCase(), name: `Perfil ${role}`,
          password: 'password-for-test', role, id: 'bootstrap', sessionVersion: 999,
        }));
        assert.equal(response.status, 201);
        const { user } = await response.json();
        assert.notEqual(user.id, 'bootstrap');
        assert.equal(user.username, role);
        assert.equal(user.role, role);
        assert.equal(user.bootstrap, false);
        assert.equal('passwordHash' in user, false);
        assert.equal('sessionVersion' in user, false);
        if (role === 'encargado') manager = user;
        else screen = user;
      }
      const persisted = JSON.parse(await readFile(path.join(directory, 'users.json'), 'utf8'));
      assert.equal(persisted.length, 2);
      assert.notEqual(persisted[0].passwordHash, persisted[1].passwordHash, 'each password gets its own salt');
      assert.equal(JSON.stringify(persisted).includes('password-for-test'), false);
      assert.equal(await verifyPassword('password-for-test', persisted[0].passwordHash), true);
      managerCookie = await sessionCookie('ENCARGADO', 'password-for-test');
      screenCookie = await sessionCookie('pantalla', 'password-for-test');
    });

    await t.test('login returns public identity and an HttpOnly cookie', async () => {
      const response = await login(request('', { user: 'pantalla', password: 'password-for-test' }));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.user, { id: screen.id, username: screen.username, name: screen.name, role: 'pantalla' });
      assert.equal(JSON.stringify(data).includes('passwordHash'), false);
      assert.equal(JSON.stringify(data).includes('sessionVersion'), false);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/);
      assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
      assert.equal((await login(request('', { user: 'pantalla', password: 'wrong-password' }))).status, 401);
    });

    await t.test('server permissions block manager and TV user management regardless of body claims', async () => {
      for (const cookie of [managerCookie, screenCookie]) {
        assert.equal((await getUsers(request(cookie))).status, 403);
        assert.equal((await postUsers(request(cookie, {
          type: 'create', username: 'attacker', name: 'Attacker', password: 'password-for-test', role: 'administrador', actor: admin,
        }))).status, 403);
        assert.equal((await postUsers(request(cookie, { type: 'delete', id: manager.id, role: 'administrador' }))).status, 403);
      }
      assert.equal(await requireRoles(new Headers({ cookie: managerCookie }), ['administrador', 'encargado']), null);
      assert.equal((await requireRoles(new Headers({ cookie: screenCookie }), ['administrador', 'encargado'])).status, 403);
      assert.equal((await getUsers(request(''))).status, 401);
    });

    await t.test('sessions contain no role and tampering cannot grant permission', async () => {
      const token = screenCookie.slice(screenCookie.indexOf('=') + 1);
      const [encoded, signature] = token.split('.');
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      assert.equal('role' in claims, false);
      assert.deepEqual(await readUserSession(token, credentials), { id: screen.id, sessionVersion: 1 });
      claims.role = 'administrador';
      claims.sub = 'bootstrap';
      const tampered = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
      assert.equal(await getCurrentUser(new Headers({ cookie: `${SESSION_COOKIE}=${tampered}` })), null);
      const expired = await createUserSession({ id: screen.id, sessionVersion: 1 }, credentials, Date.now() - 9 * 60 * 60 * 1000);
      assert.equal(await getCurrentUser(new Headers({ cookie: `${SESSION_COOKIE}=${expired.token}` })), null);
    });

    await t.test('same-origin validation and immutable bootstrap prevent administrative accidents', async () => {
      const forgedOrigin = request(adminCookie, { type: 'delete', id: manager.id }, { origin: 'https://other.example' });
      assert.equal((await postUsers(forgedOrigin)).status, 403);
      assert.equal((await postUsers(request(adminCookie, { type: 'delete', id: 'bootstrap' }))).status, 403);
      assert.equal((await postUsers(request(adminCookie, {
        type: 'create', username: 'TEST-ADMIN', name: 'Duplicate', role: 'administrador', password: 'password-for-test',
      }))).status, 409);
      assert.equal((await getCurrentUser(new Headers({ cookie: managerCookie }))).id, manager.id);
    });

    await t.test('editing a role or resetting a password invalidates existing sessions immediately', async () => {
      const response = await postUsers(request(adminCookie, {
        type: 'update', id: manager.id, name: 'Nuevo encargado', role: 'pantalla', password: 'changed-password-for-test',
      }));
      assert.equal(response.status, 200);
      assert.equal(await getCurrentUser(new Headers({ cookie: managerCookie })), null);
      assert.equal(await authenticateUser('encargado', 'password-for-test'), null);
      const identity = await authenticateUser('encargado', 'changed-password-for-test');
      assert.equal(identity.role, 'pantalla');
      assert.equal(identity.sessionVersion, 2);
      managerCookie = await sessionCookie('encargado', 'changed-password-for-test');
      assert.equal((await requireRoles(new Headers({ cookie: managerCookie }), ['encargado'])).status, 403);
    });

    await t.test('deletion disables login and old cookies while retaining identity for historical records', async () => {
      const response = await postUsers(request(adminCookie, { type: 'delete', id: screen.id }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.active, false);
      assert.equal(await authenticateUser('pantalla', 'password-for-test'), null);
      assert.equal(await getCurrentUser(new Headers({ cookie: screenCookie })), null);
      assert.equal((await getSession(request(screenCookie))).status, 401);
      const stored = await getUsersStore().findById(screen.id);
      assert.equal(stored.id, screen.id);
      assert.equal(stored.active, false);
      assert.equal(stored.sessionVersion, 2);
      assert.equal((await postUsers(request(adminCookie, {
        type: 'create', username: 'pantalla', name: 'Reuse forbidden', role: 'pantalla', password: 'password-for-test',
      }))).status, 409);
    });

    await t.test('parallel creation cannot duplicate usernames and public listings never contain hashes', async () => {
      const body = { username: 'concurrent', name: 'Concurrencia', role: 'encargado', password: 'password-for-test' };
      const results = await Promise.allSettled([createUser(admin, body), createUser(admin, body)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
      const listing = await (await getUsers(request(adminCookie))).json();
      assert.equal(JSON.stringify(listing).includes('passwordHash'), false);
      assert.equal(JSON.stringify(listing).includes('sessionVersion'), false);
      const user = listing.users.find((entry) => entry.id === screen.id);
      assert.equal(user.active, false);
    });

    await t.test('configuration fails closed and production rejects the local adapter without falling back to SQL', async () => {
      process.env.NODE_ENV = 'production';
      assert.throws(() => getUsersStore(), /disabled in production/);
      assert.equal(await getCurrentUser(new Headers({ cookie: adminCookie })), null);
      assert.equal((await getSession(request(adminCookie))).status, 503);
      assert.equal((await login(request('', { user: credentials.user, password: credentials.password }))).status, 503);
      process.env.NODE_ENV = 'test';
      delete process.env.WAREHOUSE_ADMIN_PASSWORD;
      assert.equal((await requireRoles(new Headers({ cookie: adminCookie }), ['administrador'])).status, 503);
      process.env.WAREHOUSE_ADMIN_PASSWORD = credentials.password;
    });
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('a corrupt local user store fails closed instead of resetting accounts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'burriana-corrupt-users-'));
  try {
    const filename = path.join(directory, 'users.json');
    await writeFile(filename, '{broken');
    await assert.rejects(createLocalUsersStore(directory).list());
    assert.equal(await readFile(filename, 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('users store waits for complete PostgreSQL security setup and retries failed initialization', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  let queries = 0;
  const failure = new Error('security denied');
  const store = createPostgresUsersStore({
    async initialize() { calls += 1; await gate; if (calls === 1) throw failure; },
    async query() { queries += 1; return []; },
  });
  const reads = [store.list(), store.findById('test')];
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(queries, 0);
  release();
  for (const result of await Promise.allSettled(reads)) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, failure);
  }
  assert.equal(queries, 0);
  assert.deepEqual(await store.list(), []);
  assert.equal(calls, 2);
  assert.equal(queries, 1);
});

test('SQL user lookups pass user-controlled values as parameters', async () => {
  const captured = [];
  const store = createPostgresUsersStore({
    async initialize() {},
    async query(sql, params) { captured.push({ sql, params }); return []; },
  });
  const malicious = "username' OR true --";
  await store.findByUsername(malicious);
  assert.equal(captured[0].sql.includes(malicious), false);
  assert.deepEqual(captured[0].params, [malicious]);
});

test('new profiles need passwords of 6 to 256 characters', async () => {
  const admin = { id: 'bootstrap', username: 'admin', name: 'Administración', role: 'administrador' };
  const store = { async create() { return true; } };
  const input = { username: 'operario', name: 'Operario', role: 'encargado' };
  await assert.rejects(createUser(admin, { ...input, password: '12345' }, store), /entre 6 y 256/);
  assert.equal((await createUser(admin, { ...input, password: '123456' }, store)).username, 'operario');
  await assert.rejects(createUser(admin, { ...input, password: 'x'.repeat(257) }, store), /entre 6 y 256/);
});

test('password hashes reject wrong passwords and malformed hashes', async () => {
  const hash = await hashPassword('contraseña-de-prueba');
  assert.equal(await verifyPassword('contraseña-de-prueba', hash), true);
  assert.equal(await verifyPassword('incorrecta', hash), false);
  assert.equal(await verifyPassword('contraseña-de-prueba', 'plaintext'), false);
});
