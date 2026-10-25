import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignableRoles, can, canManageUser } from "@/domain/access/permissions";
import { ROLE_LABELS } from "@/domain/access/roles";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { ActiveForm, CreateUserForm, ResetPasswordForm, RoleForm } from "@/features/users/user-forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listUsers } from "@/server/users/queries";

export default function UsersPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const viewer = await requirePermission("users.view");
  const users = await listUsers(getDb(), viewer);
  const mayManage = can(viewer.role, "users.manage");
  const roles = assignableRoles(viewer.role);

  return (
    <>
      <DashboardHeader
        title="Users"
        summary="Accounts and roles. Every change is recorded in the audit trail."
      />
      {mayManage ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Create user</h2>
            </CardTitle>
            <CardDescription>
              Share the initial password through a secure channel. You can assign: {roles.map((r) => ROLE_LABELS[r]).join(", ")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateUserForm roles={roles} />
          </CardContent>
        </Card>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            {mayManage ? <TableHead>Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const editable = mayManage && user.id !== viewer.id && canManageUser(viewer.role, user.role);
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.name}
                  {user.id === viewer.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? "secondary" : "outline"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDay(user.createdAt)}</TableCell>
                {mayManage ? (
                  <TableCell>
                    {editable ? (
                      <div className="flex flex-col gap-3">
                        <RoleForm userId={user.id} currentRole={user.role} roles={roles} label={user.email} />
                        <ResetPasswordForm userId={user.id} label={user.email} />
                        <ActiveForm userId={user.id} isActive={user.isActive} label={user.email} />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
