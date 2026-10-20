import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { typeFromSlug } from "@/domain/requests/types";
import { REQUESTS_PATH } from "@/features/navigation/links";
import { listParamsFrom, RequestList } from "@/features/requests/request-list";
import { requirePermission } from "@/server/auth/current-user";

export default function RequestsByTypePage({ params, searchParams }: PageProps<"/requests/[type]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RequestsByType params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RequestsByType({ params, searchParams }: Pick<PageProps<"/requests/[type]">, "params" | "searchParams">) {
  const type = typeFromSlug((await params).type);
  if (!type) notFound();
  const viewer = await requirePermission("requests.view");
  return <RequestList viewer={viewer} basePath={`${REQUESTS_PATH}/${type.toLowerCase()}`} type={type} params={listParamsFrom(await searchParams)} title={viewer.role === "SOA" && type === "BOQ" ? "BOQ Tickets" : undefined} />;
}
