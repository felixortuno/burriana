import type { PublicUser } from '../identity.ts';
import { getUsersStore, type StoredUser, type UsersStore } from './users-store.ts';
import { hashPassword, UserInputError, verifyPassword } from './users.ts';

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;

function allowFields(input: Record<string, unknown>, fields: string[]) {
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    throw new UserInputError('Solo puedes cambiar tu nombre o tu contraseña desde estos ajustes.');
  }
}

/** Self-service never accepts an account ID, a role, or an active flag from the client. */
export async function updateOwnProfile(
  actor: PublicUser,
  input: Record<string, unknown>,
  sessionVersion: number,
  store?: UsersStore,
): Promise<StoredUser> {
  if (actor.id === 'bootstrap') {
    throw new UserInputError('El administrador principal se configura en el servidor. Crea un perfil administrador personal para cambiar su nombre y contraseña desde aquí.', 403);
  }
  const users = store ?? getUsersStore();
  const current = await users.findById(actor.id);
  if (!current?.active || current.sessionVersion !== sessionVersion) {
    throw new UserInputError('Tu sesión ha caducado. Vuelve a entrar.', 401);
  }

  const changes: { name?: string; passwordHash?: string } = {};
  if (input.action === 'name') {
    allowFields(input, ['action', 'name']);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) {
      throw new UserInputError('El nombre debe tener entre 1 y 100 caracteres, sin saltos de línea.');
    }
    changes.name = input.name.trim();
  } else if (input.action === 'password') {
    allowFields(input, ['action', 'currentPassword', 'password']);
    if (typeof input.password !== 'string' || input.password.length < 6 || input.password.length > 256) {
      throw new UserInputError('La contraseña debe tener entre 6 y 256 caracteres.');
    }
    if (typeof input.currentPassword !== 'string' || !input.currentPassword || input.currentPassword.length > 256) {
      throw new UserInputError('Introduce tu contraseña actual.');
    }
    const now = Date.now();
    for (const [id, attempt] of attempts) if (attempt.until <= now) attempts.delete(id);
    const attempt = attempts.get(current.id);
    if (attempt && attempt.count >= MAX_ATTEMPTS) {
      throw new UserInputError('Demasiados intentos. Espera un minuto y vuelve a probar.', 429);
    }
    // Reserve an attempt before scrypt so concurrent requests share the limit.
    attempts.set(current.id, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + LOCKOUT_MS });
    if (!await verifyPassword(input.currentPassword, current.passwordHash)) {
      throw new UserInputError('La contraseña actual no es correcta.', 403);
    }
    changes.passwordHash = await hashPassword(input.password);
    attempts.delete(current.id);
  } else {
    throw new UserInputError('Operación de ajustes no válida.');
  }

  // Compare the version again in the atomic write. An administrator may have
  // revoked this session while password verification was running.
  const updated = await users.updateProfile(current.id, sessionVersion, changes);
  if (!updated) throw new UserInputError('El perfil ha cambiado. Vuelve a entrar antes de guardar.', 409);
  return updated;
}
