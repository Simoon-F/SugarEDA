import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";
import {
  createLocalConnector,
  createLocalSheetInstance,
  synchronizeLocalSheetInstances,
} from "@/hierarchy";
import { addLocalSchematicSheet } from "@/schematic-sheet";
import { clipboardFromSelection } from "@/selection-clipboard";

describe("schematic hierarchy", () => {
  it("synchronizes stable child ports into a sheet instance", () => {
    const project = createBlankSnapshot().project;
    const root = project.sheets[0].id;
    addLocalSchematicSheet(project, "Power");
    const child = project.sheets[1];
    const port = createLocalConnector("hierarchicalPort", { x: 20, y: 20 });
    port.parameters.value = "VIN";
    port.parameters.direction = "input";
    child.components.push(port);
    project.uiViewState.activeSheetId = root;
    expect(
      createLocalSheetInstance(project, child.id, { x: 200, y: 200 }),
    ).toBe(true);
    const instance = project.sheets[0].components[0];
    expect(instance.kind).toBe("sheetInstance");
    expect(instance.pins).toMatchObject([
      { id: port.id, name: "VIN", direction: "input" },
    ]);

    port.parameters.value = "POWER_IN";
    synchronizeLocalSheetInstances(project);
    expect(instance.pins[0].name).toBe("POWER_IN");
  });

  it("rejects duplicate targets and hierarchy cycles", () => {
    const project = createBlankSnapshot().project;
    const root = project.sheets[0].id;
    addLocalSchematicSheet(project, "Child");
    const child = project.sheets[1].id;
    project.uiViewState.activeSheetId = root;
    expect(createLocalSheetInstance(project, child, { x: 0, y: 0 })).toBe(true);
    expect(createLocalSheetInstance(project, child, { x: 100, y: 0 })).toBe(
      false,
    );
    project.uiViewState.activeSheetId = child;
    expect(createLocalSheetInstance(project, root, { x: 0, y: 0 })).toBe(false);
  });

  it("does not copy a single-owner sheet instance", () => {
    const project = createBlankSnapshot().project;
    const root = project.sheets[0].id;
    addLocalSchematicSheet(project, "Child");
    const child = project.sheets[1].id;
    project.uiViewState.activeSheetId = root;
    expect(createLocalSheetInstance(project, child, { x: 0, y: 0 })).toBe(true);
    const instance = project.sheets[0].components[0];
    const clipboard = clipboardFromSelection(project, new Set([instance.id]));
    expect(clipboard.components).toEqual([]);
  });
});
