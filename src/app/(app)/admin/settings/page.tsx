import { Suspense } from "react";
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

export default function EmailSlaPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <EmailSla />
    </Suspense>
  );
}

/** One page for every team: its SLA, the To / Cc and the email template Sales send it. Each team is a section with its own anchor (`#soa`, `#purchasing`). */
const TEAMS = [
  { id: "soa", role: "SOA", label: "SOA", note: "Menerima request BOQ." },
  { id: "purchasing", role: "PURCHASING", label: "Purchasing", note: "Menerima request RFQ dan PO." },
] as const;

async function EmailSla() {
  // Admins read the policy; only a superadmin changes it.
  const viewer = await requirePermission("settings.view");
  const mayEdit = can(viewer.role, "settings.manage");
  const settings = await getTeamSettings(getDb());

  return (
    <>
      <DashboardHeader
        title="Email & SLA"
        summary={`Batas waktu jawaban, penerima (To/CC) dan template email dari Sales untuk semua tim. Aplikasi mengisi template dan membuka draf di klien email Anda.${mayEdit ? "" : " Hanya Superadmin yang bisa mengubahnya."}`}
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

      <nav aria-label="Tim" className="mb-4 flex gap-3 text-sm">
        {TEAMS.map((team) => (
          <a key={team.id} href={`#${team.id}`} className="text-primary underline-offset-4 hover:underline">
            Tim {team.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-6">
        {TEAMS.map((team) => {
          const setting = settings[team.role];
          return (
            <Card key={team.id} id={team.id} className="scroll-mt-20">
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
          );
        })}
      </div>
    </>
  );
}
