import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/domain/access/permissions";
import { SLA_STATE_LABELS, type SlaState } from "@/domain/requests/sla";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import { REQUEST_TYPE_LABELS, type RequestType } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { NEW_REQUEST_PATH } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listRequests } from "@/server/requests/queries";
import { RequestBoard } from "./request-board";
import { RequestTable } from "./request-table";

type StatusFilter = { kind: "all" } | { kind: "open" } | { kind: "status"; status: RequestStatus };

function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === "open") return { kind: "open" };
  const status = REQUEST_STATUSES.find((s) => s === raw);
  return status ? { kind: "status", status } : { kind: "all" };
}

/** The SLA states a dashboard number can link to. */
const SLA_FILTERS = ["overdue", "due_soon"] as const satisfies readonly SlaState[];
const DEADLINE_FILTERS = ["past", "soon"] as const;
const DEADLINE_LABELS = { past: "Needed-by date has passed", soon: "Needed within the next 7 days" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestListQuery = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * A request list with status filter chips. `type` narrows it to BOQ, RFQ or PO; without it every type is listed. The dashboards
 * link here with more filters in the query (`assignee`, `sla`, `deadline`, `mine`), so every number can be traced to its rows;
 * `view=board` shows the same rows as a board. Unknown values in the query are ignored.
 */
export async function RequestList({
  viewer,
  basePath,
  type,
  query,
  title,
}: {
  viewer: SessionUser;
  basePath: string;
  type?: RequestType;
  query: RequestListQuery;
  /** Overrides the page title (for example "BOQ Tickets"). */
  title?: string;
}) {
  const filter = parseStatusFilter(one(query.status));
  const assignee = one(query.assignee) === "none" ? "none" : UUID.test(one(query.assignee) ?? "") ? one(query.assignee) : undefined;
  const slaState = SLA_FILTERS.find((state) => state === one(query.sla));
  const deadline = DEADLINE_FILTERS.find((state) => state === one(query.deadline));
  // "mine" narrows to the requests on the projects the signed-in person owns; it can never widen what they may see.
  const mine = one(query.mine) === "1";
  const board = one(query.view) === "board";

  const rows = await listRequests(getDb(), viewer, {
    type,
    status: filter.kind === "status" ? filter.status : undefined,
    openOnly: filter.kind === "open" || Boolean(slaState || deadline),
    assignee,
    slaState,
    deadline,
    projectOwnerId: mine ? viewer.id : undefined,
  });

  // The extra filters travel with every chip and the view switch, so changing one thing does not drop the others.
  const carried = new URLSearchParams();
  if (assignee) carried.set("assignee", assignee);
  if (slaState) carried.set("sla", slaState);
  if (deadline) carried.set("deadline", deadline);
  if (mine) carried.set("mine", "1");
  const href = (extra: Record<string, string | null>) => {
    const params = new URLSearchParams(carried);
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const text = params.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const statusHref = (value: string | null) => href({ status: value, view: board ? "board" : null });

  const chips: { label: string; value: string | null; active: boolean }[] = [
    { label: "All", value: null, active: filter.kind === "all" },
    { label: "Open", value: "open", active: filter.kind === "open" },
    ...REQUEST_STATUSES.map((status) => ({
      label: REQUEST_STATUS_LABELS[status],
      value: status,
      active: filter.kind === "status" && filter.status === status,
    })),
  ];
  const extraFilters = [
    assignee ? (assignee === "none" ? "Unassigned" : "One assignee") : null,
    slaState ? `SLA: ${SLA_STATE_LABELS[slaState]}` : null,
    deadline ? DEADLINE_LABELS[deadline] : null,
    mine ? "On your projects" : null,
  ].filter((text): text is string => text !== null);

  return (
    <>
      <DashboardHeader
        title={title ?? (type ? `${type} requests` : "All requests")}
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
              href={statusHref(chip.value)}
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
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="View" className="inline-flex rounded-lg border p-0.5">
            {([false, true] as const).map((isBoard) => (
              <Link
                key={isBoard ? "board" : "list"}
                href={href({ status: filter.kind === "all" ? null : filter.kind === "open" ? "open" : filter.status, view: isBoard ? "board" : null })}
                aria-current={board === isBoard ? "page" : undefined}
                className={cn("rounded-md px-3 py-1 text-xs font-medium", board === isBoard ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {isBoard ? "Board" : "List"}
              </Link>
            ))}
          </nav>
          {can(viewer.role, "requests.create") || can(viewer.role, "requests.create.external") ? (
            <Link href={type ? `${NEW_REQUEST_PATH}?type=${type}` : NEW_REQUEST_PATH} className={buttonVariants()}>
              New request
            </Link>
          ) : null}
        </div>
      </div>
      {extraFilters.length > 0 ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Filtered: {extraFilters.join(", ")}.{" "}
          <Link href={basePath} className="underline underline-offset-4">
            Clear filters
          </Link>
        </p>
      ) : null}
      {board ? (
        <RequestBoard rows={rows} />
      ) : (
        <RequestTable rows={rows} emptyText={filter.kind === "all" && extraFilters.length === 0 ? "No requests yet." : "No requests match this filter."} />
      )}
    </>
  );
}
