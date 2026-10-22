import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { can } from "@/domain/access/permissions";
import { REQUEST_TYPE_LABELS } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { RequestPanel } from "@/features/requests/request-panel";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getRequestByCode } from "@/server/requests/queries";

export default function RequestPage({ params }: PageProps<"/request/[code]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RequestDetail params={params} />
    </Suspense>
  );
}

/**
 * The permanent address of a request (the link in notifications and emails). A request is worked in the context of its project, so this
 * leads to the project page with that request open. Only someone who may read requests but not projects (a permission set by the
 * superadmin) still gets the request on its own page.
 */
async function RequestDetail({ params }: Pick<PageProps<"/request/[code]">, "params">) {
  const viewer = await requirePermission("requests.view");
  const request = await getRequestByCode(getDb(), viewer, (await params).code);
  if (!request) notFound();
  if (can(viewer.role, "projects.view")) redirect(`${PROJECTS_PATH}/${request.project.code}?request=${request.code}#request-${request.code}`);

  return (
    <>
      <DashboardHeader
        title={request.code}
        summary={`${REQUEST_TYPE_LABELS[request.type]} for ${request.project.endUserCompany} – ${request.project.name}`}
      />
      <RequestPanel request={request} viewer={viewer} />
    </>
  );
}
