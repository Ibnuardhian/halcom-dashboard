import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { REQUEST_TYPE_LABELS } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
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

/** A request on its own page (the link in notifications and emails). The same panel is shown, with its siblings, on the project page. */
async function RequestDetail({ params }: Pick<PageProps<"/request/[code]">, "params">) {
  const viewer = await requirePermission("requests.view");
  const request = await getRequestByCode(getDb(), viewer, (await params).code);
  if (!request) notFound();

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
