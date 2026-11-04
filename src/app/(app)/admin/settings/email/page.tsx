import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { sampleValues } from "@/domain/requests/email";
import { renderBody, renderSubject, TEMPLATE_VARIABLES } from "@/domain/requests/template";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { ProjectTabs } from "@/features/projects/project-tabs";
import { EmailPreview } from "@/features/settings/email-preview";
import { TeamEmailForm } from "@/features/settings/team-settings-form";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTeamSettings } from "@/server/settings/team-settings";

export default function EmailPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <EmailSettings />
    </Suspense>
  );
}

/** One tab per template (To / Cc and the email text), and one for the variables. `#soa`, `#purchasing`, `#sales` open their tab. */
const TEAMS = [
  { id: "soa", role: "SOA", type: "BOQ", label: "SOA", tab: "SOA (BOQ)", note: "Email BOQ dari Sales ke SOA." },
  { id: "purchasing", role: "PURCHASING", type: "RFQ", label: "Purchasing", tab: "Purchasing (RFQ)", note: "Email RFQ dari Sales ke Purchasing." },
  { id: "sales", role: "SALES", type: "PO", label: "Sales (HITPO)", tab: "Sales (HITPO)", note: "Email PO dari Sales ke Purchasing. Isi To dengan alamat Purchasing." },
] as const;

async function EmailSettings() {
  // Admins read the policy; only a superadmin changes it.
  const viewer = await requirePermission("settings.view");
  const mayEdit = can(viewer.role, "settings.manage");
  const settings = await getTeamSettings(getDb());

  // One tab per template, and the variables in their own tab, so only one form is on screen at a time.
  const tabs = [
    ...TEAMS.map((team) => {
      const setting = settings[team.role];
      return {
        id: team.id,
        label: team.tab,
        content: (
          <Card id={team.id} className="scroll-mt-20">
            <CardHeader>
              <CardTitle className="text-base">
                <h2>Tim {team.label}</h2>
              </CardTitle>
              <CardDescription>
                {team.note} {setting.isDefault ? "Memakai template bawaan." : `Terakhir disimpan ${formatDay(setting.updatedAt!)}${setting.updatedByName ? ` oleh ${setting.updatedByName}` : ""}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {mayEdit ? (
                <TeamEmailForm role={team.role} label={team.label} subject={setting.emailSubject} body={setting.emailBody} emailTo={setting.emailTo} emailCc={setting.emailCc} />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">To / Cc</dt>
                    <dd className="font-mono text-xs break-words">{setting.emailTo || "Pengaturan server"} / {setting.emailCc || "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Subjek email</dt>
                    <dd className="font-mono text-xs break-words">{setting.emailSubject}</dd>
                  </div>
                </dl>
              )}
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <EmailPreview label={team.label} subject={renderSubject(setting.emailSubject, sampleValues(team.type))} body={renderBody(setting.emailBody, sampleValues(team.type))} />
                <span className="text-xs text-muted-foreground">Daftar variabel ada di tab Variabel.</span>
              </div>
            </CardContent>
          </Card>
        ),
      };
    }),
    {
      id: "variables",
      label: "Variabel",
      content: (
        <Card className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Variabel</h2>
            </CardTitle>
            <CardDescription>
              Tulis variabel di antara dua kurung kurawal, misalnya <code>{"{{request_id}}"}</code>. <code>{"{{request_id}}"}</code> wajib ada di subjek atau di isi email, supaya
              balasan bisa dicocokkan dengan request-nya. Di subjek lebih aman, karena balasan membawa subjek. Baris yang variabelnya kosong tidak ditampilkan.
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
      ),
    },
  ];

  return (
    <>
      <DashboardHeader
        title="Email"
        summary={`Penerima dan teks email untuk BOQ, RFQ, dan PO (HITPO). Batas waktu jawaban ada di halaman SLA.${mayEdit ? "" : " Hanya Superadmin yang bisa mengubahnya."}`}
      />
      <ProjectTabs tabs={tabs} defaultTab="soa" label="Template email" />
    </>
  );
}
