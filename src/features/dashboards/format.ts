/** `2026-10-17 01:56 UTC`. Fixed format and zone: the company time zone is not decided yet. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
