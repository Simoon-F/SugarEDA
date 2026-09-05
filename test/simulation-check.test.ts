import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";
import {
  availableProbeOptions,
  localSimulationCheck,
} from "@/simulation-check";

describe("simulation preflight", () => {
  it("offers probes from labeled networks and source currents", () => {
    const project = createBlankSnapshot().project;
    project.sheets[0].components.push(
      {
        id: crypto.randomUUID(),
        kind: "netLabel",
        position: { x: 100, y: 100 },
        rotation: 0,
        parameters: { value: "out" },
        pins: [{ id: "1", name: "NET", offset: { x: 0, y: 0 } }],
        displayName: "Net label",
        spiceRef: "",
      },
      {
        id: crypto.randomUUID(),
        kind: "voltageSource",
        position: { x: 200, y: 200 },
        rotation: 0,
        parameters: { value: "DC 5" },
        pins: [
          { id: "1", name: "+", offset: { x: 0, y: -30 } },
          { id: "2", name: "-", offset: { x: 0, y: 30 } },
        ],
        displayName: "V1",
        spiceRef: "V1",
      },
    );
    expect(availableProbeOptions(project)).toEqual(
      expect.arrayContaining([
        { value: "v(out)", label: "out", kind: "voltage" },
        { value: "i(v1)", label: "V1", kind: "current" },
      ]),
    );
  });

  it("groups actionable preflight failures into the five checks", () => {
    const project = createBlankSnapshot().project;
    const profile = project.simulationProfiles[0];
    const report = localSimulationCheck(project, profile);
    expect(report.ready).toBe(false);
    expect(report.checks.map((check) => check.category)).toEqual([
      "ground",
      "pins",
      "labels",
      "probes",
      "analysis",
    ]);
    expect(report.issues.some((issue) => issue.code === "missing_ground")).toBe(
      true,
    );
    expect(report.issues.some((issue) => issue.code === "unknown_probe")).toBe(
      true,
    );
  });
});
