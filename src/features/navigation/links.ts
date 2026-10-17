import { DASHBOARD_KEYS, dashboardForRole, dashboardPath, SHARED_DASHBOARD_PATH } from "@/domain/access/dashboards";
import { can, type Permission } from "@/domain/access/permissions";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/access/roles";

export const NAV_GROUPS = ["dashboards", "work", "administration"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  dashboards: "Dashboards",
  work: "Work",
  administration: "Administration",
};

/** Icon names are mapped to components in the sidebar, so this module stays free of UI imports. */
export type NavIcon =
  | "overview"
  | "dashboard"
  | "projects"
  | "requests"
  | "boq"
  | "rfq"
  | "po"
  | "new"
  | "users"
  | "audit"
  | "backups"
  | "system";

export type NavLinkItem = { href: string; label: string; group: NavGroup; icon: NavIcon };

export const USERS_PATH = "/admin/users";
export const SYSTEM_PATH = "/admin/system";
export const AUDIT_PATH = "/admin/audit";
export const BACKUPS_PATH = "/admin/backups";
export const PROJECTS_PATH = "/projects";
export const REQUESTS_PATH = "/requests";
export const NEW_REQUEST_PATH = "/requests/new";
export const ACCOUNT_PATH = "/account";

/** A fixed module link and the permission that shows it. The page enforces the same permission. */
const MODULE_LINKS: readonly (NavLinkItem & { permission: Permission })[] = [
  { href: PROJECTS_PATH, label: "Projects", group: "work", icon: "projects", permission: "projects.view" },
  { href: REQUESTS_PATH, label: "All requests", group: "work", icon: "requests", permission: "requests.view" },
  { href: `${REQUESTS_PATH}/boq`, label: "BOQ requests", group: "work", icon: "boq", permission: "requests.view" },
  { href: `${REQUESTS_PATH}/rfq`, label: "RFQ requests", group: "work", icon: "rfq", permission: "requests.view" },
  { href: `${REQUESTS_PATH}/po`, label: "PO requests", group: "work", icon: "po", permission: "requests.view" },
  { href: NEW_REQUEST_PATH, label: "New request", group: "work", icon: "new", permission: "requests.create" },
  { href: USERS_PATH, label: "Users", group: "administration", icon: "users", permission: "users.view" },
  { href: AUDIT_PATH, label: "Audit log", group: "administration", icon: "audit", permission: "audit.view" },
  { href: BACKUPS_PATH, label: "Backups", group: "administration", icon: "backups", permission: "system.backup" },
  { href: SYSTEM_PATH, label: "System", group: "administration", icon: "system", permission: "system.monitor" },
];

/** Navigation shown to a role. Derived from the permission matrix, so the menu can never offer a page the role cannot open. */
export function navLinksFor(role: Role): NavLinkItem[] {
  const links: NavLinkItem[] = [];
  if (can(role, "dashboard.shared.view")) {
    links.push({ href: SHARED_DASHBOARD_PATH, label: "Overview", group: "dashboards", icon: "overview" });
  }
  const own = dashboardForRole(role);
  if (can(role, `dashboard.${own}.view`)) {
    links.push({ href: dashboardPath(own), label: "My dashboard", group: "dashboards", icon: "dashboard" });
  }
  for (const key of DASHBOARD_KEYS) {
    if (key === own || !can(role, `dashboard.${key}.view`)) continue;
    const owner = ROLES.find((r) => dashboardForRole(r) === key)!;
    links.push({ href: dashboardPath(key), label: `${ROLE_LABELS[owner]} dashboard`, group: "dashboards", icon: "dashboard" });
  }
  for (const { permission, ...link } of MODULE_LINKS) {
    if (can(role, permission)) links.push(link);
  }
  return links;
}

export type NavSection = { group: NavGroup; label: string; links: NavLinkItem[] };

/** The same links, split into the sidebar's labelled sections; empty sections are dropped. */
export function navSectionsFor(role: Role): NavSection[] {
  const links = navLinksFor(role);
  return NAV_GROUPS.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    links: links.filter((link) => link.group === group),
  })).filter((section) => section.links.length > 0);
}
