import { can, type Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { GUIDE_LANES, GUIDE_NODES, GUIDE_ROLE_CAPABILITY, RESTRICTED_GUIDE_ROLES, type GuideNode } from "./workflow";

/**
 * The roles the guide highlights for a signed-in account: the account's own role(s), plus every role whose capability the account's
 * permissions cover. The application gives an account one role today; the parameter is a list so an account with several is
 * highlighted for all of them, and the permissions are read through `can()`, so a change in the permission editor changes the result.
 */
export function activeGuideRoles(accountRoles: readonly Role[]): Role[] {
  return GUIDE_LANES.filter(
    (lane) => accountRoles.includes(lane) || accountRoles.some((role) => GUIDE_ROLE_CAPABILITY[lane].every((permission) => can(role, permission))),
  );
}

/** Does any of the account's roles hold at least one of these permissions? */
function holdsAny(accountRoles: readonly Role[], permissions: readonly Permission[]): boolean {
  return accountRoles.some((role) => permissions.some((permission) => can(role, permission)));
}

/** A page link of a step, kept only when the account may open that page. */
export function visibleLinks(node: GuideNode, accountRoles: readonly Role[]): { label: string; href: string }[] {
  return node.guide.links.filter((link) => holdsAny(accountRoles, link.anyOf)).map(({ label, href }) => ({ label, href }));
}

/** Detailed steps of Admin and Superadmin are for the people who hold that role's capability; everyone else sees a one-line description. */
export function mayReadRoleSteps(role: Role, activeRoles: readonly Role[]): boolean {
  return !RESTRICTED_GUIDE_ROLES.includes(role) || activeRoles.includes(role);
}

export function nodesOfRole(role: Role): GuideNode[] {
  return GUIDE_NODES.filter((node) => node.role === role).sort((a, b) => a.col - b.col);
}
