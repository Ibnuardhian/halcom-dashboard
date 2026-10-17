import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { PROJECT_EDITABLE_FIELDS, TECHNICAL_FIELDS, type ProjectEditableField } from "@/domain/projects/fields";
import { targetMarginAmount, weightedValue } from "@/domain/projects/pipeline";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { REQUEST_TYPES } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { NEW_REQUEST_PATH } from "@/features/navigation/links";
import { ActionComposer } from "@/features/projects/action-composer";
import { ActionFeed } from "@/features/projects/action-feed";
import { CommercialForm } from "@/features/projects/commercial-form";
import { ChangeLog } from "@/features/projects/change-log";
import { ProjectFieldsForm } from "@/features/projects/edit-forms";
import { formatAmount, formatPercent } from "@/features/projects/format";
import { Fact } from "@/features/requests/fact";
import { formatDateOnly } from "@/features/requests/format";
import { RequestTable } from "@/features/requests/request-table";
import { ProgressBadge, TrackStatusBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listProjectActions, listProjectChanges } from "@/server/projects/queries";
import { getProjectByCode, listRequests } from "@/server/requests/queries";

export default function ProjectPage({ params }: PageProps<"/projects/[code]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Project params={params} />
    </Suspense>
  );
}

/** Free text from the export: shown with its line breaks, or a plain "Not recorded". */
function Prose({ value }: { value: string | null }) {
  return value ? <p className="text-sm whitespace-pre-wrap">{value}</p> : <p className="text-sm text-muted-foreground">Not recorded.</p>;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="mb-6 scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>;
}

const SECTIONS = [
  ["overview", "Overview"],
  ["commercial", "Commercial"],
  ["technical", "Technical"],
  ["activity", "Activity"],
  ["requests", "Requests"],
] as const;

async function Project({ params }: Pick<PageProps<"/projects/[code]">, "params">) {
  const viewer = await requirePermission("projects.view");
  const project = await getProjectByCode(getDb(), viewer, (await params).code);
  if (!project) notFound();
  const [requests, changes, actions] = await Promise.all([
    listRequests(getDb(), viewer, { projectId: project.id }),
    listProjectChanges(getDb(), viewer, project.id),
    listProjectActions(getDb(), viewer, project.id),
  ]);
  const soaPhases = requests.filter((r) => r.type === "BOQ" && r.phase !== null && r.status !== "COMPLETED" && r.status !== "CANCELLED");
  const mayCreate = can(viewer.role, "requests.create") && project.trackStatus === "ON_TRACK";
  // SOA (and admins) edit the technical fields and post updates; commercial fields stay read-only for them.
  const mayEditTechnical = can(viewer.role, "projects.edit.technical");
  const mayPostUpdate = can(viewer.role, "projects.post-update");
  // Sales change their own projects; admins support any project (the service enforces the same rule).
  const mayEditCommercial = can(viewer.role, "projects.edit.commercial") && (viewer.role !== "SALES" || project.salesOwnerId === viewer.id);
  const estimated = project.estimatedValue?.toNumber() ?? null;
  const finalValue = project.finalValue?.toNumber() ?? null;
  const targetMargin = project.targetMargin?.toNumber() ?? null;
  const commercialValues = {
    progress: project.progress,
    trackStatus: project.trackStatus,
    quoteReleasedAt: project.quoteReleasedAt ? project.quoteReleasedAt.toISOString().slice(0, 10) : "",
    estimatedValue: estimated === null ? "" : String(estimated),
    probability: project.probability === null ? "" : String(project.probability),
    targetMargin: targetMargin === null ? "" : String(targetMargin),
    targetDate: project.targetDate ? project.targetDate.toISOString().slice(0, 10) : "",
  };

  const values: Record<ProjectEditableField, string | null> = {
    requirement: project.requirement,
    assessmentStatus: project.assessmentStatus,
    solutionProposed: project.solutionProposed,
    architectureStatus: project.architectureStatus,
    sizingStatus: project.sizingStatus,
    boqStatus: project.boqStatus,
    quotationStatus: project.quotationStatus,
    proposalStatus: project.proposalStatus,
    pocStatus: project.pocStatus,
    scopeEstimate: project.scopeEstimate,
    technicalChallenge: project.technicalChallenge,
    technicalBlocker: project.technicalBlocker,
    technicalNotes: project.technicalNotes,
  };
  // A fresh key after every save rebuilds the fields, so they show the stored values.
  const formKey = project.updatedAt.toISOString();
  const readOnlyTechnical = TECHNICAL_FIELDS.filter((field) => field !== "technicalNotes");

  return (
    <>
      <DashboardHeader title={`${project.endUserCompany} – ${project.name}`} summary={`Project ${project.code}`} />
      <nav aria-label="On this page" className="sticky top-0 z-10 -mx-4 mb-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:px-0">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      <Section id="overview" title="Overview">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Project ID">
            <span className="font-mono">{project.code}</span>
          </Fact>
          <Fact label="Progress">
            <ProgressBadge progress={project.progress} />
          </Fact>
          <Fact label="Status">
            <TrackStatusBadge status={project.trackStatus} />
          </Fact>
          <Fact label="Last updated">{formatUtc(project.updatedAt)}</Fact>
          <Fact label="Quote released">{formatDateOnly(project.quoteReleasedAt)}</Fact>
          <Fact label="Target closing">{formatDateOnly(project.targetDate)}</Fact>
          <Fact label="End user">{project.customer?.name ?? project.endUserCompany}</Fact>
          <Fact label="Industry">{project.industry ?? "–"}</Fact>
          <Fact label="Location">{project.location ?? "–"}</Fact>
          <Fact label="Principal">{project.principal?.name ?? "–"}</Fact>
          <Fact label="Solution">{project.solutionCategory?.name ?? "–"}</Fact>
          <Fact label="Sales PIC">{project.salesOwner.name}</Fact>
          <Fact label="Technical PIC">{project.technicalPic?.name ?? "–"}</Fact>
          <Fact label="Stakeholders">{project.stakeholders ?? "–"}</Fact>
          <Fact label="Estimated PO value">{formatAmount(estimated)}</Fact>
          <Fact label="Probability">{formatPercent(project.probability)}</Fact>
          <Fact label="Weighted value">{formatAmount(weightedValue(estimated, project.probability))}</Fact>
          <Fact label="Target margin">{formatPercent(targetMargin)}</Fact>
          <Fact label="Estimated gross profit">{formatAmount(targetMarginAmount(estimated, finalValue, targetMargin))}</Fact>
          <Fact label="Final value">{formatAmount(finalValue)}</Fact>
          {project.wonDate ? <Fact label="Won on">{formatDateOnly(project.wonDate)}</Fact> : null}
          {project.competitor ? <Fact label="Competitor">{project.competitor}</Fact> : null}
          {project.competitionStatus ? <Fact label="Competition status">{project.competitionStatus}</Fact> : null}
          {project.lostReason ? <Fact label="Lost reason">{project.lostReason}</Fact> : null}
          <Fact label="Created">{formatUtc(project.createdAt)}</Fact>
        </dl>
        <div className="mt-4 border-t pt-4">
          <Label>Description</Label>
          <Prose value={project.description} />
          {project.lostNotes ? (
            <>
              <div className="mt-4" />
              <Label>Lost notes</Label>
              <Prose value={project.lostNotes} />
            </>
          ) : null}
        </div>
      </Section>

      <Section
        id="commercial"
        title="Commercial"
        description={
          mayEditCommercial
            ? "Progress, status, value, probability, target margin, quote release and target closing. Every change is written to the change log below."
            : "Owned by the Sales PIC of the project. You can read it but not change it."
        }
      >
        {mayEditCommercial ? (
          <CommercialForm formKey={`commercial-${formKey}`} projectId={project.id} projectCode={project.code} values={commercialValues} />
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Progress">
              <ProgressBadge progress={project.progress} />
            </Fact>
            <Fact label="Status">
              <TrackStatusBadge status={project.trackStatus} />
            </Fact>
            <Fact label="Estimated PO value">{formatAmount(estimated)}</Fact>
            <Fact label="Probability">{formatPercent(project.probability)}</Fact>
            <Fact label="Target margin">{formatPercent(targetMargin)}</Fact>
            <Fact label="Quote released">{formatDateOnly(project.quoteReleasedAt)}</Fact>
            <Fact label="Target closing">{formatDateOnly(project.targetDate)}</Fact>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Target margin is a percentage of the sale; the estimated gross profit is computed from the final value, or the estimate until it is known.
        </p>
      </Section>

      <Section
        id="technical"
        title="Technical"
        description={
          mayEditTechnical
            ? "Technical details and BOQ progress. Every change is written to the change log below."
            : "Owned by SOA. You can read it but not change it."
        }
      >
        {mayEditTechnical ? (
          <ProjectFieldsForm
            formKey={`technical-${formKey}`}
            projectId={project.id}
            projectCode={project.code}
            fields={TECHNICAL_FIELDS}
            values={values}
            submitLabel="Save technical details"
          />
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              {readOnlyTechnical.map((field) => (
                <Fact key={field} label={PROJECT_EDITABLE_FIELDS[field].label}>
                  {values[field] ? <span className="whitespace-pre-wrap">{values[field]}</span> : <span className="text-muted-foreground">–</span>}
                </Fact>
              ))}
            </dl>
            <div className="mt-4 border-t pt-4">
              <Label>{PROJECT_EDITABLE_FIELDS.technicalNotes.label}</Label>
              <Prose value={project.technicalNotes} />
            </div>
          </>
        )}
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">SOA phase</h3>
          {soaPhases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open BOQ request has a phase yet. SOA label it as the work moves from Assessment to Sizing to POC.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {soaPhases.map((r) => (
                <li key={r.code}>
                  <Link href={`/request/${r.code}`} className="font-mono text-primary underline-offset-4 hover:underline">
                    {r.code}
                  </Link>{" "}
                  · {SOA_PHASE_LABELS[r.phase!]}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">Change log</h3>
          <ChangeLog changes={changes} />
        </div>
      </Section>

      <Section
        id="activity"
        title="Activity"
        description={
          mayPostUpdate
            ? "Add what was done (current action) and what comes next. Like comments: each entry records who wrote it and when."
            : "What was done and what comes next, written as dated updates by the technical team."
        }
      >
        <div className="flex flex-col gap-6">
          {mayPostUpdate ? <ActionComposer projectId={project.id} projectCode={project.code} /> : null}
          <ActionFeed entries={actions} />
        </div>
        {project.importedFrom ? <p className="mt-4 text-xs text-muted-foreground">Imported from {project.importedFrom}.</p> : null}
      </Section>

      <Section id="requests" title="Requests" description="BOQ, RFQ and PO requests of this project, newest first.">
        <div className="flex flex-col gap-4">
          {mayCreate ? (
            <div className="flex flex-wrap gap-2">
              {REQUEST_TYPES.map((type) => (
                <Link
                  key={type}
                  href={`${NEW_REQUEST_PATH}?project=${project.code}&type=${type}`}
                  className={buttonVariants({ variant: type === "BOQ" ? "default" : "outline" })}
                >
                  New {type}
                </Link>
              ))}
            </div>
          ) : null}
          <RequestTable rows={requests} emptyText="No requests for this project yet." />
        </div>
      </Section>
    </>
  );
}
