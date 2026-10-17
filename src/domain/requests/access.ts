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

export function canWorkOn(role: Role, type: RequestType): boolean {
  return can(role, workPermission(type));
}
