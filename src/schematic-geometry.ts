import type { Component, Point, Project, Wire } from "./types";

export const GRID = 20;
const SPATIAL_BUCKET_SIZE = 400;

export type SchematicViewport = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type VisibleSchematicItems = {
  components: Component[];
  wires: Wire[];
};

/** Cached spatial lookup used by hit-testing and viewport rendering on large sheets. */
export class SchematicSpatialIndex {
  private componentBuckets = new Map<string, Component[]>();
  private wireBuckets = new Map<string, Wire[]>();

  constructor(components: Component[], wires: Wire[]) {
    for (const component of components)
      this.addToBuckets(
        this.componentBuckets,
        component,
        component.position.x - 80,
        component.position.y - 80,
        component.position.x + 80,
        component.position.y + 80,
      );
    for (const wire of wires) {
      if (!wire.points.length) continue;
      let left = wire.points[0].x;
      let right = left;
      let top = wire.points[0].y;
      let bottom = top;
      for (const point of wire.points.slice(1)) {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
      }
      this.addToBuckets(this.wireBuckets, wire, left, top, right, bottom);
    }
  }

  query(viewport: SchematicViewport): VisibleSchematicItems {
    return {
      components: this.queryBuckets(this.componentBuckets, viewport),
      wires: this.queryBuckets(this.wireBuckets, viewport).filter((wire) =>
        wireIntersectsRect(
          wire,
          viewport.left,
          viewport.top,
          viewport.right,
          viewport.bottom,
        ),
      ),
    };
  }

  private addToBuckets<T>(
    buckets: Map<string, T[]>,
    item: T,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) {
    for (
      let x = Math.floor(left / SPATIAL_BUCKET_SIZE);
      x <= Math.floor(right / SPATIAL_BUCKET_SIZE);
      x += 1
    )
      for (
        let y = Math.floor(top / SPATIAL_BUCKET_SIZE);
        y <= Math.floor(bottom / SPATIAL_BUCKET_SIZE);
        y += 1
      ) {
        const key = `${x}:${y}`;
        const entries = buckets.get(key) ?? [];
        entries.push(item);
        buckets.set(key, entries);
      }
  }

  private queryBuckets<T>(
    buckets: Map<string, T[]>,
    viewport: SchematicViewport,
  ): T[] {
    const result = new Set<T>();
    for (
      let x = Math.floor(viewport.left / SPATIAL_BUCKET_SIZE);
      x <= Math.floor(viewport.right / SPATIAL_BUCKET_SIZE);
      x += 1
    )
      for (
        let y = Math.floor(viewport.top / SPATIAL_BUCKET_SIZE);
        y <= Math.floor(viewport.bottom / SPATIAL_BUCKET_SIZE);
        y += 1
      )
        for (const item of buckets.get(`${x}:${y}`) ?? []) result.add(item);
    return [...result];
  }
}

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

export type WireEndpoint = "start" | "end";

/** Move a wire endpoint while preserving the direction of its terminal segment. */
export function moveWireEndpoint(
  points: Point[],
  endpoint: WireEndpoint,
  target: Point,
): Point[] {
  if (points.length < 2) return points;
  const moveStart = endpoint === "start";
  const terminal = moveStart ? points[0] : points[points.length - 1];
  const neighbor = moveStart ? points[1] : points[points.length - 2];
  const horizontal = Math.abs(terminal.y - neighbor.y) < 0.001;
  const bend: WireBend = horizontal ? "horizontal-first" : "vertical-first";
  const terminalRoute = orthogonalRoute(target, neighbor, bend);
  const route = terminalRoute.length ? terminalRoute : [target];
  const moved = moveStart
    ? [...route, ...points.slice(2)]
    : [...points.slice(0, -2), ...route.reverse()];
  const simplified = simplifyOrthogonalPoints(moved);
  return simplified.length >= 2 ? simplified : points;
}

/** Rubber-band wire endpoints that are attached to a moving component's pins. */
export function moveWireWithComponent(
  points: Point[],
  component: Component,
  position: Point,
): Point[] {
  if (component.kind === "netLabel" || points.length < 2) return points;
  const pins = component.pins.map((pin) => pinPosition(component, pin.offset));
  const delta = {
    x: position.x - component.position.x,
    y: position.y - component.position.y,
  };
  const start = points[0];
  const end = points[points.length - 1];
  let moved = points;
  if (pins.some((pin) => samePoint(pin, start)))
    moved = moveWireEndpoint(moved, "start", {
      x: start.x + delta.x,
      y: start.y + delta.y,
    });
  if (pins.some((pin) => samePoint(pin, end)))
    moved = moveWireEndpoint(moved, "end", {
      x: end.x + delta.x,
      y: end.y + delta.y,
    });
  return moved;
}

export function wireBendFromPoints(points: Point[]): WireBend | null {
  if (points.length < 3) return null;
  const start = points[0];
  const next = points[1];
  if (Math.abs(start.y - next.y) < 0.001) return "horizontal-first";
  if (Math.abs(start.x - next.x) < 0.001) return "vertical-first";
  return null;
}

export const closestPointOnSegment = (
  point: Point,
  a: Point,
  b: Point,
): Point => {
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

export const pointOnSegment = (point: Point, a: Point, b: Point) => {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 0.001) return false;
  return (
    point.x >= Math.min(a.x, b.x) - 0.001 &&
    point.x <= Math.max(a.x, b.x) + 0.001 &&
    point.y >= Math.min(a.y, b.y) - 0.001 &&
    point.y <= Math.max(a.y, b.y) + 0.001
  );
};

type WireSegment = {
  wireId: string;
  index: number;
  a: Point;
  b: Point;
};

const wireSegments = (wires: Wire[]): WireSegment[] =>
  wires.flatMap((wire) =>
    wire.points.slice(1).map((b, index) => ({
      wireId: wire.id,
      index,
      a: wire.points[index],
      b,
    })),
  );

const horizontalSegment = (segment: WireSegment) =>
  Math.abs(segment.a.y - segment.b.y) < 0.001;

const perpendicularIntersection = (
  first: WireSegment,
  second: WireSegment,
): Point | null => {
  const firstHorizontal = samePoint(
    { x: 0, y: first.a.y },
    { x: 0, y: first.b.y },
  );
  const secondHorizontal = samePoint(
    { x: 0, y: second.a.y },
    { x: 0, y: second.b.y },
  );
  if (firstHorizontal === secondHorizontal) return null;
  const horizontal = firstHorizontal ? first : second;
  const vertical = firstHorizontal ? second : first;
  const point = { x: vertical.a.x, y: horizontal.a.y };
  return pointOnSegment(point, horizontal.a, horizontal.b) &&
    pointOnSegment(point, vertical.a, vertical.b)
    ? point
    : null;
};

const pointKey = (point: Point) =>
  `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;

const coordinateKey = (coordinate: number) =>
  String(Math.round(coordinate * 1000));

type SegmentIndex = {
  horizontalByY: Map<string, WireSegment[]>;
  verticalByX: Map<string, WireSegment[]>;
};

const indexSegments = (segments: WireSegment[]): SegmentIndex => {
  const horizontalByY = new Map<string, WireSegment[]>();
  const verticalByX = new Map<string, WireSegment[]>();
  for (const segment of segments) {
    const index = horizontalSegment(segment) ? horizontalByY : verticalByX;
    const coordinate = horizontalSegment(segment) ? segment.a.y : segment.a.x;
    const key = coordinateKey(coordinate);
    const entries = index.get(key) ?? [];
    entries.push(segment);
    index.set(key, entries);
  }
  return { horizontalByY, verticalByX };
};

const segmentsAtPoint = (point: Point, index: SegmentIndex) => [
  ...(index.horizontalByY.get(coordinateKey(point.y)) ?? []).filter((segment) =>
    pointOnSegment(point, segment.a, segment.b),
  ),
  ...(index.verticalByX.get(coordinateKey(point.x)) ?? []).filter((segment) =>
    pointOnSegment(point, segment.a, segment.b),
  ),
];

const lowerBoundByX = (segments: WireSegment[], x: number) => {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (segments[middle].a.x < x) low = middle + 1;
    else high = middle;
  }
  return low;
};

const orthogonalIntersections = (segments: WireSegment[]) => {
  const horizontal = segments.filter(horizontalSegment);
  const vertical = segments
    .filter((segment) => !horizontalSegment(segment))
    .sort((first, second) => first.a.x - second.a.x);
  const intersections = new Map<string, Point>();
  for (const segment of horizontal) {
    const left = Math.min(segment.a.x, segment.b.x);
    const right = Math.max(segment.a.x, segment.b.x);
    for (
      let index = lowerBoundByX(vertical, left - 0.001);
      index < vertical.length && vertical[index].a.x <= right + 0.001;
      index += 1
    ) {
      const point = perpendicularIntersection(segment, vertical[index]);
      if (point) intersections.set(pointKey(point), point);
    }
  }
  return intersections;
};

const buildWireTopology = (wires: Wire[]) => {
  const segments = wireSegments(wires);
  const segmentIndex = indexSegments(segments);
  const candidates = orthogonalIntersections(segments);
  for (const wire of wires)
    for (const point of wire.points) candidates.set(pointKey(point), point);
  const junctions = [...candidates.values()].filter((point) => {
    const directions = new Set<string>();
    for (const segment of segmentsAtPoint(point, segmentIndex)) {
      if (segment.a.x < point.x - 0.001 || segment.b.x < point.x - 0.001)
        directions.add("left");
      if (segment.a.x > point.x + 0.001 || segment.b.x > point.x + 0.001)
        directions.add("right");
      if (segment.a.y < point.y - 0.001 || segment.b.y < point.y - 0.001)
        directions.add("up");
      if (segment.a.y > point.y + 0.001 || segment.b.y > point.y + 0.001)
        directions.add("down");
    }
    return directions.size >= 3;
  });
  return { segments, segmentIndex, candidates, junctions };
};

/** Electrical crossing and T-junction locations, excluding simple bends and splices. */
export function wireJunctions(wires: Wire[]): Point[] {
  return buildWireTopology(wires).junctions;
}

export function insertWireBend(
  points: Point[],
  segmentIndex: number,
  target: Point,
): { points: Point[]; index: number } | null {
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  if (!a || !b) return null;
  const closest = closestPointOnSegment(target, a, b);
  const horizontal = Math.abs(a.y - b.y) < 0.001;
  const point = horizontal
    ? { x: snapPoint(closest).x, y: a.y }
    : { x: a.x, y: snapPoint(closest).y };
  if (samePoint(point, a) || samePoint(point, b)) return null;
  return {
    points: [
      ...points.slice(0, segmentIndex + 1),
      point,
      ...points.slice(segmentIndex + 1),
    ],
    index: segmentIndex + 1,
  };
}

/** Remove an explicit vertex; for an L corner, preserve orthogonality via the alternate corner. */
export function removeWireBend(points: Point[], index: number): Point[] {
  if (index <= 0 || index >= points.length - 1) return points;
  const before = points[index - 1];
  const after = points[index + 1];
  const remaining = [...points.slice(0, index), ...points.slice(index + 1)];
  if (
    Math.abs(before.x - after.x) < 0.001 ||
    Math.abs(before.y - after.y) < 0.001
  )
    return simplifyOrthogonalPoints(remaining);
  const removed = points[index];
  const alternate = samePoint(removed, { x: after.x, y: before.y })
    ? { x: before.x, y: after.y }
    : { x: after.x, y: before.y };
  return simplifyOrthogonalPoints([
    ...points.slice(0, index),
    alternate,
    ...points.slice(index + 1),
  ]);
}

export function wireIntersectsRect(
  wire: Wire,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  return wire.points.slice(1).some((point, index) => {
    const a = wire.points[index];
    return !(
      Math.max(a.x, point.x) < left ||
      Math.min(a.x, point.x) > right ||
      Math.max(a.y, point.y) < top ||
      Math.min(a.y, point.y) > bottom
    );
  });
}

class PointUnionFind {
  private parent = new Map<string, string>();

  add(key: string) {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    const parent = this.parent.get(key)!;
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string) {
    const first = this.find(a);
    const second = this.find(b);
    if (first !== second) this.parent.set(second, first);
  }
}

export type SchematicDiagnostics = {
  floatingPinIds: Set<string>;
  brokenWireIds: Set<string>;
  brokenWireEndpoints: Set<string>;
  disconnectedLabelIds: Set<string>;
  junctions: Point[];
};

/** Lightweight, live electrical-rule diagnostics used by the canvas. */
export function analyzeSchematic(project: Project): SchematicDiagnostics {
  const sheet = project.sheets[0];
  const floatingPinIds = new Set<string>();
  const brokenWireIds = new Set<string>();
  const brokenWireEndpoints = new Set<string>();
  const disconnectedLabelIds = new Set<string>();
  const junctions: Point[] = [];
  if (!sheet)
    return {
      floatingPinIds,
      brokenWireIds,
      brokenWireEndpoints,
      disconnectedLabelIds,
      junctions,
    };

  const topology = buildWireTopology(sheet.wires);
  const { candidates, segmentIndex, segments } = topology;
  const allPoints = new Map<string, Point>();
  const pins: { id: string; point: Point }[] = [];
  for (const component of sheet.components) {
    if (component.kind === "netLabel") continue;
    for (const pin of component.pins) {
      const point = pinPosition(component, pin.offset);
      pins.push({ id: `${component.id}:${pin.id}`, point });
      allPoints.set(pointKey(point), point);
    }
  }
  for (const wire of sheet.wires)
    for (const point of wire.points) allPoints.set(pointKey(point), point);
  for (const [key, point] of candidates) allPoints.set(key, point);

  const union = new PointUnionFind();
  for (const key of allPoints.keys()) union.add(key);
  const pointsByX = new Map<string, Point[]>();
  const pointsByY = new Map<string, Point[]>();
  for (const point of allPoints.values()) {
    const xKey = coordinateKey(point.x);
    const yKey = coordinateKey(point.y);
    const sameX = pointsByX.get(xKey) ?? [];
    const sameY = pointsByY.get(yKey) ?? [];
    sameX.push(point);
    sameY.push(point);
    pointsByX.set(xKey, sameX);
    pointsByY.set(yKey, sameY);
  }
  for (const segment of segments) {
    const alignedPoints = horizontalSegment(segment)
      ? (pointsByY.get(coordinateKey(segment.a.y)) ?? [])
      : (pointsByX.get(coordinateKey(segment.a.x)) ?? []);
    const points = alignedPoints.filter((point) =>
      pointOnSegment(point, segment.a, segment.b),
    );
    for (const point of points)
      union.union(pointKey(segment.a), pointKey(point));
  }
  const pinsPerRoot = new Map<string, number>();
  for (const pin of pins) {
    const root = union.find(pointKey(pin.point));
    pinsPerRoot.set(root, (pinsPerRoot.get(root) ?? 0) + 1);
  }
  for (const pin of pins)
    if ((pinsPerRoot.get(union.find(pointKey(pin.point))) ?? 0) < 2)
      floatingPinIds.add(pin.id);

  const labelPositions = sheet.components
    .filter((component) => component.kind === "netLabel")
    .map((component) => ({ id: component.id, point: component.position }));
  const allLabelPositions = [
    ...labelPositions,
    ...sheet.netLabels.map((label) => ({
      id: label.id,
      point: label.position,
    })),
  ];
  const pinKeys = new Set(pins.map((pin) => pointKey(pin.point)));
  const labelKeys = new Set(
    allLabelPositions.map((label) => pointKey(label.point)),
  );
  for (const label of allLabelPositions) {
    const connected =
      pinKeys.has(pointKey(label.point)) ||
      segmentsAtPoint(label.point, segmentIndex).length > 0;
    if (!connected) disconnectedLabelIds.add(label.id);
  }

  for (const wire of sheet.wires) {
    const endpoints = [wire.points[0], wire.points[wire.points.length - 1]];
    endpoints.forEach((endpoint, endpointIndex) => {
      const connected =
        pinKeys.has(pointKey(endpoint)) ||
        labelKeys.has(pointKey(endpoint)) ||
        segmentsAtPoint(endpoint, segmentIndex).some(
          (segment) =>
            (segment.wireId !== wire.id ||
              (endpointIndex === 0
                ? segment.index !== 0
                : segment.index !== wire.points.length - 2)) &&
            pointOnSegment(endpoint, segment.a, segment.b),
        );
      if (!connected) {
        brokenWireIds.add(wire.id);
        brokenWireEndpoints.add(`${wire.id}:${endpointIndex}`);
      }
    });
  }
  return {
    floatingPinIds,
    brokenWireIds,
    brokenWireEndpoints,
    disconnectedLabelIds,
    junctions: topology.junctions,
  };
}

export function nearestElectricalPoint(
  project: Project,
  point: Point,
  maxDistance: number,
  ignoredComponentId?: string,
  ignoredWireId?: string,
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
    if (wire.id === ignoredWireId) continue;
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
