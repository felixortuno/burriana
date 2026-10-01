/** Public identity only. Password hashes and session versions never leave the server. */
export const ROLES = ['administrador', 'encargado', 'pantalla'] as const;
export type Role = (typeof ROLES)[number];
export type PublicUser = { id: string; username: string; name: string; role: Role };
export type ManagedUser = PublicUser & { active: boolean; bootstrap: boolean };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.some((role) => role === value);
}
