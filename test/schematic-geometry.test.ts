import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";
import {
  analyzeSchematic,
  insertWireBend,
  nearestElectricalPoint,
  moveOrthogonalSegment,
  moveWireEndpoint,
  moveWireWithComponent,
  orthogonalRoute,
  pinPosition,
  removeWireBend,
  samePoint,
  snapPoint,
  wireIntersectsRect,
  wireJunctions,
} from "@/schematic-geometry";

const geometryProject = () => {
  const project = createBlankSnapshot().project;
  project.sheets[0].components.push({
    id: crypto.randomUUID(),
    kind: "voltageSource",
    position: { x: 180, y: 200 },
    rotation: 0,
    parameters: { value: "DC 5" },
    pins: [
      { id: "1", name: "+", offset: { x: 0, y: -30 } },
      { id: "2", name: "-", offset: { x: 0, y: 30 } },
    ],
    displayName: "Voltage source",
    spiceRef: "V1",
  });
  project.sheets[0].wires.push({
    id: crypto.randomUUID(),
    points: [
      { x: 180, y: 170 },
      { x: 300, y: 170 },
    ],
  });
  return project;
};

describe("schematic geometry", () => {
  it("snaps to half-grid component pins before the coarse grid", () => {
    const project = geometryProject();
    const source = project.sheets[0].components.find(
      (component) => component.spiceRef === "V1",
    )!;
    const positivePin = pinPosition(source, source.pins[0].offset);

    expect(positivePin).toEqual({ x: 180, y: 170 });
    expect(snapPoint({ x: 180, y: 164 })).toEqual({ x: 180, y: 160 });
    expect(nearestElectricalPoint(project, { x: 180, y: 164 }, 16)).toEqual(
      positivePin,
    );
  });

  it("snaps to the closest position along an existing wire", () => {
    expect(
      nearestElectricalPoint(geometryProject(), { x: 245, y: 164 }, 16),
    ).toEqual({ x: 245, y: 170 });
  });

  it("does not claim a distant point is electrically connected", () => {
    expect(
      nearestElectricalPoint(geometryProject(), { x: 40, y: 40 }, 16),
    ).toBeNull();
    expect(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });

  it("routes an orthogonal wire in either user-selected direction", () => {
    const start = { x: 20, y: 30 };
    const end = { x: 80, y: 90 };
    expect(orthogonalRoute(start, end, "horizontal-first")).toEqual([
      start,
      { x: 80, y: 30 },
      end,
    ]);
    expect(orthogonalRoute(start, end, "vertical-first")).toEqual([
      start,
      { x: 20, y: 90 },
      end,
    ]);
    expect(orthogonalRoute(start, start, "horizontal-first")).toEqual([]);
  });

  it("moves a terminal segment without disconnecting either endpoint", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
    ];
    expect(moveOrthogonalSegment(points, 0, { x: 44, y: 23 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
    ]);
  });

  it("moves an internal segment on-grid and preserves an orthogonal path", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 60 },
      { x: 80, y: 60 },
    ];
    expect(moveOrthogonalSegment(points, 1, { x: 47, y: 31 })).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 80, y: 60 },
    ]);
  });

  it("moves and reroutes a wire endpoint for reconnection", () => {
    expect(
      moveWireEndpoint(
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
        ],
        "start",
        { x: 20, y: 40 },
      ),
    ).toEqual([
      { x: 20, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 0 },
    ]);
  });

  it("rubber-bands an attached endpoint when its component moves", () => {
    const project = geometryProject();
    const source = project.sheets[0].components[0];
    expect(
      moveWireWithComponent(project.sheets[0].wires[0].points, source, {
        x: 220,
        y: 240,
      }),
    ).toEqual([
      { x: 220, y: 210 },
      { x: 300, y: 210 },
      { x: 300, y: 170 },
    ]);
  });

  it("finds both crossing and T-shaped wire junctions", () => {
    const wires = [
      {
        id: "horizontal",
        points: [
          { x: 0, y: 40 },
          { x: 100, y: 40 },
        ],
      },
      {
        id: "crossing",
        points: [
          { x: 40, y: 0 },
          { x: 40, y: 80 },
        ],
      },
      {
        id: "tee",
        points: [
          { x: 80, y: 40 },
          { x: 80, y: 80 },
        ],
      },
    ];
    expect(wireJunctions(wires)).toEqual(
      expect.arrayContaining([
        { x: 40, y: 40 },
        { x: 80, y: 40 },
      ]),
    );
  });

  it("adds and removes an explicit wire bend", () => {
    const source = [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ];
    const inserted = insertWireBend(source, 0, { x: 46, y: 24 });
    expect(inserted).toEqual({
      points: [source[0], { x: 40, y: 20 }, source[1]],
      index: 1,
    });
    expect(removeWireBend(inserted!.points, inserted!.index)).toEqual(source);
  });

  it("selects wires crossing a marquee and reports live open circuits", () => {
    const project = geometryProject();
    expect(
      wireIntersectsRect(project.sheets[0].wires[0], 220, 160, 260, 180),
    ).toBe(true);
    let diagnostics = analyzeSchematic(project);
    expect(diagnostics.brokenWireIds.size).toBe(1);
    expect(diagnostics.floatingPinIds.size).toBe(2);

    project.sheets[0].components.push({
      id: crypto.randomUUID(),
      kind: "resistor",
      position: { x: 340, y: 170 },
      rotation: 0,
      parameters: { value: "1k" },
      pins: [
        { id: "1", name: "1", offset: { x: -40, y: 0 } },
        { id: "2", name: "2", offset: { x: 40, y: 0 } },
      ],
      displayName: "R1",
      spiceRef: "R1",
    });
    diagnostics = analyzeSchematic(project);
    expect(diagnostics.brokenWireIds.size).toBe(0);
    expect(diagnostics.floatingPinIds.size).toBe(2);
  });
});
