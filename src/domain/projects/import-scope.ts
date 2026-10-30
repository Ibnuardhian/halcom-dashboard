import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { ImportFieldKey } from "./import";

/**
 * Which part of the Excel sheet a role fills in. The export and the template carry only these columns (plus the identity columns and
 * Last updated, which every role needs to match its rows), and the update refuses a change to any other column, so a column added
 * back by hand changes nothing. It is derived from the permissions, so changing them in the permission editor changes the sheet.
 */
export type ImportScope = {
  /** End user, Project name and Description. */
  identity: boolean;
  /** Sales PIC, Project source and External sales name. */
  owner: boolean;
  /** Progress to Target closing, including the money columns. Also what lets a role see the money. */
  commercial: boolean;
  /** Principals and Solution. */
  technical: boolean;
  /** Industry (kept on the customer) and Location. */
  place: boolean;
};

export function importScope(role: Role): ImportScope {
  const commercial = can(role, "projects.edit.commercial");
  const technical = can(role, "projects.edit.technical");
  return { identity: can(role, "projects.rename"), owner: can(role, "projects.edit.source"), commercial, technical, place: commercial || technical };
}

const ALWAYS: readonly ImportFieldKey[] = ["endUser", "name", "code", "description", "currentAction", "nextAction", "lastUpdated"];
const GROUPS: Record<Exclude<keyof ImportScope, "identity" | "place">, readonly ImportFieldKey[]> = {
  owner: ["salesPic", "source", "externalSourceName"],
  commercial: ["progress", "status", "estimatedValue", "targetMarginAmount", "targetMarginPercent", "quoteReleasedAt", "targetDate"],
  technical: ["principals", "solution", "technicalPic"],
};

/** The columns a role's template and export carry, in the template's order. */
export function scopedFieldKeys(scope: ImportScope, all: readonly ImportFieldKey[]): ImportFieldKey[] {
  const shown = new Set<ImportFieldKey>(ALWAYS);
  for (const [group, keys] of Object.entries(GROUPS)) if (scope[group as keyof typeof GROUPS]) for (const key of keys) shown.add(key);
  if (scope.place) for (const key of ["industry", "location"] as const) shown.add(key);
  return all.filter((key) => shown.has(key));
}
