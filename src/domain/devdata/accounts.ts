import { ROLE_LABELS, type Role } from "@/domain/access/roles";

/**
 * The development and test accounts use the company's own domain, the same one the Neon database uses (2026-10-23), so the seed, the
 * databases and the sign-in sheet agree. They are only created in a development or test database (the seed refuses anything else), and
 * the seed never runs against Neon.
 */
export const DEV_EMAIL_DOMAIN = "halcominovasi.co.id";

/** The people of the development Sales team. Their accounts are created by `db:seed`; the sample projects belong to them. */
export const DEV_SALES_ACCOUNTS = [
  { name: "Dzaki", email: `dzaki@${DEV_EMAIL_DOMAIN}` },
  { name: "Satrio", email: `satrio@${DEV_EMAIL_DOMAIN}` },
] as const;

/**
 * The account of a role. SOA signs in as `support@`. There is no generic Sales account: Sales sign in as one of the people above, and
 * the "Sales" role of the tests is the first of them (Satrio).
 */
export function seedEmailFor(role: Role): string {
  if (role === "SOA") return `support@${DEV_EMAIL_DOMAIN}`;
  if (role === "SALES") return DEV_SALES_ACCOUNTS[1].email;
  return `${role.toLowerCase()}@${DEV_EMAIL_DOMAIN}`;
}

/** The name an account shows: the role's label (Superadmin, Admin, SOA, Purchasing, Finance, Management), or the person for Sales. */
export function seedNameFor(role: Role): string {
  return role === "SALES" ? DEV_SALES_ACCOUNTS[1].name : ROLE_LABELS[role];
}
