import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { ProjectForm } from "@/features/requests/forms";
import { requirePermission } from "@/server/auth/current-user";

export default function NewProjectPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewProject />
    </Suspense>
  );
}

async function NewProject() {
  await requirePermission("projects.create");
  return (
    <>
      <DashboardHeader title="New project" summary="A project is the customer or end-user job. Requests to SOA and Purchasing are added to it." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Project details</h2>
          </CardTitle>
          <CardDescription>The Project ID (PRJ-001, PRJ-002 and so on) is assigned when you save. You become the Sales owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm submissionKey={crypto.randomUUID()} />
        </CardContent>
      </Card>
    </>
  );
}
