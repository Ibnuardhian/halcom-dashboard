/** Geometry of the line charts, kept apart from React so it can be tested. */

export type XY = { x: number; y: number };

/**
 * A smooth curve through the points that never overshoots them (monotone cubic interpolation, Fritsch-Carlson): between two counts the line
 * does not dip below the lower one or rise above the higher one, so a smooth line cannot invent a value that was not there.
 * One point gives a bare move (the marker draws it); two give a straight line.
 */
export function monotonePath(points: readonly XY[]): string {
  const n = points.length;
  if (n === 0) return "";
  const first = points[0]!;
  if (n === 1) return `M${first.x},${first.y}`;
  if (n === 2) return `M${first.x},${first.y}L${points[1]!.x},${points[1]!.y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push(dx[i]! === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx[i]!);
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!;
    const b = tangent[i + 1]! / slope[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]!) / h;
      tangent[i + 1] = (3 * b * slope[i]!) / h;
    }
  }

  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const step = dx[i]! / 3;
    d += `C${round(p0.x + step)},${round(p0.y + tangent[i]! * step)},${round(p1.x - step)},${round(p1.y - tangent[i + 1]! * step)},${p1.x},${p1.y}`;
  }
  return d;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** The area under a curve: the curve, then down to the baseline and back to the start. */
export function areaPath(points: readonly XY[], baseline: number): string {
  if (points.length < 2) return "";
  const last = points[points.length - 1]!;
  return `${monotonePath(points)}L${last.x},${baseline}L${points[0]!.x},${baseline}Z`;
}

/** Runs of consecutive values that are not null: a missing period breaks the line instead of being bridged. */
export function runs<T>(values: readonly (T | null)[]): { start: number; items: T[] }[] {
  const result: { start: number; items: T[] }[] = [];
  let current: { start: number; items: T[] } | null = null;
  values.forEach((value, index) => {
    if (value === null) {
      current = null;
      return;
    }
    if (!current) {
      current = { start: index, items: [] };
      result.push(current);
    }
    current.items.push(value);
  });
  return result;
}

/** Whole-number ticks from 0 up to a round maximum, at most about `target` of them. Never empty, and 0 data still gets a 0..1 axis. */
export function niceTicks(max: number, target = 4): number[] {
  const top = Math.max(1, Math.ceil(Number.isFinite(max) ? max : 1));
  const rough = top / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude);
  const ticks: number[] = [];
  for (let value = 0; value < top + step; value += step) {
    ticks.push(value);
    if (value >= top) break;
  }
  return ticks;
}

/** How many labels to skip so that `count` labels of about `labelWidth` pixels fit in `width` without touching: draw every n-th. */
export function labelStep(count: number, labelWidth: number, width: number): number {
  if (count <= 1 || width <= 0) return 1;
  return Math.max(1, Math.ceil((count * (labelWidth + 8)) / width));
}
