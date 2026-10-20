import { GUIDE_LANES, GUIDE_NODES_BY_ID, LANE_ROWS, type GuideEdge, type GuideNode } from "@/domain/guide/workflow";

/** Layout constants of the flowchart, in unscaled pixels. The chart is drawn at this size and scaled for zoom. */
export const CHART = {
  laneLabelWidth: 128,
  columnPitch: 204,
  nodeWidth: 168,
  nodeHeight: 92,
  rowPitch: 116,
  padding: 12,
  columns: 10,
} as const;

export type Rect = { x: number; y: number; width: number; height: number };

const laneIndex = (role: string) => GUIDE_LANES.findIndex((lane) => lane === role);

/** The first grid row of a lane, counting the rows of the lanes above it. */
export function laneFirstRow(role: GuideNode["role"]): number {
  let row = 0;
  for (const lane of GUIDE_LANES.slice(0, laneIndex(role))) row += LANE_ROWS[lane];
  return row;
}

export function laneRect(role: GuideNode["role"]): Rect {
  const lane = role as (typeof GUIDE_LANES)[number];
  return { x: 0, y: CHART.padding + laneFirstRow(role) * CHART.rowPitch, width: chartSize().width, height: LANE_ROWS[lane] * CHART.rowPitch };
}

export function chartSize(): { width: number; height: number } {
  const rows = GUIDE_LANES.reduce((sum, lane) => sum + LANE_ROWS[lane], 0);
  return {
    width: CHART.laneLabelWidth + CHART.columns * CHART.columnPitch + CHART.padding,
    height: CHART.padding * 2 + rows * CHART.rowPitch,
  };
}

export function nodeRect(node: Pick<GuideNode, "role" | "col" | "row">): Rect {
  return {
    x: CHART.laneLabelWidth + node.col * CHART.columnPitch + (CHART.columnPitch - CHART.nodeWidth) / 2,
    y: CHART.padding + (laneFirstRow(node.role) + (node.row ?? 0)) * CHART.rowPitch + (CHART.rowPitch - CHART.nodeHeight) / 2,
    width: CHART.nodeWidth,
    height: CHART.nodeHeight,
  };
}

type Point = { x: number; y: number };
export type EdgeGeometry = { path: string; points: Point[]; label: Point | null; labelAnchor: "start" | "middle" | "end" };

const right = (r: Rect): Point => ({ x: r.x + r.width, y: r.y + r.height / 2 });
const left = (r: Rect): Point => ({ x: r.x, y: r.y + r.height / 2 });
const top = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y });
const bottom = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height });

const polyline = (points: Point[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

/** The path of an edge between two nodes, and where its label goes (beside the longest straight stretch). Pure, so it can be tested. */
export function edgeGeometry(edge: GuideEdge): EdgeGeometry {
  const from = GUIDE_NODES_BY_ID.get(edge.from);
  const to = GUIDE_NODES_BY_ID.get(edge.to);
  if (!from || !to) throw new Error(`Unknown node in edge ${edge.from} -> ${edge.to}`);
  const a = nodeRect(from);
  const b = nodeRect(to);
  let points: Point[];
  let path: string;

  switch (edge.route) {
    case "h": {
      const start = right(a);
      const end = left(b);
      points = [start, end];
      path = polyline(points);
      break;
    }
    case "curve": {
      const start = right(a);
      const end = left(b);
      const dx = Math.max(16, (end.x - start.x) / 2);
      points = [start, end];
      path = `M${start.x},${start.y} C${start.x + dx},${start.y} ${end.x - dx},${end.y} ${end.x},${end.y}`;
      break;
    }
    case "hv": {
      const start = right(a);
      const end = b.y > a.y ? top(b) : bottom(b);
      points = [start, { x: end.x, y: start.y }, end];
      path = polyline(points);
      break;
    }
    case "vh": {
      const start = b.y > a.y ? bottom(a) : top(a);
      const end = left(b);
      points = [start, { x: start.x, y: end.y }, end];
      path = polyline(points);
      break;
    }
    case "v": {
      const start = b.y > a.y ? bottom(a) : top(a);
      const end = b.y > a.y ? top(b) : bottom(b);
      points = [start, end];
      path = polyline(points);
      break;
    }
  }

  let label: Point | null = null;
  let labelAnchor: EdgeGeometry["labelAnchor"] = "middle";
  if (edge.label) {
    let best = { length: -1, from: points[0]!, to: points[0]! };
    for (let i = 0; i < points.length - 1; i += 1) {
      const p = points[i]!;
      const q = points[i + 1]!;
      const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (length > best.length) best = { length, from: p, to: q };
    }
    const vertical = best.from.x === best.to.x;
    const mid = { x: (best.from.x + best.to.x) / 2, y: (best.from.y + best.to.y) / 2 };
    // Beside a vertical line, on the side that has room (a line near the right edge of the chart takes its label on the left).
    const nearRightEdge = mid.x > chartSize().width - 150;
    label = vertical ? { x: mid.x + (nearRightEdge ? -8 : 8), y: mid.y } : { x: mid.x, y: mid.y - 8 };
    labelAnchor = vertical ? (nearRightEdge ? "end" : "start") : "middle";
  }
  return { path, points, label, labelAnchor };
}

/** Do two rectangles overlap (touching edges do not count)? */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
