import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/domain/access/permissions";
import { canSeeEmail, canWorkOn } from "@/domain/requests/access";
import { allowedTransitions, canHandOver, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { OWNING_TEAM_LABELS, REQUEST_TYPE_LABELS, SUBJECT_TAGS } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { EmailPanel } from "@/features/requests/email-panel";
import { Fact } from "@/features/requests/fact";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { HandoverForm, PhaseForm, StatusForm } from "@/features/requests/forms";
import { formatDateOnly } from "@/features/requests/format";
import { StatusBadge, TypeBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { buildRequestEmail } from "@/server/requests/email";
import { getRequestByCode } from "@/server/requests/queries";

export default function RequestPage({ params }: PageProps<"/request/[code]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RequestDetail params={params} />
    </Suspense>
  );
}

async function RequestDetail({ params }: Pick<PageProps<"/request/[code]">, "params">) {
  const viewer = await requirePermission("requests.view");
  const request = await getRequestByCode(getDb(), viewer, (await params).code);
  if (!request) notFound();

  const mayWork = canWorkOn(viewer.role, request.type);
  const transitions = allowedTransitions(request.status);
  const mayHandOver = can(viewer.role, "requests.handover") && canHandOver(request.type, request.status);
  const email = canSeeEmail(viewer.role, request.type, request.source !== null) ? buildRequestEmail(request) : null;

  return (
    <>
      <DashboardHeader
        title={request.code}
        summary={`${REQUEST_TYPE_LABELS[request.type]} for ${request.project.endUserCompany} – ${request.project.name}`}
      />

      <Card className="mb-6">
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Type">
              <TypeBadge type={request.type} />
            </Fact>
            <Fact label="Status">
              <StatusBadge status={request.status} />
            </Fact>
            <Fact label="Owning team">{OWNING_TEAM_LABELS[request.type]}</Fact>
            {request.type === "BOQ" ? (
              <Fact label="SOA phase">{request.phase ? SOA_PHASE_LABELS[request.phase] : <span className="text-muted-foreground">Not started</span>}</Fact>
            ) : null}
            <Fact label="Assignee">{request.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}</Fact>
            <Fact label="Project">
              <Link href={`${PROJECTS_PATH}/${request.project.code}`} className="text-primary underline-offset-4 hover:underline">
                {request.project.code}
              </Link>
            </Fact>
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
            <h2 className="text-sm font-semibold">{request.title}</h2>
            <p className="mt-1 text-sm whitespace-pre-wrap">{request.description || <span className="text-muted-foreground">No details.</span>}</p>
          </div>
        </CardContent>
      </Card>

      {mayWork && transitions.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Update status</h2>
            </CardTitle>
            <CardDescription>
              Currently {REQUEST_STATUS_LABELS[request.status]}. Every change is recorded with who made it and when.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusForm requestId={request.id} from={request.status} options={transitions} />
          </CardContent>
        </Card>
      ) : null}

      {mayWork && request.type === "BOQ" && request.status !== "COMPLETED" && request.status !== "CANCELLED" ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>SOA phase</h2>
            </CardTitle>
            <CardDescription>Label the part of the work you are on: Assessment, Sizing or POC. Sales and Purchasing are notified.</CardDescription>
          </CardHeader>
          <CardContent>
            <PhaseForm requestId={request.id} current={request.phase} />
          </CardContent>
        </Card>
      ) : null}

      {mayHandOver ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Hand over to Purchasing</h2>
            </CardTitle>
            <CardDescription>
              Choose what Purchasing should do. A completed BOQ does not authorise a purchase by itself. The new request keeps the project and
              points back to this BOQ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HandoverForm sourceId={request.id} />
          </CardContent>
        </Card>
      ) : null}

      {email ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Email text ({SUBJECT_TAGS[request.type]})</h2>
            </CardTitle>
            <CardDescription>Subject, recipients and default text for this request.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailPanel
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
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Status history</h2>
          </CardTitle>
          <CardDescription>Append-only. Times are UTC.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </>
  );
}
