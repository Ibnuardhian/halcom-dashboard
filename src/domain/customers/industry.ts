export const INDUSTRY_MAX_LENGTH = 80;

export type IndustryResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * An industry as it is stored: surrounding space removed, inner runs of space collapsed, at most 80 characters. Empty means "not set".
 * It is free text on purpose (the list of industries is not fixed); the form suggests the ones already in use so spelling stays the same.
 */
export function normaliseIndustry(input: unknown): IndustryResult {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, message: "Industri harus berupa teks." };
  const value = input.replace(/\s+/g, " ").trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > INDUSTRY_MAX_LENGTH) return { ok: false, message: `The industry must be at most ${INDUSTRY_MAX_LENGTH} characters.` };
  return { ok: true, value };
}
