import type { Component, Point, Project } from "./types";

export const GRID = 20;

export const rotatePoint = (point: Point, angle: number): Point => {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 90
    ? { x: -point.y, y: point.x }
    : normalized === 180
      ? { x: -point.x, y: -point.y }
      : normalized === 270
        ? { x: point.y, y: -point.x }
        : point;
};

export const pinPosition = (component: Component, offset: Point): Point => {
  const rotated = rotatePoint(offset, component.rotation);
  return {
    x: component.position.x + rotated.x,
    y: component.position.y + rotated.y,
  };
};

export const snapPoint = (point: Point): Point => ({
  x: Math.round(point.x / GRID) * GRID,
  y: Math.round(point.y / GRID) * GRID,
});

export const samePoint = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

export type WireBend = "horizontal-first" | "vertical-first";

export function orthogonalRoute(start: Point, end: Point, bend: WireBend) {
  if (samePoint(start, end)) return [];
  const corner =
    bend === "horizontal-first"
      ? { x: end.x, y: start.y }
      : { x: start.x, y: end.y };
  return samePoint(start, corner) || samePoint(corner, end)
    ? [start, end]
    : [start, corner, end];
}

export function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const deduplicated = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]),
  );
  if (deduplicated.length < 3) return deduplicated;

  const simplified: Point[] = [];
  for (const point of deduplicated) {
    while (simplified.length >= 2) {
      const a = simplified[simplified.length - 2];
      const b = simplified[simplified.length - 1];
      const vertical =
        samePoint({ x: a.x, y: 0 }, { x: b.x, y: 0 }) &&
        samePoint({ x: b.x, y: 0 }, { x: point.x, y: 0 });
      const horizontal =
        samePoint({ x: 0, y: a.y }, { x: 0, y: b.y }) &&
        samePoint({ x: 0, y: b.y }, { x: 0, y: point.y });
      if (!vertical && !horizontal) break;
      simplified.pop();
    }
    simplified.push(point);
  }
  return simplified;
}

/** Move one orthogonal segment perpendicular to itself while keeping wire endpoints fixed. */
export function moveOrthogonalSegment(
  points: Point[],
  segmentIndex: number,
  target: Point,
): Point[] {
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return points;
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  const snapped = snapPoint(target);
  const horizontal = Math.abs(a.y - b.y) < 0.001;
  const vertical = Math.abs(a.x - b.x) < 0.001;
  if (!horizontal && !vertical) return points;

  const movedA = horizontal
    ? { x: a.x, y: snapped.y }
    : { x: snapped.x, y: a.y };
  const movedB = horizontal
    ? { x: b.x, y: snapped.y }
    : { x: snapped.x, y: b.y };
  const first = segmentIndex === 0;
  const last = segmentIndex === points.length - 2;

  if (first && last) return simplifyOrthogonalPoints([a, movedA, movedB, b]);
  if (first)
    return simplifyOrthogonalPoints([
      a,
      movedA,
      movedB,
      ...points.slice(segmentIndex + 2),
    ]);
  if (last)
    return simplifyOrthogonalPoints([
      ...points.slice(0, segmentIndex),
      movedA,
      movedB,
      b,
    ]);

  const result = points.map((point) => ({ ...point }));
  result[segmentIndex] = movedA;
  result[segmentIndex + 1] = movedB;
  return simplifyOrthogonalPoints(result);
}

export function wireBendFromPoints(points: Point[]): WireBend | null {
  if (points.length < 3) return null;
  const start = points[0];
  const next = points[1];
  if (Math.abs(start.y - next.y) < 0.001) return "horizontal-first";
  if (Math.abs(start.x - next.x) < 0.001) return "vertical-first";
  return null;
}

const closestPointOnSegment = (point: Point, a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return a;
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return { x: a.x + ratio * dx, y: a.y + ratio * dy };
};

export function nearestElectricalPoint(
  project: Project,
  point: Point,
  maxDistance: number,
  ignoredComponentId?: string,
): Point | null {
  const sheet = project.sheets[0];
  if (!sheet) return null;
  let best: Point | null = null;
  let bestDistance = maxDistance;
  const consider = (candidate: Point) => {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  };

  for (const component of sheet.components) {
    if (component.id === ignoredComponentId || component.kind === "netLabel")
      continue;
    for (const pin of component.pins)
      consider(pinPosition(component, pin.offset));
  }
  for (const wire of sheet.wires) {
    if (wire.points.length === 1) consider(wire.points[0]);
    for (let index = 1; index < wire.points.length; index += 1)
      consider(
        closestPointOnSegment(
          point,
          wire.points[index - 1],
          wire.points[index],
        ),
      );
  }
  return best;
}
