import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { ProjectForm } from "@/features/requests/forms";
import { requirePermission } from "@/server/auth/current-user";
import { isRequestType, type RequestType } from "@/domain/requests/types";

export default function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewProject searchParams={searchParams} />
    </Suspense>
  );
}

async function NewProject({ searchParams }: Pick<PageProps<"/projects/new">, "searchParams">) {
  await requirePermission("projects.create");
  const wanted = (await searchParams).type;
  const defaultType = typeof wanted === "string" && isRequestType(wanted.toUpperCase()) ? (wanted.toUpperCase() as RequestType) : "";
  return (
    <>
      <DashboardHeader title="New project" summary="Fill in the project and, in the same form, choose whether it needs a BOQ, RFQ or PO request." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Project details</h2>
          </CardTitle>
          <CardDescription>The Project ID (PRJ-001, PRJ-002 and so on) is assigned when you save. You become the Sales owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm submissionKey={crypto.randomUUID()} defaultType={defaultType} />
        </CardContent>
      </Card>
    </>
  );
}
