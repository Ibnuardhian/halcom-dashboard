import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { cellKey, permissionsByCategory } from "@/domain/access/permission-catalog";
import { ALL_PERMISSIONS, can, permissionChangeBlock } from "@/domain/access/permissions";
import { ROLE_LABELS, ROLES } from "@/domain/access/roles";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PermissionMatrix } from "@/features/permissions/permission-matrix";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listPermissionOverrides } from "@/server/permissions/service";

export default function PermissionsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Permissions />
    </Suspense>
  );
}

/**
 * The role permission matrix as the server enforces it, grouped in categories. It is read from the same `can()` every page and action
 * asks, so it cannot drift. Whoever holds `permissions.manage` (a superadmin by default) can also change it here.
 */
async function Permissions() {
  const viewer = await requirePermission("permissions.view");
  const editable = can(viewer.role, "permissions.manage");
  const overrides = await listPermissionOverrides(getDb());

  const granted: string[] = [];
  const locked: string[] = [];
  for (const role of ROLES) {
    for (const permission of ALL_PERMISSIONS) {
      const has = can(role, permission);
      if (has) granted.push(cellKey(role, permission));
      if (permissionChangeBlock(role, permission, !has) !== null) locked.push(cellKey(role, permission));
    }
  }
  const changed = overrides.map((override) => cellKey(override.role, override.permission));

  return (
    <>
      <DashboardHeader
        title="Permissions"
        summary={
          editable
            ? "What each role may do, as the server enforces it. Tick or clear a box and save to grant or revoke a permission. Every change is written to the audit log."
            : "What each role may do, as the server enforces it. Only a superadmin can change these."
        }
      />
      <p className="mb-3 text-sm text-muted-foreground">
        {ALL_PERMISSIONS.length} permissions in {permissionsByCategory().length} categories. {overrides.length === 0 ? "Every role has its built-in permissions." : `${overrides.length} permission${overrides.length === 1 ? " is" : "s are"} changed from the built-in defaults.`}
      </p>
      <PermissionMatrix
        categories={permissionsByCategory()}
        roles={ROLES.map((role) => ({ role, label: ROLE_LABELS[role] }))}
        granted={granted}
        changed={changed}
        locked={locked}
        editable={editable}
      />
    </>
  );
}
