import { effectiveIndustry } from "@/domain/customers/industry";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { PROJECT_EDITABLE_FIELDS, TECHNICAL_FIELDS, type ProjectEditableField } from "@/domain/projects/fields";
import { targetMarginAmount, targetMarginPercentOf, weightedValue } from "@/domain/projects/pipeline";
import { principalNamesOf } from "@/domain/projects/master-data";
import { PROGRESS_PERCENT } from "@/domain/projects/progress";
import { EXTERNAL_SOURCE_LABELS, SOURCE_LABELS, canRaiseRequestOn, salesActsOn } from "@/domain/projects/source";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { REQUEST_TYPES } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { NEW_REQUEST_PATH } from "@/features/navigation/links";
import { ActionComposer } from "@/features/projects/action-composer";
import { ActionFeed } from "@/features/projects/action-feed";
import { CommercialForm } from "@/features/projects/commercial-form";
import { DeleteProject } from "@/features/projects/delete-project";
import { FlowTracker } from "@/features/requests/flow-tracker";
import { ReassignPics } from "@/features/projects/reassign-pics";
import { SourceForm } from "@/features/projects/source-form";
import { ClassificationForm } from "@/features/masterdata/classification-form";
import { ChangeLog } from "@/features/projects/change-log";
import { ProjectFieldsForm } from "@/features/projects/edit-forms";
import { formatAmount, formatPercent } from "@/features/projects/format";
import { Fact } from "@/features/requests/fact";
import { formatDateOnly } from "@/features/requests/format";
import { RequestPanel } from "@/features/requests/request-panel";
import { ScrollToRequest } from "@/features/requests/scroll-to-request";
import { ProgressBadge, StatusBadge, TrackStatusBadge, TypeBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listProjectActions, listProjectChanges } from "@/server/projects/queries";
import { isOpen } from "@/domain/requests/status";
import { listMasterRecords } from "@/server/masterdata/service";
import { getProjectByCode, listPicOptions, listProjectRequestDetails, listRequests, listSalesPeopleOptions } from "@/server/requests/queries";

export default function ProjectPage({ params, searchParams }: PageProps<"/projects/[code]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Project params={params} searchParams={searchParams} />
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

async function Project({ params, searchParams }: Pick<PageProps<"/projects/[code]">, "params" | "searchParams">) {
  const viewer = await requirePermission("projects.view");
  // `?request=CODE` (what /request/CODE leads to) opens that request and scrolls to it; the rest of the page is the project as always.
  const focusParam = (await searchParams).request;
  const focus = typeof focusParam === "string" ? focusParam : null;
  const project = await getProjectByCode(getDb(), viewer, (await params).code);
  if (!project) notFound();
  const picOptions = can(viewer.role, "projects.reassign") ? await listPicOptions(getDb(), viewer) : null;
  // SOA classify the project with a Principal and a Solution picked from their own lists.
  const [principals, solutions] = can(viewer.role, "projects.edit.technical")
    ? await Promise.all([listMasterRecords(getDb(), viewer, "principal"), listMasterRecords(getDb(), viewer, "solution")])
    : [[], []];
  const [requests, details, changes, actions] = await Promise.all([
    listRequests(getDb(), viewer, { projectId: project.id }),
    listProjectRequestDetails(getDb(), viewer, project.id),
    listProjectChanges(getDb(), viewer, project.id),
    listProjectActions(getDb(), viewer, project.id),
  ]);
  const soaPhases = requests.filter((r) => r.type === "BOQ" && r.phase !== null && r.status !== "COMPLETED" && r.status !== "CANCELLED");
  // Sales and admins raise any request; SOA raises a BOQ on a project from another source (Other).
  const raisable = REQUEST_TYPES.filter((type) => canRaiseRequestOn(viewer.role, type, project.sourceType));
  const mayCreate = raisable.length > 0 && project.trackStatus === "ON_TRACK";
  const mayEditSource = can(viewer.role, "projects.edit.source") && project.sourceType === "OTHER";
  const salesPeople = mayEditSource ? await listSalesPeopleOptions(getDb(), viewer) : [];
  // SOA (and admins) edit the technical fields and post updates; commercial fields stay read-only for them.
  const mayEditTechnical = can(viewer.role, "projects.edit.technical");
  const mayPostUpdate = can(viewer.role, "projects.post-update");
  // Sales change their own projects; admins support any project (the service enforces the same rule).
  const mayEditCommercial = can(viewer.role, "projects.edit.commercial") && (viewer.role !== "SALES" || salesActsOn(project, viewer.id));
  const estimated = project.estimatedValue?.toNumber() ?? null;
  const finalValue = project.finalValue?.toNumber() ?? null;
  const marginPercent = project.targetMargin?.toNumber() ?? null;
  const marginValue = project.targetMarginValue?.toNumber() ?? null;
  const targetMargin = targetMarginPercentOf(estimated, finalValue, marginPercent, marginValue);
  const commercialValues = {
    progress: project.progress,
    trackStatus: project.trackStatus,
    quoteReleasedAt: project.quoteReleasedAt ? project.quoteReleasedAt.toISOString().slice(0, 10) : "",
    estimatedValue: estimated === null ? "" : String(estimated),
    targetMargin: marginPercent === null ? "" : String(marginPercent),
    targetMarginValue: marginValue === null ? "" : String(marginValue),
    targetDate: project.targetDate ? project.targetDate.toISOString().slice(0, 10) : "",
    finalValue: finalValue === null ? "" : String(finalValue),
    wonDate: project.wonDate ? project.wonDate.toISOString().slice(0, 10) : "",
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

  return (
    <>
      <DashboardHeader title={`${project.endUserCompany} – ${project.name}`} summary={`Project ${project.code}`} />
      {focus && details.some((r) => r.code === focus) ? <ScrollToRequest code={focus} /> : null}
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
          <Fact label="Industry">{effectiveIndustry(project.customer?.industry, project.industry) ?? "–"}</Fact>
          <Fact label="Location">{project.location ?? "–"}</Fact>
          <Fact label="Principals">{principalNamesOf(project).join(", ") || "–"}</Fact>
          <Fact label="Solution">{project.solutionCategory?.name ?? "–"}</Fact>
          <Fact label="Project source">{SOURCE_LABELS[project.sourceType]}</Fact>
          {project.sourceType === "OTHER" ? (
            <>
              <Fact label={EXTERNAL_SOURCE_LABELS.externalSourceName}>{project.externalSourceName}</Fact>
              <Fact label={EXTERNAL_SOURCE_LABELS.externalContact}>{project.externalContact ?? "–"}</Fact>
              <Fact label={EXTERNAL_SOURCE_LABELS.externalReference}>{project.externalReference ?? "–"}</Fact>
            </>
          ) : null}
          <Fact label="Sales PIC">{project.salesOwner?.name ?? "None (project from another source)"}</Fact>
          <Fact label="Technical PIC (SOA)">{project.technicalPic?.name ?? "–"}</Fact>
          <Fact label="Purchasing PIC">{project.purchasingPic?.name ?? "–"}</Fact>
          <Fact label="Stakeholders">{project.stakeholders ?? "–"}</Fact>
          <Fact label="Estimated PO value">{formatAmount(estimated)}</Fact>
          <Fact label="Probability (from Progress)">{formatPercent(PROGRESS_PERCENT[project.progress])}</Fact>
          <Fact label="Weighted value">{formatAmount(weightedValue(estimated, project.progress))}</Fact>
          <Fact label="Target margin">{formatPercent(targetMargin)}</Fact>
          <Fact label="Estimated gross profit">{formatAmount(targetMarginAmount(estimated, finalValue, marginPercent, marginValue))}</Fact>
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
          {project.sourceNotes ? (
            <>
              <div className="mt-4" />
              <Label>{EXTERNAL_SOURCE_LABELS.sourceNotes}</Label>
              <Prose value={project.sourceNotes} />
            </>
          ) : null}
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
            ? "Progress, status, value, target margin, quote release and target closing. Every change is written to the change log below."
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
            <Fact label="Probability (from Progress)">{formatPercent(PROGRESS_PERCENT[project.progress])}</Fact>
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
          <div className="mb-6 border-b pb-6">
            <h3 className="mb-3 text-sm font-semibold">Classification</h3>
            <ClassificationForm
              projectId={project.id}
              projectCode={project.code}
              principals={principals.map(({ id, name }) => ({ id, name }))}
              solutions={solutions.map(({ id, name }) => ({ id, name }))}
              principalIds={project.principals.length > 0 ? project.principals.map((link) => link.principal.id) : project.principalId ? [project.principalId] : []}
              solutionId={project.solutionCategoryId ?? ""}
              canCreate={can(viewer.role, "masterdata.manage")}
            />
          </div>
        ) : null}
        {mayEditTechnical ? (
          <ProjectFieldsForm
            formKey={`technical-${formKey}`}
            projectId={project.id}
            projectCode={project.code}
            fields={TECHNICAL_FIELDS}
            values={values}
            submitLabel="Save technical details"
            optional
          />
        ) : (
          <>
            {TECHNICAL_FIELDS.some((field) => values[field]) ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                {TECHNICAL_FIELDS.filter((field) => values[field]).map((field) => (
                  <Fact key={field} label={PROJECT_EDITABLE_FIELDS[field].label}>
                    <span className="whitespace-pre-wrap">{values[field]}</span>
                  </Fact>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No technical details recorded yet.</p>
            )}
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

      <Section id="requests" title="Requests" description="The BOQ, RFQ and PO of this project. Open one to see its status, actions, email and history.">
        <div className="flex flex-col gap-4">
          <FlowTracker requests={requests.map((r) => ({ code: r.code, type: r.type, status: r.status, flowStopped: r.flowStopped }))} />
          {mayCreate ? (
            <div className="flex flex-wrap gap-2">
              {raisable.filter((type) => type !== "PO" || requests.some((r) => r.type === "RFQ" && r.status === "COMPLETED")).map((type) => (
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
          {details.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No requests for this project yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {details.map((request) => (
                <li key={request.id} id={`request-${request.code}`} className="scroll-mt-20">
                  {/* Open when it is the only open request (or the only one), so the next thing to do is in view; the rest are one click away. */}
                  <details
                    open={focus !== null && details.some((r) => r.code === focus) ? request.code === focus : details.length === 1 || (isOpen(request.status) && details.filter((r) => isOpen(r.status)).length === 1)}
                    className={request.code === focus ? "rounded-xl ring-2 ring-primary" : "rounded-xl ring-1 ring-foreground/10"}
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm select-none">
                      <span className="font-mono font-medium">{request.code}</span>
                      <TypeBadge type={request.type} />
                      <StatusBadge status={request.status} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{request.title}</span>
                    </summary>
                    <div className="px-4 pb-4">
                      <RequestPanel request={request} viewer={viewer} inProject />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {mayEditSource ? (
        <Section id="source" title="Project source" description="This project comes from another source, so it has no internal Sales PIC. Every change is written to the change log and the audit log.">
          <SourceForm
            projectId={project.id}
            projectCode={project.code}
            values={{
              externalSourceName: project.externalSourceName,
              externalContact: project.externalContact,
              externalReference: project.externalReference,
              sourceNotes: project.sourceNotes,
            }}
            salesPeople={salesPeople}
          />
        </Section>
      ) : null}

      {can(viewer.role, "projects.reassign") && picOptions ? (
        <Section id="owners" title="Owners" description="Superadmin: move the project to other people. Its details, requests and history stay exactly as they are; the move is added to the change log.">
          <ReassignPics
            projectId={project.id}
            projectCode={project.code}
            current={{ salesOwnerId: project.salesOwnerId, technicalPicId: project.technicalPicId, purchasingPicId: project.purchasingPicId }}
            options={picOptions}
          />
        </Section>
      ) : null}

      {can(viewer.role, "projects.delete") ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
          <p className="text-sm text-muted-foreground">Superadmin: remove this project from the dashboards. Its history stays in the audit log.</p>
          <DeleteProject projectId={project.id} projectCode={project.code} />
        </div>
      ) : null}
    </>
  );
}
