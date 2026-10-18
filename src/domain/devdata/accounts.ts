import type { Role } from "@/domain/access/roles";

/** Synthetic development/test accounts. Their e-mail ends in .invalid, which no real mailbox can have. */
export function seedEmailFor(role: Role): string {
  return `${role.toLowerCase()}@example.invalid`;
}

export function seedNameFor(role: Role): string {
  return `Dev ${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}

/** The people of the development Sales team. Their accounts are created by `db:seed`; the sample projects belong to them. */
export const DEV_SALES_ACCOUNTS = [
  { name: "Dzaki", email: "dzaki@example.invalid" },
  { name: "Satrio", email: "satrio@example.invalid" },
] as const;
