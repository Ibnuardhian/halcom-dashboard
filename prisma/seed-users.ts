import type { Role } from "@/domain/access/roles";

/** Synthetic development/test accounts: one per role, all sharing the password in SEED_USER_PASSWORD. */
export const SEED_PASSWORD_ENV = "SEED_USER_PASSWORD";

export function seedEmailFor(role: Role): string {
  return `${role.toLowerCase()}@example.invalid`;
}

export function seedNameFor(role: Role): string {
  return `Dev ${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}
