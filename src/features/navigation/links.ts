import { DASHBOARD_KEYS, dashboardForRole, dashboardPath, SHARED_DASHBOARD_PATH } from "@/domain/access/dashboards";
import { can } from "@/domain/access/permissions";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/access/roles";

export type NavLinkItem = { href: string; label: string };

export const USERS_PATH = "/admin/users";

/** Navigation shown to a role. Derived from the permission matrix, so the menu can never offer a page the role cannot open. */
export function navLinksFor(role: Role): NavLinkItem[] {
  const links: NavLinkItem[] = [];
  if (can(role, "dashboard.shared.view")) {
    links.push({ href: SHARED_DASHBOARD_PATH, label: "Overview" });
  }
  const own = dashboardForRole(role);
  if (can(role, `dashboard.${own}.view`)) {
    links.push({ href: dashboardPath(own), label: "My dashboard" });
  }
  for (const key of DASHBOARD_KEYS) {
    if (key === own || !can(role, `dashboard.${key}.view`)) continue;
    const owner = ROLES.find((r) => dashboardForRole(r) === key)!;
    links.push({ href: dashboardPath(key), label: `${ROLE_LABELS[owner]} dashboard` });
  }
  if (can(role, "users.view")) {
    links.push({ href: USERS_PATH, label: "Users" });
  }
  return links;
}
