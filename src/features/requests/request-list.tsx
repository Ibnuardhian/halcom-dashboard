import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/domain/access/permissions";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import { REQUEST_TYPE_LABELS, type RequestType } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { NEW_REQUEST_PATH } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listRequests } from "@/server/requests/queries";
import { RequestTable } from "./request-table";

type StatusFilter = { kind: "all" } | { kind: "open" } | { kind: "status"; status: RequestStatus };

function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === "open") return { kind: "open" };
  const status = REQUEST_STATUSES.find((s) => s === raw);
  return status ? { kind: "status", status } : { kind: "all" };
}

/** A request list with status filter chips. `type` narrows it to BOQ, RFQ or PO; without it every type is listed. */
export async function RequestList({
  viewer,
  basePath,
  type,
  statusParam,
}: {
  viewer: SessionUser;
  basePath: string;
  type?: RequestType;
  statusParam?: string;
}) {
  const filter = parseStatusFilter(statusParam);
  const rows = await listRequests(getDb(), viewer, {
    type,
    status: filter.kind === "status" ? filter.status : undefined,
    openOnly: filter.kind === "open",
  });
  const chips: { label: string; value: string | null; active: boolean }[] = [
    { label: "All", value: null, active: filter.kind === "all" },
    { label: "Open", value: "open", active: filter.kind === "open" },
    ...REQUEST_STATUSES.map((status) => ({
      label: REQUEST_STATUS_LABELS[status],
      value: status,
      active: filter.kind === "status" && filter.status === status,
    })),
  ];

  return (
    <>
      <DashboardHeader
        title={type ? `${type} requests` : "All requests"}
        summary={
          type
            ? `${REQUEST_TYPE_LABELS[type]}s, newest first.`
            : "BOQ, RFQ and PO requests across all projects, newest first."
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.value ? `${basePath}?status=${chip.value}` : basePath}
              aria-current={chip.active ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted",
                chip.active && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {chip.label}
            </Link>
          ))}
        </nav>
        {can(viewer.role, "requests.create") ? (
          <Link href={type ? `${NEW_REQUEST_PATH}?type=${type}` : NEW_REQUEST_PATH} className={buttonVariants()}>
            New request
          </Link>
        ) : null}
      </div>
      <RequestTable rows={rows} emptyText={filter.kind === "all" ? "No requests yet." : "No requests match this filter."} />
    </>
  );
}
