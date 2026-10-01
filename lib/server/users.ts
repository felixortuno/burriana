import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { isRole, type ManagedUser, type PublicUser } from '../identity.ts';
import { matchesCredentials, readCredentials } from './session.ts';
import { getUsersStore, type StoredUser, type UsersStore } from './users-store.ts';

export class UserInputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'UserInputError'; this.status = status; }
}

export function publicUser(user: PublicUser): PublicUser {
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

export function bootstrapUser(): PublicUser | null {
  const credentials = readCredentials();
  return credentials ? { id: 'bootstrap', username: credentials.user, name: credentials.user, role: 'administrador' } : null;
}

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Absent usernames still take one scrypt computation, as existing accounts do.
const DUMMY_HASH = `scrypt$v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt\$v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || password.length > 256) return false;
  const candidate = await derive(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(candidate, Buffer.from(match[2], 'hex'));
}

export async function authenticateUser(username: string, password: string, store?: UsersStore): Promise<(PublicUser & { sessionVersion: number }) | null> {
  const credentials = readCredentials();
  if (!credentials || !username.trim() || !password || username.length > 128 || password.length > 256) return null;
  // A reserved bootstrap name can never fall through to a managed account.
  if (username.trim().toLowerCase() === credentials.user.toLowerCase()) {
    if (!await matchesCredentials({ user: username.trim(), password }, credentials)) return null;
    return { ...bootstrapUser()!, sessionVersion: 1 };
  }
  const found = await (store ?? getUsersStore()).findByUsername(username.trim().toLowerCase());
  const correct = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  return found?.active && correct ? { ...publicUser(found), sessionVersion: found.sessionVersion } : null;
}

function requireAdministrator(actor: PublicUser) {
  if (actor.role !== 'administrador') throw new UserInputError('Solo el administrador puede gestionar los perfiles.', 403);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new UserInputError(`Revisa ${field}.`);
  }
  return value.trim();
}

function passwordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 256) {
    throw new UserInputError('La contraseña debe tener entre 6 y 256 caracteres.');
  }
  return value;
}

function managed(user: StoredUser): ManagedUser {
  return { ...publicUser(user), active: user.active, bootstrap: false };
}

export async function listUsers(actor: PublicUser, store?: UsersStore): Promise<ManagedUser[]> {
  requireAdministrator(actor);
  const bootstrap = bootstrapUser();
  return [
    ...(bootstrap ? [{ ...bootstrap, active: true, bootstrap: true }] : []),
    ...(await (store ?? getUsersStore()).list()).map(managed),
  ];
}

export async function createUser(actor: PublicUser, input: Record<string, unknown>, store?: UsersStore): Promise<ManagedUser> {
  requireAdministrator(actor);
  const username = text(input.username, 'el nombre de usuario', 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{1,63}$/.test(username)) {
    throw new UserInputError('El usuario debe tener entre 2 y 64 letras sin acentos, números, puntos, guiones o @.');
  }
  if (username === readCredentials()?.user.toLowerCase()) throw new UserInputError('Ese usuario está reservado para el administrador principal.', 409);
  const name = text(input.name, 'el nombre', 100);
  if (!isRole(input.role)) throw new UserInputError('Selecciona un perfil válido.');
  const password = passwordInput(input.password);
  const user: StoredUser = {
    id: randomUUID(), username, name, role: input.role,
    passwordHash: await hashPassword(password), active: true, sessionVersion: 1,
  };
  if (!await (store ?? getUsersStore()).create(user)) throw new UserInputError('Ese nombre de usuario ya existe, incluso si está dado de baja.', 409);
  return managed(user);
}

export async function deleteUser(actor: PublicUser, id: unknown, store?: UsersStore): Promise<ManagedUser> {
  requireAdministrator(actor);
  const userId = text(id, 'el perfil', 128);
  if (userId === 'bootstrap') throw new UserInputError('El administrador principal no se puede eliminar.', 403);
  if (userId === actor.id) throw new UserInputError('No puedes dar de baja tu propio perfil.', 403);
  const user = await (store ?? getUsersStore()).disable(userId);
  if (!user) throw new UserInputError('El perfil no existe.', 404);
  return managed(user);
}

export async function updateUser(actor: PublicUser, input: Record<string, unknown>, store?: UsersStore): Promise<ManagedUser> {
  requireAdministrator(actor);
  const id = text(input.id, 'el perfil', 128);
  if (id === 'bootstrap') throw new UserInputError('El administrador principal se configura en el servidor.', 403);
  const name = text(input.name, 'el nombre', 100);
  if (!isRole(input.role)) throw new UserInputError('Selecciona un perfil válido.');
  if (id === actor.id && input.role !== 'administrador') throw new UserInputError('No puedes quitarte el permiso de administrador.', 403);
  const passwordHash = input.password === undefined ? undefined : await hashPassword(passwordInput(input.password));
  const user = await (store ?? getUsersStore()).update(id, { name, role: input.role, passwordHash });
  if (!user) throw new UserInputError('El perfil no existe o está dado de baja.', 404);
  return managed(user);
}
