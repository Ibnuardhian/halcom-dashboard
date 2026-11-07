/** A revision was asked for by Sales on a completed BOQ (it went straight to the Revision stage). */
export const REVISION_REQUESTED_KIND = "request.revision_requested";
/** A BOQ was moved to Revision on the board (by SOA, or an admin). */
export const REVISION_STARTED_KIND = "request.revision_started";

/** An open request is close to its SLA deadline (Warning). Written by the scheduled scan, not by a person's action. */
export const SLA_DUE_SOON_KIND = "sla.due_soon";
/** An open request is past its SLA deadline (Danger). */
export const SLA_OVERDUE_KIND = "sla.overdue";

export function isSlaNotification(kind: string): boolean {
  return kind === SLA_DUE_SOON_KIND || kind === SLA_OVERDUE_KIND;
}

/** Notifications about a revision are shown in red (and say so in words). */
export function isRevisionNotification(kind: string): boolean {
  return kind === REVISION_REQUESTED_KIND || kind === REVISION_STARTED_KIND;
}
