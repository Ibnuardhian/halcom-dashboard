/**
 * Master data SOA classifies a project with: the Principal (brand or vendor, HPE, Dell, Hikvision...) and the Solution
 * (the kind of solution, CCTV, networking...). Two separate lists, each record with a stable id; a project points at one of each.
 * Keep in step with the `principals` and `solution_categories` tables.
 */
export const MASTER_KINDS = ["principal", "solution"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

export const MASTER_KIND_LABELS: Record<MasterKind, string> = { principal: "Principal", solution: "Solution" };

export const MASTER_NAME_MAX_LENGTH = 120;

export type MasterOption = { id: string; name: string };

const squash = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** The options that match what was typed: a name that contains it, ignoring case and extra spaces, the closest (starts with it) first. */
export function filterMasterOptions(options: readonly MasterOption[], typed: string): MasterOption[] {
  const needle = squash(typed);
  if (needle === "") return [...options];
  const starts: MasterOption[] = [];
  const contains: MasterOption[] = [];
  for (const option of options) {
    const name = squash(option.name);
    if (name.startsWith(needle)) starts.push(option);
    else if (name.includes(needle)) contains.push(option);
  }
  return [...starts, ...contains];
}

/** True when the typed name is already a record (same name ignoring case and spacing): then "create" is not offered, selecting is. */
export function hasExactMatch(options: readonly MasterOption[], typed: string): boolean {
  const key = squash(typed);
  return key !== "" && options.some((option) => squash(option.name) === key);
}
