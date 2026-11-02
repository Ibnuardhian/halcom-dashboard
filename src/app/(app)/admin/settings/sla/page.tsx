import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { formatSlaRange } from "@/domain/requests/sla";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { TeamSlaForm } from "@/features/settings/team-settings-form";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTeamSettings } from "@/server/settings/team-settings";

export default function SlaPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SlaSettings />
    </Suspense>
  );
}

/** The SLA of every team on one page; the recipients and the email template are on the Email page. */
const TEAMS = [
  { id: "soa", role: "SOA", label: "SOA", note: "Menerima request BOQ." },
  { id: "purchasing", role: "PURCHASING", label: "Purchasing", note: "Menerima request RFQ dan PO." },
] as const;

async function SlaSettings() {
  // Admins read the policy; only a superadmin changes it.
  const viewer = await requirePermission("settings.view");
  const mayEdit = can(viewer.role, "settings.manage");
  const settings = await getTeamSettings(getDb());

  return (
    <>
      <DashboardHeader
        title="SLA"
        summary={`Batas waktu jawaban tiap tim, dalam hari kerja sejak request dibuat. Penerima dan template email ada di halaman Email.${mayEdit ? "" : " Hanya Superadmin yang bisa mengubahnya."}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {TEAMS.map((team) => {
          const setting = settings[team.role];
          return (
            <Card key={team.id} id={team.id} className="scroll-mt-20">
              <CardHeader>
                <CardTitle className="text-base">
                  <h2>Tim {team.label}</h2>
                </CardTitle>
                <CardDescription>{team.note}</CardDescription>
              </CardHeader>
              <CardContent>
                {mayEdit ? (
                  <TeamSlaForm role={team.role} label={team.label} sla={formatSlaRange(setting.sla)} />
                ) : (
                  <dl className="text-sm">
                    <dt className="text-xs font-medium text-muted-foreground">SLA (hari kerja)</dt>
                    <dd>{formatSlaRange(setting.sla)}</dd>
                  </dl>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
