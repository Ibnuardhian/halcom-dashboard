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
export const SETTINGS_PATH = "/admin/settings";
export const MASTER_DATA_PATH = "/admin/master-data";
export const PROJECTS_PATH = "/projects";
export const REQUESTS_PATH = "/requests";
export const NEW_REQUEST_PATH = "/requests/new";
export const ACCOUNT_PATH = "/account";
export const NOTIFICATIONS_PATH = "/notifications";

/** A fixed module link and the permission that shows it. The page enforces the same permission. */
const MODULE_LINKS: readonly (NavLinkItem & { permission: Permission; hiddenFor?: readonly Role[] })[] = [
  { href: PROJECTS_PATH, label: "Projects", group: "work", icon: "projects", permission: "projects.view", hiddenFor: ["PURCHASING"] },
  { href: REQUESTS_PATH, label: "All requests", group: "work", icon: "requests", permission: "requests.view", hiddenFor: ["SALES", "SOA", "PURCHASING"] },
  { href: `${REQUESTS_PATH}/boq`, label: "BOQ requests", group: "work", icon: "boq", permission: "requests.view", hiddenFor: ["SALES", "PURCHASING"] },
  { href: `${REQUESTS_PATH}/rfq`, label: "RFQ requests", group: "work", icon: "rfq", permission: "requests.view", hiddenFor: ["SALES", "SOA"] },
  { href: `${REQUESTS_PATH}/po`, label: "PO requests", group: "work", icon: "po", permission: "requests.view", hiddenFor: ["SALES", "SOA", "PURCHASING"] },
  { href: NEW_REQUEST_PATH, label: "New request", group: "work", icon: "new", permission: "requests.create", hiddenFor: ["SALES", "SOA", "PURCHASING"] },
  { href: USERS_PATH, label: "Users", group: "administration", icon: "users", permission: "users.view" },
  { href: AUDIT_PATH, label: "Audit log", group: "administration", icon: "audit", permission: "audit.view" },
  { href: BACKUPS_PATH, label: "Backups", group: "administration", icon: "backups", permission: "system.backup" },
  { href: MASTER_DATA_PATH, label: "Master data", group: "administration", icon: "system", permission: "masterdata.manage" },
  { href: SETTINGS_PATH, label: "Team settings", group: "administration", icon: "system", permission: "settings.manage" },
  { href: SYSTEM_PATH, label: "System", group: "administration", icon: "system", permission: "system.monitor" },
];

/** Navigation shown to a role. Derived from the permission matrix, so the menu can never offer a page the role cannot open. */
export function navLinksFor(role: Role): NavLinkItem[] {
  const links: NavLinkItem[] = [];
  // Purchasing works from its own dashboard and the RFQ list only. Everything else stays reachable by address; it is just not offered.
  const focused = role === "PURCHASING";
  if (!focused && can(role, "dashboard.shared.view")) {
    links.push({ href: SHARED_DASHBOARD_PATH, label: "Overview", group: "dashboards", icon: "overview" });
  }
  const own = dashboardForRole(role);
  if (can(role, `dashboard.${own}.view`)) {
    // Sales work from one page: the pipeline holds their projects, margins and every kind of request.
    links.push({ href: dashboardPath(own), label: role === "SALES" ? "Sales Pipeline" : focused ? "Purchasing Dashboard" : "My dashboard", group: "dashboards", icon: "dashboard" });
  }
  for (const key of DASHBOARD_KEYS) {
    if (focused || key === own || !can(role, `dashboard.${key}.view`)) continue;
    const owner = ROLES.find((r) => dashboardForRole(r) === key)!;
    links.push({ href: dashboardPath(key), label: `${ROLE_LABELS[owner]} dashboard`, group: "dashboards", icon: "dashboard" });
  }
  for (const { permission, hiddenFor, ...link } of MODULE_LINKS) {
    if (can(role, permission) && !hiddenFor?.includes(role)) links.push(link);
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
