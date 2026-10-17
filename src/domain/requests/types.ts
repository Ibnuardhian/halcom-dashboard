import type { Role } from "@/domain/access/roles";

/** Business intent of a request (brief §6.4). Keep in sync with `enum RequestType` in prisma/schema.prisma. */
export const REQUEST_TYPES = ["BOQ", "RFQ", "PO"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  BOQ: "BOQ request",
  RFQ: "RFQ request",
  PO: "PO request",
};

/** Subject prefix per request type (brief §6.4). */
export const SUBJECT_TAGS: Record<RequestType, string> = {
  BOQ: "[HITBOQ]",
  RFQ: "[HITRFQ]",
  PO: "[HITPO]",
};

/** The team that works on a request of this type. */
export const OWNING_ROLE: Record<RequestType, Role> = {
  BOQ: "SOA",
  RFQ: "PURCHASING",
  PO: "PURCHASING",
};

export const OWNING_TEAM_LABELS: Record<RequestType, string> = {
  BOQ: "SOA",
  RFQ: "Purchasing",
  PO: "Purchasing",
};

export function isRequestType(value: unknown): value is RequestType {
  return typeof value === "string" && (REQUEST_TYPES as readonly string[]).includes(value);
}

/** URL segment for a type's list page (`/requests/boq`). */
export function typeSlug(type: RequestType): string {
  return type.toLowerCase();
}

export function typeFromSlug(slug: string): RequestType | null {
  return REQUEST_TYPES.find((type) => typeSlug(type) === slug) ?? null;
}

/** Keep in sync with `enum ProjectStatus` in prisma/schema.prisma. */
export const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "CLOSED", "WON", "LOST", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  CLOSED: "Closed",
  WON: "Won",
  LOST: "Lost",
  COMPLETED: "Completed",
};
