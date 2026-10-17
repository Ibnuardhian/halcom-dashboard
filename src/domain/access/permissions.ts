import { DASHBOARD_KEYS, type DashboardKey } from "./dashboards";
import { isPrivilegedRole, ROLES, type Role } from "./roles";

/**
 * The single source of truth for what each role may do (see docs/requirements/RBAC.md).
 * UI code and server code must both ask `can()`; never compare role names elsewhere.
 * Add permissions here only when the feature that checks them exists.
 */
export type Permission =
  | "dashboard.shared.view"
  | `dashboard.${DashboardKey}.view`
  | "users.view"
  | "users.manage"
  | "users.manage-privileged"
  | "audit.view"
  | "system.monitor"
  | "system.backup"
  | "theme.switch"
  | "projects.view"
  | "projects.create"
  | "projects.edit.technical"
  | "projects.edit.commercial"
  | "targets.edit"
  | "projects.post-update"
  | "requests.view"
  | "requests.create"
  | "requests.email"
  | "requests.work.boq"
  | "requests.work.purchasing"
  | "requests.handover";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "dashboard.shared.view",
  ...DASHBOARD_KEYS.map((key) => `dashboard.${key}.view` as const),
  "users.view",
  "users.manage",
  "users.manage-privileged",
  "audit.view",
  "system.monitor",
  "system.backup",
  "theme.switch",
  "projects.view",
  "projects.create",
  "projects.edit.technical",
  "projects.edit.commercial",
  "targets.edit",
  "projects.post-update",
  "requests.view",
  "requests.create",
  "requests.email",
  "requests.work.boq",
  "requests.work.purchasing",
  "requests.handover",
];

/** Every role reads projects and requests (assumption A-9: no row-level visibility policy yet). */
const READ_WORK: readonly Permission[] = ["projects.view", "requests.view"];
const SALES_WORK: readonly Permission[] = ["projects.create", "projects.edit.commercial", "requests.create", "requests.email"];

function ownDashboardPermission(role: Role): Permission {
  return `dashboard.${role.toLowerCase() as DashboardKey}.view`;
}

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPERADMIN: new Set(ALL_PERMISSIONS),
  ADMIN: new Set<Permission>([
    "dashboard.shared.view",
    ...DASHBOARD_KEYS.filter((key) => key !== "superadmin").map(
      (key) => `dashboard.${key}.view` as const,
    ),
    "users.view",
    "users.manage",
    "audit.view",
    ...READ_WORK,
    ...SALES_WORK,
    "projects.edit.technical",
    "projects.post-update",
    "requests.work.boq",
    "requests.work.purchasing",
    "requests.handover",
  ]),
  SALES: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("SALES"), ...READ_WORK, ...SALES_WORK, "targets.edit"]),
  SOA: new Set<Permission>([
    "dashboard.shared.view",
    ownDashboardPermission("SOA"),
    ...READ_WORK,
    "projects.edit.technical",
    "projects.post-update",
    "requests.email",
    "requests.work.boq",
    "requests.handover",
  ]),
  PURCHASING: new Set<Permission>([
    "dashboard.shared.view",
    ownDashboardPermission("PURCHASING"),
    ...READ_WORK,
    "requests.work.purchasing",
  ]),
  FINANCE: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("FINANCE"), ...READ_WORK]),
  MANAGEMENT: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("MANAGEMENT"), ...READ_WORK]),
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** May `actor` change an account whose current role is `target` (edit, deactivate, reset password)? */
export function canManageUser(actor: Role, target: Role): boolean {
  if (!can(actor, "users.manage")) return false;
  return isPrivilegedRole(target) ? can(actor, "users.manage-privileged") : true;
}

/** May `actor` give an account the role `assigned`? */
export function canAssignRole(actor: Role, assigned: Role): boolean {
  if (!can(actor, "users.manage")) return false;
  return isPrivilegedRole(assigned) ? can(actor, "users.manage-privileged") : true;
}

export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((role) => canAssignRole(actor, role));
}
