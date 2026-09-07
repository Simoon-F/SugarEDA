import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "../src/blank";
import {
  activeSchematicSheet,
  addLocalSchematicSheet,
  deleteLocalSchematicSheet,
  renameLocalSchematicSheet,
  validSheetName,
} from "../src/schematic-sheet";

describe("schematic sheet lifecycle", () => {
  it("adds, selects, renames, and removes independent sheets", () => {
    const project = createBlankSnapshot().project;
    const first = project.sheets[0].id;
    addLocalSchematicSheet(project, "Power");
    const power = activeSchematicSheet(project);
    power.wires.push({
      id: crypto.randomUUID(),
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    });
    renameLocalSchematicSheet(project, power.id, "Power Rails");
    expect(project.sheets[0].id).toBe(first);
    expect(project.sheets[1].name).toBe("Power Rails");
    expect(project.sheets[1].wires).toHaveLength(1);
    deleteLocalSchematicSheet(project, power.id);
    expect(project.sheets).toHaveLength(1);
    expect(project.uiViewState.activeSheetId).toBe(first);
  });

  it("validates bounded unique names", () => {
    const project = createBlankSnapshot().project;
    expect(validSheetName(project, null, "Main")).toBe(false);
    expect(validSheetName(project, null, " Power ")).toBe(false);
    expect(validSheetName(project, null, "Power")).toBe(true);
  });
});
