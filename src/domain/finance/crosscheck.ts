import type { ProjectProgress } from "@/domain/projects/progress";
import type { RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";

/**
 * Finance's cross-check of a project: its value, its quotation (RFQ) and purchase order (PO) references, and the points where
 * those do not agree with the project's progress. Every flag is derived from stored data by a rule written here; nothing is
 * a verdict by a person and nothing is stored (verification by Finance would be a separate, permissioned and audited action).
 */
export const CROSSCHECK_FLAGS = ["won_no_final_value", "won_no_po", "won_no_quotation", "po_not_won"] as const;
export type CrosscheckFlag = (typeof CROSSCHECK_FLAGS)[number];

export const CROSSCHECK_FLAG_LABELS: Record<CrosscheckFlag, string> = {
  won_no_final_value: "Closed Won without a final value",
  won_no_po: "Closed Won without a PO reference",
  won_no_quotation: "Closed Won without a quotation (RFQ) reference",
  po_not_won: "PO selesai, tetapi project belum Closed Won",
};

export function isCrosscheckFlag(value: unknown): value is CrosscheckFlag {
  return typeof value === "string" && (CROSSCHECK_FLAGS as readonly string[]).includes(value);
}

export type CrosscheckRequest = { code: string; type: RequestType; status: RequestStatus };

export type CrosscheckInput = {
  progress: ProjectProgress;
  finalValue: number | null;
  requests: readonly CrosscheckRequest[];
};

/** A cancelled request is not a reference: it did not lead to a quotation or an order. */
const counts = (request: CrosscheckRequest) => request.status !== "CANCELLED";

export function crosscheckFlags({ progress, finalValue, requests }: CrosscheckInput): CrosscheckFlag[] {
  const flags: CrosscheckFlag[] = [];
  const won = progress === "CLOSED_WON";
  const hasRfq = requests.some((r) => r.type === "RFQ" && counts(r));
  const hasPo = requests.some((r) => r.type === "PO" && counts(r));
  const poCompleted = requests.some((r) => r.type === "PO" && r.status === "COMPLETED");
  if (won && finalValue === null) flags.push("won_no_final_value");
  if (won && !hasPo) flags.push("won_no_po");
  if (won && !hasRfq) flags.push("won_no_quotation");
  if (!won && poCompleted) flags.push("po_not_won");
  return flags;
}
