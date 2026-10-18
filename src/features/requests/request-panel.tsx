import Link from "next/link";
import { salesActsOn } from "@/domain/projects/source";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canContinueFlow, canSeeEmail, canWorkOn } from "@/domain/requests/access";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { formatSlaRange, slaOf } from "@/domain/requests/sla";
import { allowedTransitions, canHandOver, isOpen, nextRequestType, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { OWNING_TEAM_LABELS, SUBJECT_TAGS } from "@/domain/requests/types";
import type { Role } from "@/domain/access/roles";
import { formatUtc } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { buildRequestEmail } from "@/server/requests/email";
import type { RequestDetail } from "@/server/requests/queries";
import { getTeamSetting } from "@/server/settings/team-settings";
import { EmailDialog } from "./email-dialog";
import { Fact } from "./fact";
import { NextStepForm, PhaseForm } from "./forms";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";
import { StatusBadge, TypeBadge } from "./status-badges";

/**
 * Everything about one request: its facts, the actions the viewer may take, the email (in a modal) and the status history
 * (collapsed, at the end). It is the body of the request page and, for each request, of the project page, so a request is
 * handled in the context of its project. `inProject` leaves out the link back to the project.
 */
export async function RequestPanel({ request, viewer, inProject = false }: { request: RequestDetail; viewer: { id: string; role: Role }; inProject?: boolean }) {
  const mayWork = canWorkOn(viewer.role, request.type);
  const next = nextRequestType(request.type);
  const ownsProject = salesActsOn(request.project, viewer.id);
  const decided = request.handovers.length > 0;
  const mayDecide = next !== null && !decided && canHandOver(request.type, request.status) && canContinueFlow(viewer.role, request.type, ownsProject);
  const mayPhase = mayWork && request.type === "BOQ" && isOpen(request.status);
  // The SLA and the email template belong to the team that receives this type of request (SOA for a BOQ, else Purchasing).
  const setting = await getTeamSetting(getDb(), request.type === "BOQ" ? "SOA" : "PURCHASING");
  const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.statusHistory, range: setting.sla, now: new Date() });
  const email = canSeeEmail(viewer.role, request.type, request.source !== null)
    ? buildRequestEmail(request, { subject: setting.emailSubject, body: setting.emailBody, sla: setting.sla, dueAt: sla.dueAt })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Type">
              <TypeBadge type={request.type} />
            </Fact>
            <Fact label="Status">
              <StatusBadge status={request.status} />
            </Fact>
            <Fact label="Owning team">{OWNING_TEAM_LABELS[request.type]}</Fact>
            <Fact label={`SLA (${formatSlaRange(setting.sla)} working days)`}>
              <SlaBadge sla={sla} />
            </Fact>
            {request.type === "BOQ" ? (
              <Fact label="SOA phase">{request.phase ? SOA_PHASE_LABELS[request.phase] : <span className="text-muted-foreground">Not started</span>}</Fact>
            ) : null}
            <Fact label="Assignee">{request.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}</Fact>
            {inProject ? null : (
              <Fact label="Project">
                <Link href={`${PROJECTS_PATH}/${request.project.code}`} className="text-primary underline-offset-4 hover:underline">
                  {request.project.code}
                </Link>
              </Fact>
            )}
            <Fact label="Requested by">{request.requester.name}</Fact>
            <Fact label="Needed by">{formatDateOnly(request.requiredBy)}</Fact>
            <Fact label="Created">{formatUtc(request.createdAt)}</Fact>
            {request.completedAt ? <Fact label="Completed">{formatUtc(request.completedAt)}</Fact> : null}
            {request.source ? (
              <Fact label="Handed over from">
                <Link href={`/request/${request.source.code}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {request.source.code}
                </Link>
              </Fact>
            ) : null}
            {request.handovers.length > 0 ? (
              <Fact label="Handed over to">
                <span className="flex flex-wrap gap-x-3">
                  {request.handovers.map((h) => (
                    <Link key={h.code} href={`/request/${h.code}`} className="font-mono text-primary underline-offset-4 hover:underline">
                      {h.code}
                    </Link>
                  ))}
                </span>
              </Fact>
            ) : null}
          </dl>
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-semibold">{request.title}</h3>
            <p className="mt-1 text-sm whitespace-pre-wrap">{request.description || <span className="text-muted-foreground">No details.</span>}</p>
          </div>
          {email ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              <EmailDialog
                tag={SUBJECT_TAGS[request.type]}
                to={email.recipients.ok ? email.recipients.to : null}
                cc={email.recipients.ok ? email.recipients.cc : []}
                recipientsError={email.recipients.ok ? null : email.recipients.error}
                subject={email.subject}
                body={email.body}
                linkConfigured={email.linkConfigured}
                hint={
                  request.source
                    ? `Reply inside the original ${SUBJECT_TAGS.BOQ} email thread for ${request.source.code} so the conversation stays together, and use this subject and text.`
                    : undefined
                }
              />
              <span className="text-xs text-muted-foreground">Opens the subject, recipients and text to send.</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {mayWork && allowedTransitions(request.status, request.type).length > 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Status is {REQUEST_STATUS_LABELS[request.status]}. It is changed by dragging this request&apos;s card on the{" "}
          <Link href={`/requests/${request.type.toLowerCase()}?view=board`} className="underline underline-offset-4">
            {request.type} board
          </Link>
          . Questions to Sales and revision details go by email, which keeps the history.
        </p>
      ) : null}

      {mayPhase ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>SOA phase</h3>
            </CardTitle>
            <CardDescription>Label the part of the work you are on: Assessment, Sizing or POC. Sales and Purchasing are notified.</CardDescription>
          </CardHeader>
          <CardContent>
            <PhaseForm requestId={request.id} current={request.phase} />
          </CardContent>
        </Card>
      ) : null}

      {mayDecide && next ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>What happens next?</h3>
            </CardTitle>
            <CardDescription>
              The flow is BOQ, then RFQ, then PO. Decide whether this {request.type} continues to {next === "RFQ" ? "an RFQ (quotation / pricing)" : "a PO (purchase)"}. The new request keeps the
              project and points back to this one. Completing a {request.type} does not authorise anything by itself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {request.flowStoppedAt ? (
              <p className="mb-3 text-sm">
                <span className="font-medium">Not continuing</span> – decided by {request.flowStoppedBy?.name ?? "someone"} on {formatUtc(request.flowStoppedAt)}
                {request.flowStoppedNote ? `: ${request.flowStoppedNote}` : "."}
              </p>
            ) : null}
            <NextStepForm sourceId={request.id} nextType={next} hasDecision={request.flowStoppedAt !== null} />
          </CardContent>
        </Card>
      ) : request.flowStoppedAt ? (
        <p className="text-sm text-muted-foreground">
          Not continuing to {next ?? "the next step"} – decided by {request.flowStoppedBy?.name ?? "someone"} on {formatUtc(request.flowStoppedAt)}
          {request.flowStoppedNote ? `: ${request.flowStoppedNote}` : "."}
        </p>
      ) : null}

      <details className="group rounded-xl ring-1 ring-foreground/10">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold select-none marker:content-none">
          Status history <span className="font-normal text-muted-foreground">({request.statusHistory.length}) – append-only, times are UTC</span>
        </summary>
        <div className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.statusHistory.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatUtc(row.changedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.fromStatus ? `${REQUEST_STATUS_LABELS[row.fromStatus]} → ` : "Created as "}
                    {REQUEST_STATUS_LABELS[row.toStatus]}
                  </TableCell>
                  <TableCell>{row.changedBy.name}</TableCell>
                  <TableCell>{row.reason ?? "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}
