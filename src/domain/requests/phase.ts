/**
 * The part of the BOQ work SOA is on. The list lives in the database (`soa_phases`: an Admin or Superadmin can add to it), and a
 * request keeps the key. These are the three the system starts with: their keys and labels, for tests and as a fallback.
 */
export const DEFAULT_SOA_PHASES = ["ASSESSMENT", "SIZING", "POC"] as const;
export type SoaPhase = string;

export const SOA_PHASE_LABELS: Record<string, string> = {
  ASSESSMENT: "Assessment",
  SIZING: "Sizing",
  POC: "POC",
};

export function isSoaPhase(value: unknown): value is SoaPhase {
  return typeof value === "string" && (DEFAULT_SOA_PHASES as readonly string[]).includes(value);
}

/** A phase's key from the label an administrator typed: "Pre Assessment" gives "PRE_ASSESSMENT". */
export function phaseKeyOf(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
