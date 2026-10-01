import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { isRole, type PublicUser } from '../identity.ts';

export type StoredUser = PublicUser & {
  passwordHash: string;
  active: boolean;
  sessionVersion: number;
};
export interface UsersStore {
  list(): Promise<StoredUser[]>;
  findById(id: string): Promise<StoredUser | null>;
  findByUsername(username: string): Promise<StoredUser | null>;
  create(user: StoredUser): Promise<boolean>;
  disable(id: string): Promise<StoredUser | null>;
  update(id: string, changes: Pick<StoredUser, 'name' | 'role'> & { passwordHash?: string }): Promise<StoredUser | null>;
}

export const USERS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS public.warehouse_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username = lower(username)),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrador', 'encargado', 'pantalla')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;
export const USERS_RLS_SQL = 'ALTER TABLE public.warehouse_users ENABLE ROW LEVEL SECURITY';
export const USERS_REVOKE_SQL = 'REVOKE ALL PRIVILEGES ON TABLE public.warehouse_users FROM anon, authenticated, PUBLIC';
export const USERS_INIT_LOCK_SQL = 'SELECT pg_advisory_xact_lock(75017330)';

function fromRow(row: Record<string, unknown>): StoredUser {
  const user = {
    id: row.id, username: row.username, name: row.name, role: row.role,
    passwordHash: row.password_hash, active: row.active, sessionVersion: row.session_version,
  };
  return validateStoredUser(user);
}

function validateStoredUser(value: unknown): StoredUser {
  if (!value || typeof value !== 'object') throw new Error('Invalid user store');
  const user = value as Record<string, unknown>;
  if (typeof user.id !== 'string' || !user.id || user.id === 'bootstrap'
    || typeof user.username !== 'string' || !user.username || user.username !== user.username.toLowerCase()
    || typeof user.name !== 'string' || !user.name || !isRole(user.role)
    || typeof user.passwordHash !== 'string' || typeof user.active !== 'boolean'
    || !Number.isSafeInteger(user.sessionVersion) || Number(user.sessionVersion) < 1) {
    throw new Error('Invalid user store');
  }
  return user as StoredUser;
}

export interface UsersExecutor {
  initialize(): Promise<void>;
  query(query: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

/** Initialization must finish its security transaction before any account query. */
export function createPostgresUsersStore(executor: UsersExecutor): UsersStore {
  let ready: Promise<void> | undefined;
  async function query(sql: string, params: unknown[] = []) {
    ready ??= executor.initialize().catch((error) => { ready = undefined; throw error; });
    await ready;
    return (await executor.query(sql, params)).map(fromRow);
  }
  return {
    list: () => query('SELECT * FROM public.warehouse_users ORDER BY username'),
    async findById(id) { return (await query('SELECT * FROM public.warehouse_users WHERE id = $1', [id]))[0] ?? null; },
    async findByUsername(username) { return (await query('SELECT * FROM public.warehouse_users WHERE username = $1', [username]))[0] ?? null; },
    async create(user) {
      const rows = await query(`INSERT INTO public.warehouse_users
        (id, username, name, role, password_hash, active, session_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (username) DO NOTHING RETURNING *`,
      [user.id, user.username, user.name, user.role, user.passwordHash, user.active, user.sessionVersion]);
      return rows.length === 1;
    },
    async disable(id) {
      return (await query(`UPDATE public.warehouse_users SET active = false,
        session_version = session_version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id]))[0] ?? null;
    },
    async update(id, changes) {
      return (await query(`UPDATE public.warehouse_users SET name = $2, role = $3,
        password_hash = COALESCE($4::text, password_hash), session_version = session_version + 1,
        updated_at = now() WHERE id = $1 AND active = true RETURNING *`,
      [id, changes.name, changes.role, changes.passwordHash ?? null]))[0] ?? null;
    },
  };
}

// One process in local development. Atomic rename prevents partially written files;
// the queue also covers separate store instances in that process.
const localQueues = new Map<string, Promise<unknown>>();
export function createLocalUsersStore(directory: string): UsersStore {
  const filename = path.join(path.resolve(directory), 'users.json');
  async function read(): Promise<StoredUser[]> {
    let raw: string;
    try { raw = await readFile(filename, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Invalid user store');
    const users = data.map(validateStoredUser);
    if (new Set(users.map((u) => u.id)).size !== users.length
      || new Set(users.map((u) => u.username)).size !== users.length) throw new Error('Invalid user store');
    return users;
  }
  function mutate<T>(operation: (users: StoredUser[]) => T): Promise<T> {
    const previous = localQueues.get(filename) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
      const users = await read();
      const value = operation(users);
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(users, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
      return value;
    });
    localQueues.set(filename, result);
    return result;
  }
  return {
    list: read,
    async findById(id) { return (await read()).find((user) => user.id === id) ?? null; },
    async findByUsername(username) { return (await read()).find((user) => user.username === username) ?? null; },
    create: (user) => mutate((users) => {
      if (users.some((existing) => existing.username === user.username || existing.id === user.id)) return false;
      users.push(validateStoredUser(structuredClone(user)));
      return true;
    }),
    disable: (id) => mutate((users) => {
      const user = users.find((entry) => entry.id === id);
      if (!user) return null;
      user.active = false;
      user.sessionVersion += 1;
      return structuredClone(user);
    }),
    update: (id, changes) => mutate((users) => {
      const user = users.find((entry) => entry.id === id && entry.active);
      if (!user) return null;
      user.name = changes.name;
      user.role = changes.role;
      if (changes.passwordHash !== undefined) user.passwordHash = changes.passwordHash;
      user.sessionVersion += 1;
      return structuredClone(user);
    }),
  };
}

let postgresStore: UsersStore | undefined;
const localStores = new Map<string, UsersStore>();

export function localUsersForbidden(): boolean {
  return Boolean(process.env.WAREHOUSE_LOCAL_DATA_DIR) && process.env.NODE_ENV === 'production';
}

export function getUsersStore(): UsersStore {
  const localDirectory = process.env.WAREHOUSE_LOCAL_DATA_DIR;
  if (localDirectory) {
    if (localUsersForbidden()) throw new Error('Local users are disabled in production');
    const key = path.resolve(localDirectory);
    let local = localStores.get(key);
    if (!local) { local = createLocalUsersStore(key); localStores.set(key, local); }
    return local;
  }
  if (postgresStore) return postgresStore;
  const connection = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connection) throw new Error('Users database is not configured');
  const sql = postgres(connection, {
    prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15,
    connection: { statement_timeout: 15000 }, onnotice: () => {},
  });
  postgresStore = createPostgresUsersStore({
    async initialize() {
      await sql.begin(async (tx) => {
        await tx.unsafe(USERS_INIT_LOCK_SQL);
        await tx.unsafe(USERS_SCHEMA_SQL);
        await tx.unsafe(USERS_RLS_SQL);
        await tx.unsafe(USERS_REVOKE_SQL);
      });
    },
    async query(query, params) {
      const typed = params.map((param) => typeof param === 'string' ? sql.typed(param, 25) : param);
      return [...await sql.unsafe(query, typed as never[])] as Record<string, unknown>[];
    },
  });
  return postgresStore;
}
