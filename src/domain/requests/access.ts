import { can, type Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { RequestType } from "./types";

/** The permission needed to work on (change the status of) a request of this type. */
export function workPermission(type: RequestType): Permission {
  return type === "BOQ" ? "requests.work.boq" : "requests.work.purchasing";
}

/**
 * Who sees the email text of a request. Sales (and admins) write to whichever team owns the request. SOA only
 * deals with BOQ requests, and with the RFQ or PO it hands over to Purchasing itself; an RFQ or PO that Sales raised
 * goes to Purchasing, so SOA does not see its email. Purchasing does not send these emails.
 */
export function canSeeEmail(role: Role, type: RequestType, isHandover: boolean): boolean {
  if (!can(role, "requests.email")) return false;
  if (role === "SOA") return type === "BOQ" || isHandover;
  return true;
}

/**
 * Who decides what follows a completed BOQ or RFQ: the Sales owner of the project (the customer relationship is
 * theirs), admins, and SOA for the step after a BOQ. `ownsProject` is true for the Sales user who owns the project.
 */
export function canContinueFlow(role: Role, type: RequestType, ownsProject: boolean): boolean {
  if (role === "SALES") return ownsProject;
  if (role === "SOA") return type === "BOQ" && can(role, "requests.handover");
  return can(role, "requests.handover");
}

export function canWorkOn(role: Role, type: RequestType): boolean {
  return can(role, workPermission(type));
}
