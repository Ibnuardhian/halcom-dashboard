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
  | "system"
  | "targets"
  | "handoff"
  | "reports"
  | "permissions"
  | "customers";

export type NavLinkItem = { href: string; label: string; group: NavGroup; icon: NavIcon };

export const USERS_PATH = "/admin/users";
export const SYSTEM_PATH = "/admin/system";
export const AUDIT_PATH = "/admin/audit";
export const BACKUPS_PATH = "/admin/backups";
export const SETTINGS_PATH = "/admin/settings";
export const MASTER_DATA_PATH = "/admin/master-data";
export const PROJECTS_PATH = "/projects";
export const REQUESTS_PATH = "/requests";
export const HANDOFFS_PATH = "/handoffs";
export const CROSSCHECK_PATH = "/finance/crosscheck";
export const PERMISSIONS_PATH = "/admin/permissions";
export const TECHNICAL_REPORTS_PATH = "/reports/technical";
export const FINANCE_REPORTS_PATH = "/reports/finance";
export const NEW_REQUEST_PATH = "/requests/new";
export const ACCOUNT_PATH = "/account";
export const NOTIFICATIONS_PATH = "/notifications";

/**
 * A fixed module link and the permission that shows it. The page enforces the same permission. `hiddenFor` keeps a link
 * out of a role's menu where another entry covers the same ground (the page stays reachable if the role holds the
 * permission), and `labels` renames it for a role that knows the module by another name.
 */
type ModuleLink = NavLinkItem & { permission: Permission; hiddenFor?: readonly Role[]; labels?: Partial<Record<Role, string>> };

export const SALES_TARGETS_PATH = "/targets";
export const CUSTOMERS_PATH = "/customers";

const MODULE_LINKS: readonly ModuleLink[] = [
  { href: PROJECTS_PATH, label: "Projects", group: "work", icon: "projects", permission: "projects.view" },
  // A project from another source (not the internal Sales team) is registered by SOA; Sales use the button on their dashboard.
  { href: `${PROJECTS_PATH}/new`, label: "New project", group: "work", icon: "new", permission: "projects.create.external", hiddenFor: ["SALES"] },
  { href: CUSTOMERS_PATH, label: "Customers", group: "work", icon: "customers", permission: "customers.view" },
  { href: SALES_TARGETS_PATH, label: "Sales Targets", group: "work", icon: "targets", permission: "targets.edit" },
  // Sales know the list of every request as the Request Center; SOA and Purchasing work from their own list instead.
  { href: REQUESTS_PATH, label: "All requests", group: "work", icon: "requests", permission: "requests.view", hiddenFor: ["SOA", "PURCHASING"], labels: { SALES: "Request Center" } },
  { href: `${REQUESTS_PATH}/boq`, label: "BOQ requests", group: "work", icon: "boq", permission: "requests.view", hiddenFor: ["SALES", "PURCHASING"], labels: { SOA: "BOQ Tickets" } },
  // Purchasing works RFQ and PO requests (confirmed); BOQ requests are not theirs.
  { href: `${REQUESTS_PATH}/rfq`, label: "RFQ requests", group: "work", icon: "rfq", permission: "requests.view", hiddenFor: ["SALES", "SOA"], labels: { PURCHASING: "RFQ Requests" } },
  { href: `${REQUESTS_PATH}/po`, label: "PO requests", group: "work", icon: "po", permission: "requests.view", hiddenFor: ["SALES", "SOA"] },
  { href: NEW_REQUEST_PATH, label: "New request", group: "work", icon: "new", permission: "requests.create", hiddenFor: ["SALES"] },
  { href: NEW_REQUEST_PATH, label: "New BOQ request", group: "work", icon: "new", permission: "requests.create.external", hiddenFor: ["SUPERADMIN", "ADMIN"] },
  { href: HANDOFFS_PATH, label: "Purchasing Handoff", group: "work", icon: "handoff", permission: "handoffs.view" },
  { href: TECHNICAL_REPORTS_PATH, label: "Technical Reports", group: "work", icon: "reports", permission: "reports.technical.view" },
  { href: CROSSCHECK_PATH, label: "Financial Crosscheck", group: "work", icon: "reports", permission: "finance.crosscheck.view" },
  { href: USERS_PATH, label: "Users and Roles", group: "administration", icon: "users", permission: "users.view" },
  { href: PERMISSIONS_PATH, label: "Permissions", group: "administration", icon: "permissions", permission: "permissions.view" },
  { href: SETTINGS_PATH, label: "SLA Policies", group: "administration", icon: "system", permission: "settings.view" },
  { href: MASTER_DATA_PATH, label: "Master Data", group: "administration", icon: "system", permission: "masterdata.manage", labels: { SOA: "Principal & Solution Master Data" } },
  { href: AUDIT_PATH, label: "Audit Logs", group: "administration", icon: "audit", permission: "audit.view" },
  { href: BACKUPS_PATH, label: "Backups", group: "administration", icon: "backups", permission: "system.backup" },
  { href: SYSTEM_PATH, label: "System", group: "administration", icon: "system", permission: "system.monitor" },
];

/** What a role calls its own dashboard. */
const OWN_DASHBOARD_LABELS: Partial<Record<Role, string>> = {
  SALES: "Sales Pipeline",
  SOA: "Technical Dashboard",
  PURCHASING: "Purchasing Dashboard",
  FINANCE: "Finance Dashboard",
  MANAGEMENT: "Management Dashboard",
  ADMIN: "Administration Dashboard",
  SUPERADMIN: "Administration Dashboard",
};

/** Navigation shown to a role. Derived from the permission matrix, so the menu can never offer a page the role cannot open. */
export function navLinksFor(role: Role): NavLinkItem[] {
  const links: NavLinkItem[] = [];
  if (can(role, "dashboard.shared.view")) {
    links.push({ href: SHARED_DASHBOARD_PATH, label: "Overview", group: "dashboards", icon: "overview" });
  }
  const own = dashboardForRole(role);
  if (can(role, `dashboard.${own}.view`)) {
    links.push({ href: dashboardPath(own), label: OWN_DASHBOARD_LABELS[role] ?? "My dashboard", group: "dashboards", icon: "dashboard" });
  }
  for (const key of DASHBOARD_KEYS) {
    if (key === own || !can(role, `dashboard.${key}.view`)) continue;
    const owner = ROLES.find((r) => dashboardForRole(r) === key)!;
    links.push({ href: dashboardPath(key), label: `${ROLE_LABELS[owner]} dashboard`, group: "dashboards", icon: "dashboard" });
  }
  for (const { permission, hiddenFor, labels, ...link } of MODULE_LINKS) {
    if (can(role, permission) && !hiddenFor?.includes(role)) links.push({ ...link, label: labels?.[role] ?? link.label });
  }
  // Two entries can lead to the same page (New request and New BOQ request); a role sees the first one it is allowed.
  return links.filter((link, index) => links.findIndex((other) => other.href === link.href) === index);
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
