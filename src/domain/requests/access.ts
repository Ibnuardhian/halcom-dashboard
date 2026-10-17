import { can, type Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { RequestType } from "./types";

/** The permission needed to work on (change the status of) a request of this type. */
export function workPermission(type: RequestType): Permission {
  return type === "BOQ" ? "requests.work.boq" : "requests.work.purchasing";
}

export function canWorkOn(role: Role, type: RequestType): boolean {
  return can(role, workPermission(type));
}
