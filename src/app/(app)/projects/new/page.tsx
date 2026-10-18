import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { notFound } from "next/navigation";
import { can } from "@/domain/access/permissions";
import { canCreateProjectWithSource, canRaiseWithNewProject, PROJECT_SOURCE_TYPES } from "@/domain/projects/source";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/lib/db";
import { listSalesPeopleOptions } from "@/server/requests/queries";
import { isRequestType, type RequestType } from "@/domain/requests/types";
import { ProjectForm, type ProjectFormScope } from "@/features/requests/forms";

export default function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewProject searchParams={searchParams} />
    </Suspense>
  );
}

async function NewProject({ searchParams }: Pick<PageProps<"/projects/new">, "searchParams">) {
  const viewer = await requireUser();
  // Sales register their own Internal Sales projects; SOA register a project for a salesperson they pick (Internal Sales) or from another source (Other); admins both.
  const sources = PROJECT_SOURCE_TYPES.filter((source) => canCreateProjectWithSource(viewer.role, source));
  if (sources.length === 0) notFound();
  const raisable = (source: (typeof PROJECT_SOURCE_TYPES)[number]) => (["BOQ", "RFQ"] as const).filter((type) => canRaiseWithNewProject(viewer.role, type, source));
  const scope: ProjectFormScope = {
    sources,
    commercial: can(viewer.role, "projects.edit.commercial"),
    requestTypes: { INTERNAL_SALES: raisable("INTERNAL_SALES"), OTHER: raisable("OTHER") },
    salesPicName: viewer.name,
    salesPeople: can(viewer.role, "projects.assign-sales") ? await listSalesPeopleOptions(getDb(), viewer) : undefined,
    salesPicRequired: viewer.role === "SOA",
  };
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
          <CardDescription>The Project ID (PRJ-001, PRJ-002 and so on) is assigned when you save. {sources.includes("INTERNAL_SALES") ? "An Internal Sales project makes you its Sales owner. " : ""}{sources.includes("OTHER") ? "A project from another source (Other) has no internal Sales PIC." : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm submissionKey={crypto.randomUUID()} defaultType={defaultType} scope={scope} />
        </CardContent>
      </Card>
    </>
  );
}
