import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GET, POST } from '../lib/server/profile-api.ts';
import { getCurrentUser } from '../lib/server/access.ts';
import { updateOwnProfile } from '../lib/server/profile.ts';
import { createSession, createUserSession, readCredentials, readUserSession, SESSION_COOKIE } from '../lib/server/session.ts';
import { authenticateUser, createUser, publicUser } from '../lib/server/users.ts';
import { createLocalUsersStore, createPostgresUsersStore, getUsersStore } from '../lib/server/users-store.ts';

function request(cookie = '', body, extra = {}) {
  return new Request('http://localhost/api/profile', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, host: 'localhost', origin: 'http://localhost', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('personal settings persist safely for every role without touching real accounts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'burriana-profile-test-'));
  const keys = ['WAREHOUSE_LOCAL_DATA_DIR', 'WAREHOUSE_ADMIN_USER', 'WAREHOUSE_ADMIN_PASSWORD', 'NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    WAREHOUSE_LOCAL_DATA_DIR: directory, NODE_ENV: 'test',
    WAREHOUSE_ADMIN_USER: 'profile-test-admin', WAREHOUSE_ADMIN_PASSWORD: 'bootstrap-only-test',
    DATABASE_URL: 'postgres://unreachable.invalid/never-connect', POSTGRES_URL: 'postgres://unreachable.invalid/never-connect',
  });
  const credentials = readCredentials();
  const admin = { id: 'bootstrap', username: credentials.user, name: credentials.user, role: 'administrador' };
  const legacy = await createSession(credentials);
  const bootstrapCookie = `${SESSION_COOKIE}=${legacy.token}`;
  const users = new Map();
  const cookies = new Map();
  const sessionCookie = async (user, password = 'initial-test-password') => {
    const identity = await authenticateUser(user.username, password);
    assert.ok(identity);
    const session = await createUserSession(identity, credentials);
    return `${SESSION_COOKIE}=${session.token}`;
  };
  try {
    await t.test('anonymous settings requests fail closed', async () => {
      assert.equal((await GET(request())).status, 401);
      assert.equal((await POST(request('', { action: 'name', name: 'Intruso' }))).status, 401);
    });

    await t.test('each role reads and renames only its own persisted profile', async () => {
      for (const role of ['administrador', 'encargado', 'pantalla']) {
        const created = await createUser(admin, { username: `perfil-${role}`, name: role, role, password: 'initial-test-password' });
        users.set(role, created);
        const cookie = await sessionCookie(created);
        cookies.set(role, cookie);
        const response = await GET(request(cookie));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), { user: publicUser(created), editable: true });
        const renamed = await POST(request(cookie, { action: 'name', name: `  Mi perfil ${role}  ` }));
        assert.equal(renamed.status, 200);
        assert.equal(renamed.headers.get('set-cookie'), null);
        const expected = { ...publicUser(created), name: `Mi perfil ${role}` };
        assert.deepEqual(await renamed.json(), { user: expected, editable: true });
        assert.deepEqual(await getCurrentUser(new Headers({ cookie })), expected);
        const persisted = await createLocalUsersStore(directory).findById(created.id);
        assert.equal(persisted.name, expected.name);
        assert.equal(persisted.sessionVersion, 1);
        assert.equal(persisted.role, role);
      }
    });

    await t.test('bootstrap settings explain server management and never modify its credentials', async () => {
      assert.deepEqual(await (await GET(request(bootstrapCookie))).json(), { user: admin, editable: false });
      for (const body of [{ action: 'name', name: 'Otro' }, { action: 'password', currentPassword: credentials.password, password: 'changed-password' }]) {
        const response = await POST(request(bootstrapCookie, body));
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /se configura en el servidor/);
      }
      assert.deepEqual(readCredentials(), credentials);
      assert.deepEqual(await getCurrentUser(new Headers({ cookie: bootstrapCookie })), admin);
    });

    await t.test('client-supplied account IDs, permissions, and internal fields are rejected', async () => {
      const manager = users.get('encargado');
      const before = await getUsersStore().findById(manager.id);
      for (const [key, value] of Object.entries({ id: users.get('administrador').id, role: 'administrador', active: false, sessionVersion: 99, passwordHash: 'plaintext', username: 'admin', actor: admin })) {
        const response = await POST(request(cookies.get('encargado'), { action: 'name', name: 'Intento', [key]: value }));
        assert.equal(response.status, 400, key);
      }
      assert.deepEqual(await getUsersStore().findById(manager.id), before);
    });

    await t.test('both foreign Origin and browser cross-site requests are blocked', async () => {
      for (const extra of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }]) {
        const response = await POST(request(cookies.get('pantalla'), { action: 'name', name: 'Intento' }, extra));
        assert.equal(response.status, 403);
      }
      assert.equal((await getUsersStore().findById(users.get('pantalla').id)).name, 'Mi perfil pantalla');
    });

    await t.test('malformed requests and invalid personal fields do not save', async () => {
      const bodies = [null, [], {}, { action: 'other' }, { action: 'name', name: '' }, { action: 'name', name: 'x'.repeat(101) }, { action: 'name', name: 'Un\nnombre' },
        { action: 'password', currentPassword: 'initial-test-password', password: '12345' },
        { action: 'password', currentPassword: 'initial-test-password', password: 'x'.repeat(257) },
        { action: 'password', currentPassword: '', password: 'valid-password' },
        { action: 'password', currentPassword: 'x'.repeat(257), password: 'valid-password' },
        { action: 'name', name: 'x'.repeat(4001) }];
      for (const body of bodies) assert.equal((await POST(request(cookies.get('encargado'), body))).status, 400);
      const invalid = new Request('http://localhost/api/profile', { method: 'POST', headers: { cookie: cookies.get('encargado') }, body: '{broken' });
      assert.equal((await POST(invalid)).status, 400);
    });

    await t.test('password change verifies the current password without revoking sessions on failure', async () => {
      const response = await POST(request(cookies.get('encargado'), { action: 'password', currentPassword: 'wrong-password', password: 'new-test-password' }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.ok(await getCurrentUser(new Headers({ cookie: cookies.get('encargado') })));
      assert.ok(await authenticateUser(users.get('encargado').username, 'initial-test-password'));
    });

    await t.test('all roles can change passwords; only the returned session remains valid', async () => {
      for (const role of ['administrador', 'encargado', 'pantalla']) {
        const created = users.get(role);
        const otherSession = await sessionCookie(created);
        const response = await POST(request(cookies.get(role), { action: 'password', currentPassword: 'initial-test-password', password: 'new-test-password' }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { user: { ...publicUser(created), name: `Mi perfil ${role}` }, editable: true });
        const setCookie = response.headers.get('set-cookie');
        assert.match(setCookie, /HttpOnly/);
        assert.match(setCookie, /SameSite=Lax/);
        assert.match(setCookie, /Path=\//);
        assert.match(setCookie, /Max-Age=28800/);
        const currentCookie = setCookie.split(';')[0];
        assert.equal(await getCurrentUser(new Headers({ cookie: cookies.get(role) })), null);
        assert.equal(await getCurrentUser(new Headers({ cookie: otherSession })), null);
        assert.equal((await getCurrentUser(new Headers({ cookie: currentCookie }))).id, created.id);
        assert.equal(await authenticateUser(created.username, 'initial-test-password'), null);
        assert.ok(await authenticateUser(created.username, 'new-test-password'));
        const claims = await readUserSession(currentCookie.split('=')[1], credentials);
        assert.deepEqual(claims, { id: created.id, sessionVersion: 2 });
        cookies.set(role, currentCookie);
      }
      const persisted = await readFile(path.join(directory, 'users.json'), 'utf8');
      assert.equal(persisted.includes('new-test-password'), false);
      assert.equal(persisted.includes('initial-test-password'), false);
    });

    await t.test('repeated incorrect current passwords are limited per account', async () => {
      const body = { action: 'password', currentPassword: 'incorrect', password: 'unused-password' };
      for (let attempt = 0; attempt < 8; attempt += 1) assert.equal((await POST(request(cookies.get('pantalla'), body))).status, 403);
      const response = await POST(request(cookies.get('pantalla'), body));
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.ok(await getCurrentUser(new Headers({ cookie: cookies.get('pantalla') })));
    });

    await t.test('disabled accounts and unavailable storage cannot change settings', async () => {
      await getUsersStore().disable(users.get('pantalla').id);
      assert.equal((await GET(request(cookies.get('pantalla')))).status, 401);
      assert.equal((await POST(request(cookies.get('pantalla'), { action: 'name', name: 'Intento' }))).status, 401);
      const filename = path.join(directory, 'users.json');
      const savedData = await readFile(filename, 'utf8');
      await writeFile(filename, '{broken');
      assert.equal((await GET(request(cookies.get('encargado')))).status, 503);
      assert.equal((await POST(request(cookies.get('encargado'), { action: 'name', name: 'Intento' }))).status, 503);
      assert.equal(await readFile(filename, 'utf8'), '{broken');
      await writeFile(filename, savedData);
      delete process.env.WAREHOUSE_ADMIN_PASSWORD;
      assert.equal((await GET(request(bootstrapCookie))).status, 503);
      assert.equal((await POST(request(bootstrapCookie, { action: 'name', name: 'Intento' }))).status, 503);
    });
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('an administrator revoking a session during a profile save wins the atomic version check', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'burriana-profile-race-'));
  const store = createLocalUsersStore(directory);
  const user = { id: 'race-user', username: 'race-user', name: 'Antes', role: 'encargado', active: true, sessionVersion: 1, passwordHash: 'unused' };
  try {
    await store.create(user);
    const concurrentStore = {
      ...store,
      async updateProfile(id, sessionVersion, changes) {
        await store.update(id, { name: 'Cambio del administrador', role: 'pantalla' });
        return store.updateProfile(id, sessionVersion, changes);
      },
    };
    await assert.rejects(updateOwnProfile(publicUser(user), { action: 'name', name: 'Cambio obsoleto' }, 1, concurrentStore), (error) => error.status === 409);
    const current = await store.findById(user.id);
    assert.equal(current.name, 'Cambio del administrador');
    assert.equal(current.role, 'pantalla');
    assert.equal(current.sessionVersion, 2);
    await assert.rejects(updateOwnProfile(publicUser(user), { action: 'name', name: 'Otro intento' }, 1, store), (error) => error.status === 401);
    await store.disable(user.id);
    assert.equal(await store.updateProfile(user.id, 3, { name: 'No permitido' }), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PostgreSQL profile writes restrict columns and atomically compare the current session version', async () => {
  const captured = [];
  const store = createPostgresUsersStore({
    async initialize() {},
    async query(sql, params) { captured.push({ sql, params }); return []; },
  });
  const malicious = "Nombre', role = 'administrador' --";
  await store.updateProfile('my-profile', 4, { name: malicious });
  await store.updateProfile('my-profile', 4, { passwordHash: 'derived-hash' });
  assert.deepEqual(captured[0].params, ['my-profile', 4, malicious, null]);
  assert.deepEqual(captured[1].params, ['my-profile', 4, null, 'derived-hash']);
  assert.equal(captured[0].sql.includes(malicious), false);
  assert.match(captured[0].sql, /WHERE id = \$1 AND session_version = \$2 AND active = true/);
  assert.doesNotMatch(captured[0].sql, /SET role|, role =/);
  assert.match(captured[0].sql, /CASE WHEN \$4::text IS NULL THEN 0 ELSE 1 END/);
});
