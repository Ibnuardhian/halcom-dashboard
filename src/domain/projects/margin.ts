/** How Sales enter the target margin: as an amount (the default) or as a percentage of the sale. */
export const MARGIN_MODES = ["amount", "percent"] as const;
export type MarginMode = (typeof MARGIN_MODES)[number];

/**
 * Turns the one margin box of a form (with its mode) into the two stored fields. Only one of them carries the text; the
 * other is blank, which clears it, so a project never keeps both an amount and a percentage.
 */
export function marginFields(mode: unknown, input: unknown): { targetMargin: string; targetMarginValue: string } {
  const text = typeof input === "string" ? input : "";
  return mode === "percent" ? { targetMargin: text, targetMarginValue: "" } : { targetMargin: "", targetMarginValue: text };
}
