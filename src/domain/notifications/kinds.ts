/** A revision was asked for by Sales on a completed BOQ (it went straight to the Revision stage). */
export const REVISION_REQUESTED_KIND = "request.revision_requested";
/** A BOQ was moved to Revision on the board (by SOA, or an admin). */
export const REVISION_STARTED_KIND = "request.revision_started";

/** Notifications about a revision are shown in red (and say so in words). */
export function isRevisionNotification(kind: string): boolean {
  return kind === REVISION_REQUESTED_KIND || kind === REVISION_STARTED_KIND;
}
