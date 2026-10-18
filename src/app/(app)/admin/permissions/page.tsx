import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_PERMISSIONS, can } from "@/domain/access/permissions";
import { ROLE_LABELS, ROLES } from "@/domain/access/roles";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { requirePermission } from "@/server/auth/current-user";

export default function PermissionsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Permissions />
    </Suspense>
  );
}

/** The permission matrix as the server enforces it. It is read from the same `can()` every page and action asks, so it cannot drift. */
async function Permissions() {
  await requirePermission("permissions.view");

  return (
    <>
      <DashboardHeader
        title="Permissions"
        summary="What each role may do, as the server enforces it. This page only shows the rules: they are defined in code and reviewed with the product owner (docs/requirements/RBAC.md), not edited here."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Role permission matrix</h2>
          </CardTitle>
          <CardDescription>{ALL_PERMISSIONS.length} permissions. A tick means the role holds the permission.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Permissions per role</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Permission
                </th>
                {ROLES.map((role) => (
                  <th key={role} scope="col" className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((permission) => (
                <tr key={permission} className="border-b last:border-0">
                  <th scope="row" className="py-1.5 pr-4 text-left font-mono text-xs font-normal">
                    {permission}
                  </th>
                  {ROLES.map((role) => (
                    <td key={role} className="px-2 py-1.5 text-center">
                      {can(role, permission) ? (
                        <>
                          <span aria-hidden>✓</span>
                          <span className="sr-only">Allowed</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden className="text-muted-foreground/50">
                            –
                          </span>
                          <span className="sr-only">Not allowed</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
