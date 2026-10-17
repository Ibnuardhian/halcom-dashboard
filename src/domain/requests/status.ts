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
  SUBMITTED: ["IN_PROGRESS", "CANCELLED"],
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
 * A completed BOQ may be handed over to Purchasing. Policy assumption: handover starts after
 * the BOQ is Completed (brief §17 leaves "complete at handover or after acknowledgement" open).
 */
export function canHandOver(type: RequestType, status: RequestStatus): boolean {
  return type === "BOQ" && status === "COMPLETED";
}

/** Handover targets: SOA picks RFQ or PO explicitly; completion never implies a purchase (brief §6.1). */
export const HANDOVER_TYPES = ["RFQ", "PO"] as const satisfies readonly RequestType[];
