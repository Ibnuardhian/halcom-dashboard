import type { ProjectProgress } from "./progress";

/** The steps of the sales funnel, in order. "Negotiate" and "Negotiate (FU)" are one step here. */
export const FUNNEL_STEPS: readonly { key: string; label: string; members: readonly ProjectProgress[] }[] = [
  { key: "QUALIFY", label: "Qualify", members: ["QUALIFY"] },
  { key: "UNDERSTAND", label: "Understand", members: ["UNDERSTAND"] },
  { key: "PROPOSE", label: "Propose", members: ["PROPOSE"] },
  { key: "NEGOTIATE", label: "Negotiate", members: ["NEGOTIATE", "NEGOTIATE_FU"] },
  { key: "AGREE", label: "Agree", members: ["AGREE"] },
  { key: "CLOSED_WON", label: "Closed Won", members: ["CLOSED_WON"] },
];

export type FunnelStep = { key: string; label: string; count: number; value: number };

/**
 * How many projects (and how much estimated value) reached each step: a project at Propose has passed Qualify and
 * Understand, so it counts in all three. Closed Lost projects are not in the funnel; they left it.
 */
export function buildFunnel(byProgress: readonly { key: string; count: number; value: number }[]): FunnelStep[] {
  const at = new Map(byProgress.map((slice) => [slice.key, slice]));
  const own = FUNNEL_STEPS.map((step) => ({
    count: step.members.reduce((sum, member) => sum + (at.get(member)?.count ?? 0), 0),
    value: step.members.reduce((sum, member) => sum + (at.get(member)?.value ?? 0), 0),
  }));
  return FUNNEL_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    count: own.slice(index).reduce((sum, item) => sum + item.count, 0),
    value: own.slice(index).reduce((sum, item) => sum + item.value, 0),
  }));
}
