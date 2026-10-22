import type { RequestType } from "@/domain/requests/types";

/**
 * A PIC is an operational assignee of SOA or Purchasing tickets (Adityo, Ibnu...), not a login account: each team signs in with one
 * shared account and hands its tickets to PICs. Keep in sync with `enum PicTeam` in prisma/schema.prisma.
 */
export const PIC_TEAMS = ["SOA", "PURCHASING"] as const;
export type PicTeam = (typeof PIC_TEAMS)[number];

export const PIC_TEAM_LABELS: Record<PicTeam, string> = { SOA: "SOA", PURCHASING: "Purchasing" };

export const PIC_NAME_MAX_LENGTH = 80;

/** The team whose PICs can take a request of this type: SOA for a BOQ, Purchasing for an RFQ or a PO. */
export function picTeamOf(type: RequestType): PicTeam {
  return type === "BOQ" ? "SOA" : "PURCHASING";
}

export type PicOption = { id: string; name: string };
