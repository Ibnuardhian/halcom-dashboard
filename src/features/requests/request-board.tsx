"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { allowedTransitions, boardColumns, columnOf, reasonRequired, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";
import { cn } from "@/lib/utils";
import type { RequestRow } from "@/server/requests/queries";
import { moveRequestAction } from "./actions";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";

type Pending = { card: RequestRow; to: RequestStatus };

const GRID: Record<number, string> = { 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" };

/**
 * The board: one column per status, and the place where SOA and Purchasing change a status, by dragging a card to another column.
 * Only the moves the flow allows light up as drop targets (a BOQ gets a Revision column after Completed; an RFQ or PO does not). A
 * cancellation, or reopening a completed RFQ or PO, asks for a reason first. People who may not work on a request's type see its card
 * but cannot drag it. The server checks every move again. With the keyboard: focus a card and press Shift + Arrow Left or Right.
 */
export function RequestBoard({ rows, type, movable }: { rows: RequestRow[]; type: RequestType | null; movable: Readonly<Record<RequestType, boolean>> }) {
  const router = useRouter();
  const [cards, setCards] = useState(rows);
  const [dragging, setDragging] = useState<RequestRow | null>(null);
  const [over, setOver] = useState<RequestStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const columns = boardColumns(type);

  const accepts = (card: RequestRow | null, to: RequestStatus) => card !== null && movable[card.type] && allowedTransitions(card.status, card.type).includes(to);

  function move(card: RequestRow, to: RequestStatus, why?: string) {
    const before = card.status;
    setCards((current) => current.map((row) => (row.id === card.id ? { ...row, status: to } : row)));
    setMessage(null);
    startTransition(async () => {
      const result = await moveRequestAction(card.id, to, why);
      if (!result.ok) {
        setCards((current) => current.map((row) => (row.id === card.id ? { ...row, status: before } : row)));
        setMessage({ ok: false, text: result.message });
        return;
      }
      setMessage({ ok: true, text: `${card.code} is now ${REQUEST_STATUS_LABELS[to]}.` });
      router.refresh();
    });
  }

  function drop(card: RequestRow | null, to: RequestStatus) {
    setOver(null);
    setDragging(null);
    if (!card || !accepts(card, to)) return;
    if (reasonRequired(card.status, to)) {
      setReason("");
      setPending({ card, to });
      dialog.current?.showModal();
      return;
    }
    move(card, to);
  }

  function confirm() {
    if (!pending || reason.trim() === "") return;
    const { card, to } = pending;
    setPending(null);
    dialog.current?.close();
    move(card, to, reason.trim());
  }

  function cancelDialog() {
    setPending(null);
    dialog.current?.close();
  }

  /** Shift + Arrow: the same move as a drag, to the neighbouring column that accepts the card. */
  function keyboardMove(card: RequestRow, step: 1 | -1) {
    const from = columns.indexOf(columnOf(card.status));
    for (let index = from + step; index >= 0 && index < columns.length; index += step) {
      if (accepts(card, columns[index]!)) {
        drop(card, columns[index]!);
        return;
      }
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Drag a card to another column to change its status. Revision details and questions to Sales go by email.</p>
      <div role="status" aria-live="polite" className={cn("mb-2 min-h-5 text-sm", message?.ok === false ? "text-destructive" : "text-muted-foreground")}>
        {message?.text}
      </div>
      <div className={cn("grid gap-3 md:grid-cols-2", GRID[columns.length])} role="group" aria-label="Request board">
        {columns.map((status) => {
          const inColumn = cards.filter((row) => columnOf(row.status) === status);
          const droppable = accepts(dragging, status);
          return (
            <section
              key={status}
              aria-label={`${REQUEST_STATUS_LABELS[status]}, ${inColumn.length} request${inColumn.length === 1 ? "" : "s"}`}
              data-column={status}
              className={cn("flex min-h-32 min-w-0 flex-col gap-2 rounded-xl bg-muted/40 p-2 transition-colors", droppable && "ring-2 ring-primary/40", over === status && droppable && "bg-primary/10")}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOver(status);
              }}
              onDragLeave={() => setOver((current) => (current === status ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                drop(dragging, status);
              }}
            >
              <h2 className="flex items-center justify-between px-1 pt-1 text-sm font-semibold">
                {REQUEST_STATUS_LABELS[status]}
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{inColumn.length}</span>
              </h2>
              {inColumn.length === 0 ? (
                <p className="px-1 pb-2 text-xs text-muted-foreground">None.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {inColumn.map((card) => {
                    const mayMove = movable[card.type] && allowedTransitions(card.status, card.type).length > 0;
                    return (
                      <li
                        key={card.id}
                        data-request={card.code}
                        draggable={mayMove}
                        tabIndex={mayMove ? 0 : undefined}
                        aria-label={mayMove ? `${card.code}, ${REQUEST_STATUS_LABELS[card.status]}. Shift and arrow keys move it.` : undefined}
                        className={cn("rounded-lg border bg-card p-3 text-sm shadow-xs", mayMove && "cursor-grab active:cursor-grabbing", dragging?.id === card.id && "opacity-50")}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", card.id);
                          setDragging(card);
                          setMessage(null);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onKeyDown={(event) => {
                          if (!mayMove || !event.shiftKey || event.target !== event.currentTarget) return;
                          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                            event.preventDefault();
                            keyboardMove(card, event.key === "ArrowRight" ? 1 : -1);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/request/${card.code}`} draggable={false} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
                            {card.code}
                          </Link>
                          {card.status === "WAITING_FOR_SALES" ? <span className="text-[11px] text-muted-foreground">was waiting for Sales</span> : null}
                        </div>
                        <p className={cn("mt-1 line-clamp-2 font-medium", card.status === "CANCELLED" && "text-muted-foreground line-through")}>{card.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {card.endUserCompany} – {card.projectName}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <SlaBadge sla={card.sla} />
                          <span className="text-xs text-muted-foreground">{card.assigneeName ?? "Unassigned"}</span>
                        </div>
                        {card.requiredBy ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {`needed by ${formatDateOnly(card.requiredBy)}`}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="board-reason-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => setPending(null)}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div>
            <h2 id="board-reason-title" className="text-base font-semibold">
              {pending?.to === "CANCELLED" ? "Cancel" : "Reopen"} {pending?.card.code}?
            </h2>
            <p className="text-sm text-muted-foreground">Say why. It is kept in the status history.</p>
          </div>
          <Textarea aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required className="min-h-24" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelDialog}>
              Keep it as it is
            </Button>
            <Button type="submit" variant={pending?.to === "CANCELLED" ? "destructive" : "default"} disabled={reason.trim() === ""}>
              {pending?.to === "CANCELLED" ? "Cancel request" : "Reopen request"}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
