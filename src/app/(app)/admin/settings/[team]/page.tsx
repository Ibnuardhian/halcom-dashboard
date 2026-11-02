import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { formatSlaRange } from "@/domain/requests/sla";
import { renderBody, renderSubject, SAMPLE_VALUES, TEMPLATE_VARIABLES } from "@/domain/requests/template";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { TeamSettingsForm } from "@/features/settings/team-settings-form";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTeamSettings } from "@/server/settings/team-settings";

export default function TeamSlaPage({ params }: PageProps<"/admin/settings/[team]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <TeamSla params={params} />
    </Suspense>
  );
}

/** One module per team: its SLA and the email Sales send it. The address says which (`/admin/settings/soa`, `/admin/settings/purchasing`). */
const TEAMS = {
  soa: { role: "SOA", label: "SOA", title: "SLA SOA", note: "Menerima request BOQ." },
  purchasing: { role: "PURCHASING", label: "Purchasing", title: "SLA Purchasing", note: "Menerima request RFQ dan PO." },
} as const;

async function TeamSla({ params }: Pick<PageProps<"/admin/settings/[team]">, "params">) {
  const team = (TEAMS as Record<string, (typeof TEAMS)[keyof typeof TEAMS]>)[(await params).team];
  if (!team) notFound();
  // Admins read the policy; only a superadmin changes it.
  const viewer = await requirePermission("settings.view");
  const mayEdit = can(viewer.role, "settings.manage");
  const setting = (await getTeamSettings(getDb()))[team.role];

  return (
    <>
      <DashboardHeader
        title={team.title}
        summary={`Batas waktu jawaban tim ${team.label} dan template email dari Sales. ${team.note} Aplikasi mengisi template dan membuka draf di klien email Anda.${mayEdit ? "" : " Hanya Superadmin yang bisa mengubahnya."}`}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Variabel</h2>
          </CardTitle>
          <CardDescription>
            Tulis variabel di antara dua kurung kurawal, misalnya <code>{"{{request_id}}"}</code>. Subjek wajib memuat <code>{"{{request_id}}"}</code>: balasan email mempertahankan subjek, dan itulah cara SOA dan
            Purchasing menjawab dengan Request ID. Baris yang memakai variabel kosong untuk request (misalnya BOQ asal) tidak ditampilkan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {TEMPLATE_VARIABLES.map((variable) => (
              <div key={variable.name} className="flex gap-2">
                <dt>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{{${variable.name}}}`}</code>
                </dt>
                <dd className="text-muted-foreground">{variable.label}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Tim {team.label}</h2>
          </CardTitle>
          <CardDescription>
            {team.note} {setting.isDefault ? "Memakai template bawaan." : `Terakhir disimpan ${formatDay(setting.updatedAt!)}${setting.updatedByName ? ` oleh ${setting.updatedByName}` : ""}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {mayEdit ? (
            <TeamSettingsForm
              role={team.role}
              label={team.label}
              sla={formatSlaRange(setting.sla)}
              subject={setting.emailSubject}
              body={setting.emailBody}
              emailTo={setting.emailTo}
              emailCc={setting.emailCc}
            />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">SLA (hari kerja)</dt>
                <dd>{formatSlaRange(setting.sla)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Kirim ke (To) / Tembusan (CC)</dt>
                <dd className="font-mono text-xs break-words">{setting.emailTo || "Pengaturan server"} / {setting.emailCc || "–"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Subjek email</dt>
                <dd className="font-mono text-xs break-words">{setting.emailSubject}</dd>
              </div>
            </dl>
          )}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Pratinjau dengan data contoh</h3>
            <p className="mb-2 font-mono text-xs break-words">
              <span className="text-muted-foreground">Subjek: </span>
              {renderSubject(setting.emailSubject, SAMPLE_VALUES)}
            </p>
            <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">{renderBody(setting.emailBody, SAMPLE_VALUES)}</pre>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
