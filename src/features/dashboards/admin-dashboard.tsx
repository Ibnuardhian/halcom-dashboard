import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS, ROLES } from "@/domain/access/roles";
import { USERS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getUserStats, recentAuditEvents } from "@/server/users/queries";
import { DashboardHeader } from "./dashboard-header";
import { formatUtc } from "./format";

const COPY = {
  admin: {
    title: "Admin dashboard",
    summary: "Accounts and recent administrative activity. Admins manage operational users; only a superadmin manages admins.",
  },
  superadmin: {
    title: "Superadmin dashboard",
    summary: "Full oversight of accounts and administrative activity, including admin and superadmin accounts.",
  },
} as const;

/** The only dashboard widgets with real data today: they read the users and audit tables. */
export async function AdminDashboard({ viewer, scope }: { viewer: SessionUser; scope: keyof typeof COPY }) {
  const db = getDb();
  const [stats, events] = await Promise.all([getUserStats(db, viewer), recentAuditEvents(db, viewer, 10)]);

  return (
    <>
      <DashboardHeader title={COPY[scope].title} summary={COPY[scope].summary} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Accounts</h2>
            </CardTitle>
            <CardDescription>
              {stats.active} active of {stats.total} total.{" "}
              <Link href={USERS_PATH} className="underline underline-offset-4">
                Manage users
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Inactive</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLES.map((role) => (
                  <TableRow key={role}>
                    <TableCell>{ROLE_LABELS[role]}</TableCell>
                    <TableCell className="text-right">{stats.byRole[role].active}</TableCell>
                    <TableCell className="text-right">{stats.byRole[role].inactive}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Recent administrative activity</h2>
            </CardTitle>
            <CardDescription>Latest {events.length || 10} audit events. Times are UTC.</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <Badge variant="outline">No activity yet</Badge>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap">{formatUtc(event.createdAt)}</TableCell>
                      <TableCell>{event.action}</TableCell>
                      <TableCell>{event.actorName ?? "System"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
