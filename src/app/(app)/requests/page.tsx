import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { REQUESTS_PATH } from "@/features/navigation/links";
import { listParamsFrom, RequestList } from "@/features/requests/request-list";
import { requirePermission } from "@/server/auth/current-user";

export default function RequestsPage({ searchParams }: PageProps<"/requests">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/requests">, "searchParams">) {
  const viewer = await requirePermission("requests.view");
  return <RequestList viewer={viewer} basePath={REQUESTS_PATH} params={listParamsFrom(await searchParams)} title={viewer.role === "SALES" ? "Request center" : undefined} />;
}
