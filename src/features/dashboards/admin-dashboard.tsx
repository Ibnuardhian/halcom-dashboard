import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS, ROLES } from "@/domain/access/roles";
import { formatSlaRange } from "@/domain/requests/sla";
import { AUDIT_PATH, MASTER_DATA_PATH, PERMISSIONS_PATH, SETTINGS_PATH, USERS_PATH } from "@/features/navigation/links";
import { getTeamSettings } from "@/server/settings/team-settings";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { countAdministrativeChanges, getUserStats, recentAuditEvents } from "@/server/users/queries";
import { DashboardHeader } from "./dashboard-header";
import { formatUtc } from "./format";
import { StatTile } from "./stat-tile";

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
  const [stats, events, settings, customers, principals, solutions, changes] = await Promise.all([
    getUserStats(db, viewer),
    recentAuditEvents(db, viewer, 10),
    getTeamSettings(db),
    db.customer.count(),
    db.principal.count(),
    db.solutionCategory.count(),
    // Administrative changes in the last seven days: accounts, settings and master data, not every login.
    countAdministrativeChanges(db, viewer, 7),
  ]);

  return (
    <>
      <DashboardHeader title={COPY[scope].title} summary={COPY[scope].summary} />
      <section aria-label="Administration" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active accounts" value={stats.active} href={USERS_PATH} note={`${stats.total - stats.active} inactive`} />
        <StatTile label="SLA: SOA / Purchasing" value={`${formatSlaRange(settings.SOA.sla)} / ${formatSlaRange(settings.PURCHASING.sla)}`} href={SETTINGS_PATH} note="Working days to answer a request" />
        <StatTile label="Master data" value={principals + solutions + customers} href={MASTER_DATA_PATH} note={`${principals} principals, ${solutions} solutions, ${customers} customers`} />
        <StatTile label="Changes in 7 days" value={changes} href={AUDIT_PATH} note="Audit events other than sign-ins" />
      </section>
      <p className="mb-4 text-sm text-muted-foreground">
        <Link href={PERMISSIONS_PATH} className="underline underline-offset-4">
          Review role permissions
        </Link>
      </p>
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
