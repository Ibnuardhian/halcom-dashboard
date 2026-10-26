import Link from "next/link";
import { can } from "@/domain/access/permissions";
import { salesActsOn } from "@/domain/projects/source";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canContinueFlow, canSeeEmail, canWorkOn } from "@/domain/requests/access";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { formatSlaRange, slaOf } from "@/domain/requests/sla";
import { allowedTransitions, canHandOver, isOpen, nextRequestType, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { OWNING_TEAM_LABELS, SUBJECT_TAGS } from "@/domain/requests/types";
import type { Role } from "@/domain/access/roles";
import { formatDay } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { buildRequestEmail } from "@/server/requests/email";
import type { RequestDetail } from "@/server/requests/queries";
import { getTeamSetting } from "@/server/settings/team-settings";
import { listAssignablePics, listPicAssignments } from "@/server/pics/service";
import { picTeamOf, PIC_TEAM_LABELS } from "@/domain/pics/teams";
import { EmailDialog } from "./email-dialog";
import { Fact } from "./fact";
import { jakartaDay } from "@/domain/requests/metrics";
import { AssignPicForm, NextStepForm, PhaseForm, RequestDatesForm, RevisionForm } from "./forms";
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
  // The latest time this BOQ was sent back (by Sales from the request page, or by SOA on the board), with the reason that was given.
  const revisionEntry = [...request.statusHistory].reverse().find((row) => row.toStatus === "REVISION") ?? null;
  const mayPhase = mayWork && request.type === "BOQ" && isOpen(request.status);
  // Sales (on a project they act on) and admins can send a completed BOQ back to SOA; it goes straight to the Revision stage.
  const mayRevise = can(viewer.role, "requests.revise") && request.type === "BOQ" && request.status === "COMPLETED" && (viewer.role !== "SALES" || ownsProject);
  // The SLA and the email template belong to the team that receives this type of request (SOA for a BOQ, else Purchasing).
  const setting = await getTeamSetting(getDb(), request.type === "BOQ" ? "SOA" : "PURCHASING");
  // PICs are the people tickets are handed to; the shared SOA / Purchasing account only records who clicked.
  const [pics, assignments] = await Promise.all([mayWork ? listAssignablePics(getDb(), viewer, request.type) : [], listPicAssignments(getDb(), viewer, request.id)]);
  // Only a superadmin corrects the requester, from the active accounts (the one now on the request is kept in the list even if it was deactivated).
  const people = can(viewer.role, "requests.edit-dates")
    ? await getDb().user.findMany({ where: { OR: [{ isActive: true }, { id: request.requesterId }] }, select: { id: true, name: true, codePrefix: true }, orderBy: { name: "asc" } })
    : [];
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
            <Fact label="PIC">
              {request.pic ? (
                <>
                  {request.pic.name}
                  {request.pic.isActive ? null : <span className="text-muted-foreground"> (inactive)</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </Fact>
            {inProject ? null : (
              <Fact label="Project">
                <Link href={`${PROJECTS_PATH}/${request.project.code}`} className="text-primary underline-offset-4 hover:underline">
                  {request.project.code}
                </Link>
              </Fact>
            )}
            <Fact label="Requested by">{request.raisedByPic ? `${request.raisedByPic.name} (SOA PIC, through the shared SOA login)` : request.requester.name}</Fact>
            <Fact label="Needed by">{formatDateOnly(request.requiredBy)}</Fact>
            <Fact label="Created">{formatDay(request.createdAt)}</Fact>
            {request.completedAt ? <Fact label="Completed">{formatDay(request.completedAt)}</Fact> : null}
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
            <p className="mt-1 text-sm whitespace-pre-wrap">{request.description || <span className="text-muted-foreground">Tidak ada detail.</span>}</p>
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
                    ? `Balas di dalam thread email ${SUBJECT_TAGS.BOQ} asli untuk ${request.source.code} agar percakapan tetap satu alur, dan gunakan subject serta teks ini.`
                    : undefined
                }
              />
              <span className="text-xs text-muted-foreground">Membuka subject, penerima, dan teks untuk dikirim.</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {mayWork && allowedTransitions(request.status, request.type).length > 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Status saat ini {REQUEST_STATUS_LABELS[request.status]}. Diubah dengan menyeret kartu request ini di{" "}
          <Link href={`/requests/${request.type.toLowerCase()}?view=board`} className="underline underline-offset-4">
            {request.type} board
          </Link>
          . Pertanyaan ke Sales dan detail revisi disampaikan lewat email, agar riwayatnya tetap tercatat.
        </p>
      ) : null}

      {mayWork ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>PIC</h3>
            </CardTitle>
            <CardDescription>
              Who in {PIC_TEAM_LABELS[picTeamOf(request.type)]} is working on this request. PICs are not login accounts; the change is kept in the assignment history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignPicForm requestId={request.id} current={request.picId ?? ""} pics={pics} teamLabel={PIC_TEAM_LABELS[picTeamOf(request.type)]} />
          </CardContent>
        </Card>
      ) : null}

      {request.status === "REVISION" ? (
        <div role="status" data-testid="revision-banner" className="rounded-xl border border-destructive bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">In revision</p>
          <p>
            {revisionEntry
              ? `Sent back on ${formatDay(revisionEntry.changedAt)} by ${revisionEntry.changedBy.name}${revisionEntry.reason ? `: ${revisionEntry.reason}` : "."}`
              : "This BOQ was sent back for changes."}
          </p>
        </div>
      ) : null}

      {mayRevise ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Request a revision</h3>
            </CardTitle>
            <CardDescription>The customer wants changes to this completed BOQ. Describe them: the ticket moves straight to Revision and SOA is told.</CardDescription>
          </CardHeader>
          <CardContent>
            <RevisionForm requestId={request.id} />
          </CardContent>
        </Card>
      ) : null}

      {can(viewer.role, "requests.edit-dates") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Correct the dates</h3>
            </CardTitle>
            <CardDescription>Atur tanggal (tanpa jam) request ini dibuat dan selesai, serta siapa pemohonnya (Requested by), untuk tiket yang diinput terlambat atau salah catat. The status history is not rewritten; the change is audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestDatesForm
              requestId={request.id}
              createdAt={jakartaDay(request.createdAt)}
              completedAt={request.completedAt ? jakartaDay(request.completedAt) : null}
              canComplete={request.status === "COMPLETED" || request.status === "REVISION"}
              requesterId={request.requesterId}
              code={request.code}
              people={people}
            />
          </CardContent>
        </Card>
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
                <span className="font-medium">Not continuing</span> – decided by {request.flowStoppedBy?.name ?? "someone"} on {formatDay(request.flowStoppedAt)}
                {request.flowStoppedNote ? `: ${request.flowStoppedNote}` : "."}
              </p>
            ) : null}
            <NextStepForm sourceId={request.id} nextType={next} hasDecision={request.flowStoppedAt !== null} />
          </CardContent>
        </Card>
      ) : request.flowStoppedAt ? (
        <p className="text-sm text-muted-foreground">
          Not continuing to {next ?? "the next step"} – decided by {request.flowStoppedBy?.name ?? "someone"} on {formatDay(request.flowStoppedAt)}
          {request.flowStoppedNote ? `: ${request.flowStoppedNote}` : "."}
        </p>
      ) : null}

      {assignments.length > 0 ? (
        <details className="group rounded-xl ring-1 ring-foreground/10">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold select-none marker:content-none">
            PIC history <span className="font-normal text-muted-foreground">({assignments.length}) – append-only</span>
          </summary>
          <div className="px-4 pb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDay(row.changedAt)}</TableCell>
                    <TableCell>
                      {row.fromName ?? "Unassigned"} → {row.toName ?? "Unassigned"}
                    </TableCell>
                    <TableCell>{row.changedByName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ) : null}

      <details className="group rounded-xl ring-1 ring-foreground/10">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold select-none marker:content-none">
          Status history <span className="font-normal text-muted-foreground">({request.statusHistory.length}) – append-only</span>
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
                  <TableCell className="whitespace-nowrap">{formatDay(row.changedAt)}</TableCell>
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
