import type { MemberPoint } from "@tgbox/shared";

const DAY_MS = 86_400_000;
const round = (value: number) => Math.round(value * 100) / 100;

/** SVG path data for a member-trend area chart spanning `width` × `height`; null below two points. */
export function areaChart(values: number[], width: number, height: number) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const points = values.map((value, index) => ({
    x: round((index / (values.length - 1)) * width),
    y: round(range === 0 ? height / 2 : height - ((value - min) / range) * height),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const end = points[points.length - 1] ?? { x: width, y: height };
  return { line, area: `${line} L${width},${height} L0,${height} Z`, end };
}

/** Member change over the last `days`, or null when history doesn't reach that far back. */
export function memberDelta(history: MemberPoint[], days: number): number | null {
  const last = history.at(-1);
  if (!last) return null;
  const cutoff = Date.parse(last.t) - days * DAY_MS;
  const base = history.findLast((point) => Date.parse(point.t) <= cutoff);
  return base ? last.members - base.members : null;
}

/** Filled state of the four activity bar segments for tier 0 (dormant) … 4 (very active). */
export function activitySegments(tier: number | null): boolean[] {
  return [1, 2, 3, 4].map((segment) => tier !== null && segment <= tier);
}
