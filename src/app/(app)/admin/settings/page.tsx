import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSlaRange } from "@/domain/requests/sla";
import { renderBody, renderSubject, SAMPLE_VALUES, TEMPLATE_VARIABLES } from "@/domain/requests/template";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { TeamSettingsForm } from "@/features/settings/team-settings-form";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTeamSettings } from "@/server/settings/team-settings";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Settings />
    </Suspense>
  );
}

const TEAMS = [
  { role: "SOA", label: "SOA", note: "Receives BOQ requests." },
  { role: "PURCHASING", label: "Purchasing", note: "Receives RFQ and PO requests." },
] as const;

async function Settings() {
  await requirePermission("settings.manage");
  const settings = await getTeamSettings(getDb());

  return (
    <>
      <DashboardHeader
        title="Team settings"
        summary="How fast SOA and Purchasing should answer (1 to 3 working days) and the email Sales send them. The application never sends the email; it fills the template and opens the draft."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Variables</h2>
          </CardTitle>
          <CardDescription>
            Write a variable between double braces, for example <code>{"{{request_id}}"}</code>. The subject must contain <code>{"{{request_id}}"}</code>: a reply keeps the
            subject, which is how SOA and Purchasing answer with the Request ID. A line that uses a variable which is empty for a request (such as the source BOQ) is left out.
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

      <div className="grid gap-6 xl:grid-cols-2">
        {TEAMS.map((team) => {
          const setting = settings[team.role];
          return (
            <Card key={team.role}>
              <CardHeader>
                <CardTitle className="text-base">
                  <h2>{team.label}</h2>
                </CardTitle>
                <CardDescription>
                  {team.note}{" "}
                  {setting.isDefault ? "Using the default template." : `Last saved ${formatUtc(setting.updatedAt!)}${setting.updatedByName ? ` by ${setting.updatedByName}` : ""}.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <TeamSettingsForm
                  key={`${team.role}-${setting.updatedAt?.toISOString() ?? "default"}`}
                  role={team.role}
                  label={team.label}
                  sla={formatSlaRange(setting.sla)}
                  subject={setting.emailSubject}
                  body={setting.emailBody}
                />
                <div className="border-t pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Preview with sample data</h3>
                  <p className="mb-2 font-mono text-xs break-words">
                    <span className="text-muted-foreground">Subject: </span>
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
