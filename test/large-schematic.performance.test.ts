import { describe, expect, it } from "vitest";
import {
  analyzeSchematic,
  SchematicSpatialIndex,
} from "../src/schematic-geometry";
import type { Component, Project, Wire } from "../src/types";

const LARGE_COMPONENT_COUNT = 3_000;

function largeProject(): Project {
  const components: Component[] = [];
  const wires: Wire[] = [];
  for (let index = 0; index < LARGE_COMPONENT_COUNT; index += 1) {
    const x = (index % 50) * 140;
    const y = Math.floor(index / 50) * 120;
    components.push({
      id: `component-${index}`,
      kind: "resistor",
      position: { x, y },
      rotation: 0,
      parameters: { value: "1k" },
      pins: [
        { id: "1", name: "1", offset: { x: -40, y: 0 } },
        { id: "2", name: "2", offset: { x: 40, y: 0 } },
      ],
      displayName: `R${index + 1}`,
      spiceRef: `R${index + 1}`,
      model: null,
    });
    wires.push({
      id: `wire-${index}`,
      points: [
        { x: x - 40, y },
        { x: x + 40, y },
      ],
    });
  }
  return {
    schemaVersion: 2,
    metadata: {
      id: "large-project",
      name: "Large schematic fixture",
      description: "",
      author: "",
    },
    sheets: [
      {
        id: "main",
        name: "Main",
        components,
        wires,
        netLabels: [],
      },
    ],
    simulationProfiles: [],
    spiceLibraries: [],
    devicePacks: [],
    deviceInstances: [],
    activeSimulationProfile: null,
    uiViewState: {
      activeSheetId: "main",
      zoom: 1,
      pan: { x: 0, y: 0 },
      gridVisible: true,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("large schematic performance", () => {
  it("analyzes 3,000 components and builds a bounded viewport quickly", () => {
    const project = largeProject();
    const diagnosticsStart = performance.now();
    const diagnostics = analyzeSchematic(project);
    const diagnosticsMs = performance.now() - diagnosticsStart;

    const indexStart = performance.now();
    const index = new SchematicSpatialIndex(
      project.sheets[0].components,
      project.sheets[0].wires,
    );
    const visible = index.query({
      left: -100,
      top: -100,
      right: 900,
      bottom: 700,
    });
    const indexAndQueryMs = performance.now() - indexStart;

    expect(diagnostics.floatingPinIds.size).toBe(0);
    expect(visible.components.length).toBeLessThan(100);
    expect(visible.wires.length).toBeLessThan(100);
    // Deliberately generous ceilings catch accidental quadratic regressions without flaking CI.
    expect(diagnosticsMs).toBeLessThan(1_500);
    expect(indexAndQueryMs).toBeLessThan(500);
  });
});
