const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** `1536` becomes `1.5 KiB`. Negative or non-finite input shows as a dash rather than a wrong number. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** `93784` seconds becomes `1d 2h`; shows the two largest non-zero units. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "–";
  const seconds = Math.floor(totalSeconds);
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "d"],
    [Math.floor((seconds % 86_400) / 3_600), "h"],
    [Math.floor((seconds % 3_600) / 60), "m"],
    [seconds % 60, "s"],
  ];
  const shown = parts.filter(([amount]) => amount > 0).slice(0, 2);
  return shown.length === 0 ? "0s" : shown.map(([amount, unit]) => `${amount}${unit}`).join(" ");
}

/** `0.9876` becomes `98.8%`; null (no data yet) shows as a dash. */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "–";
}
