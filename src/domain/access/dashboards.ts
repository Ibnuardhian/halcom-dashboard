import { ROLES, type Role } from "./roles";

/** One dashboard per role, addressed as `/dashboard/<key>`; the shared one is `/dashboard`. */
export type DashboardKey = Lowercase<Role>;

export const DASHBOARD_KEYS: readonly DashboardKey[] = ROLES.map(
  (role) => role.toLowerCase() as DashboardKey,
);

export const SHARED_DASHBOARD_PATH = "/dashboard";

export function dashboardForRole(role: Role): DashboardKey {
  return role.toLowerCase() as DashboardKey;
}

/** Returns the dashboard for a URL segment, or null for anything that is not an exact key. */
export function dashboardFromSlug(slug: string): DashboardKey | null {
  return DASHBOARD_KEYS.find((key) => key === slug) ?? null;
}

export function dashboardPath(key: DashboardKey): string {
  return `${SHARED_DASHBOARD_PATH}/${key}`;
}

/** Where a user lands after signing in. */
export function homePathFor(role: Role): string {
  return dashboardPath(dashboardForRole(role));
}
