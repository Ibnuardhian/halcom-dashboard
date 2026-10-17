/** The part of the BOQ work SOA is on. Keep in sync with `enum SoaPhase` in prisma/schema.prisma. */
export const SOA_PHASES = ["ASSESSMENT", "SIZING", "POC"] as const;
export type SoaPhase = (typeof SOA_PHASES)[number];

export const SOA_PHASE_LABELS: Record<SoaPhase, string> = {
  ASSESSMENT: "Assessment",
  SIZING: "Sizing",
  POC: "POC",
};

export function isSoaPhase(value: unknown): value is SoaPhase {
  return typeof value === "string" && (SOA_PHASES as readonly string[]).includes(value);
}
