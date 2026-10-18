import type { RequestType } from "./types";

/** Keep in sync with `enum RequestStatus` in prisma/schema.prisma (brief §7, reduced to what is confirmed). */
export const REQUEST_STATUSES = [
  "SUBMITTED",
  "IN_PROGRESS",
  "WAITING_FOR_SALES",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: "Submitted",
  IN_PROGRESS: "In progress",
  WAITING_FOR_SALES: "Waiting for Sales",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  // A request nobody has touched can be answered straight away: no manual "In progress" step in between.
  SUBMITTED: ["IN_PROGRESS", "WAITING_FOR_SALES", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_SALES", "COMPLETED", "CANCELLED"],
  WAITING_FOR_SALES: ["IN_PROGRESS", "CANCELLED"],
  // Reopening keeps the earlier completion in the status history (brief §6.3).
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: [],
};

export function allowedTransitions(from: RequestStatus): readonly RequestStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Waiting, cancelling and reopening must say why, so waiting time cannot be hidden silently (brief §8.4). */
export function reasonRequired(from: RequestStatus, to: RequestStatus): boolean {
  return to === "WAITING_FOR_SALES" || to === "CANCELLED" || (from === "COMPLETED" && to === "IN_PROGRESS");
}

export function isOpen(status: RequestStatus): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

/**
 * The flow is BOQ -> RFQ -> PO. A request is continued once it is Completed (brief §17 leaves "complete at handover or
 * after acknowledgement" open). Completion never implies a purchase: someone has to decide to continue (brief §6.1).
 * A BOQ can be skipped: Sales may start with an RFQ.
 */
export const NEXT_IN_FLOW: Record<RequestType, RequestType | null> = { BOQ: "RFQ", RFQ: "PO", PO: null };

export function canHandOver(type: RequestType, status: RequestStatus): boolean {
  return NEXT_IN_FLOW[type] !== null && status === "COMPLETED";
}

/** A PO follows an RFQ: it can only be raised on a project that has a completed RFQ. A BOQ and an RFQ have no such condition. */
export const PO_NEEDS_RFQ = "A PO needs a completed RFQ on the project first. Raise the RFQ, and when it is completed, continue it to a PO.";

/** The step that follows in the flow, or null after a PO. */
export function nextRequestType(type: RequestType): RequestType | null {
  return NEXT_IN_FLOW[type];
}

/** Types a request can be continued as: an RFQ after a BOQ, a PO after an RFQ. */
export const HANDOVER_TYPES = ["RFQ", "PO"] as const satisfies readonly RequestType[];
