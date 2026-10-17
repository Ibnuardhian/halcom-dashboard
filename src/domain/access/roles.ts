/**
 * Application roles. Keep in sync with `enum Role` in prisma/schema.prisma;
 * a unit test enforces it. One role per user (assumption A-1, docs/requirements/RBAC.md).
 */
export const ROLES = [
  "SUPERADMIN",
  "ADMIN",
  "SALES",
  "SOA",
  "PURCHASING",
  "FINANCE",
  "MANAGEMENT",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Admin",
  SALES: "Sales",
  SOA: "SOA",
  PURCHASING: "Purchasing",
  FINANCE: "Finance",
  MANAGEMENT: "Management",
};

/** Roles that administer the system itself; only a superadmin may manage their accounts. */
export const PRIVILEGED_ROLES: readonly Role[] = ["SUPERADMIN", "ADMIN"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isPrivilegedRole(role: Role): boolean {
  return PRIVILEGED_ROLES.includes(role);
}
