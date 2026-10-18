import Link from "next/link";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import type { RequestRow } from "@/server/requests/queries";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";

/** The columns of the board, in the order work moves through them. Cancelled requests are not shown on it. */
const COLUMNS: readonly RequestStatus[] = ["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "COMPLETED"];

/**
 * A board of the same requests as the list, one column per status. It is a view only: a card opens the request, where its
 * status is changed with the reason the status history keeps. Nothing here moves a request on its own.
 */
export function RequestBoard({ rows }: { rows: RequestRow[] }) {
  const shown = rows.filter((row) => row.status !== "CANCELLED");
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Request board">
      {COLUMNS.map((status) => {
        const cards = shown.filter((row) => row.status === status);
        return (
          <section key={status} aria-label={`${REQUEST_STATUS_LABELS[status]}, ${cards.length} request${cards.length === 1 ? "" : "s"}`} className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
            <h2 className="flex items-center justify-between px-1 pt-1 text-sm font-semibold">
              {REQUEST_STATUS_LABELS[status]}
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{cards.length}</span>
            </h2>
            {cards.length === 0 ? (
              <p className="px-1 pb-2 text-xs text-muted-foreground">None.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cards.map((card) => (
                  <li key={card.id} className="rounded-lg border bg-card p-3 text-sm shadow-xs">
                    <Link href={`/request/${card.code}`} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
                      {card.code}
                    </Link>
                    <p className="mt-1 line-clamp-2 font-medium">{card.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {card.endUserCompany} – {card.projectName}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <SlaBadge sla={card.sla} />
                      <span className="text-xs text-muted-foreground">{card.assigneeName ?? "Unassigned"}</span>
                    </div>
                    {card.phase || card.requiredBy ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {card.phase ? SOA_PHASE_LABELS[card.phase] : null}
                        {card.phase && card.requiredBy ? " · " : null}
                        {card.requiredBy ? `needed by ${formatDateOnly(card.requiredBy)}` : null}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
