/** Largest first. Rows without a value to rank by ("Not set", the folded "Other") stay at the bottom. */
export function rankRows<T extends { value: number; neutral?: boolean }>(rows: readonly T[]): T[] {
  const ranked = rows.filter((row) => !row.neutral).sort((a, b) => b.value - a.value);
  return [...ranked, ...rows.filter((row) => row.neutral)];
}
