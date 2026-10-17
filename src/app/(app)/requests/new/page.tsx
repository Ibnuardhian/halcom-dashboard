import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REQUEST_TYPES, isRequestType } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { RequestForm } from "@/features/requests/forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listActiveProjectOptions } from "@/server/requests/queries";

export default function NewRequestPage({ searchParams }: PageProps<"/requests/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRequest({ searchParams }: Pick<PageProps<"/requests/new">, "searchParams">) {
  const viewer = await requirePermission("requests.create");
  const query = await searchParams;
  const projects = await listActiveProjectOptions(getDb(), viewer);
  const wantedProject = typeof query.project === "string" ? projects.find((p) => p.code === query.project) : undefined;
  const wantedType = typeof query.type === "string" ? query.type.toUpperCase() : "";

  return (
    <>
      <DashboardHeader
        title="New request"
        summary="Ask SOA for a BOQ, or ask Purchasing for an RFQ (quotation / pricing) or a PO (purchase). Every request belongs to a project."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Request details</h2>
          </CardTitle>
          <CardDescription>
            After saving you get the email text (To, Cc, subject and body) to copy into Outlook.{" "}
            {projects.length === 0 ? (
              <>
                There is no active project yet:{" "}
                <Link href={`${PROJECTS_PATH}/new`} className="underline underline-offset-4">
                  create a project first
                </Link>
                .
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm
            projects={projects}
            defaultProjectId={wantedProject?.id ?? ""}
            defaultType={isRequestType(wantedType) ? wantedType : "BOQ"}
            types={REQUEST_TYPES}
            submissionKey={crypto.randomUUID()}
          />
        </CardContent>
      </Card>
    </>
  );
}
