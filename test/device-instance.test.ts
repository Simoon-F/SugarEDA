import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";
import { placeLocalDeviceUnit } from "@/device-unit-factory";
import {
  clipboardFromSelection,
  instantiateClipboard,
} from "@/selection-clipboard";
import { addLocalSchematicSheet } from "@/schematic-sheet";
import fixture from "../examples/devicepacks/test-mcu.devicepack.json";
import type { DevicePack } from "@/types";

describe("logical multi-unit devices", () => {
  it("shares identity and reference across units", () => {
    const project = createBlankSnapshot().project;
    project.devicePacks.push({
      sha256: "test-pack",
      pack: fixture as unknown as DevicePack,
    });
    expect(
      placeLocalDeviceUnit(project, {
        action: "addDeviceComponent",
        packSha256: "test-pack",
        deviceId: "stmcu24",
        variantId: "industrial",
        unitId: "core",
        logicalInstanceId: null,
        position: { x: 0, y: 0 },
      }),
    ).toBe(true);
    const logicalId = project.deviceInstances[0].id;
    expect(
      placeLocalDeviceUnit(project, {
        action: "addDeviceComponent",
        packSha256: "test-pack",
        deviceId: "stmcu24",
        variantId: "industrial",
        unitId: "io",
        logicalInstanceId: logicalId,
        position: { x: 300, y: 0 },
      }),
    ).toBe(true);
    expect(project.deviceInstances).toHaveLength(1);
    expect(project.sheets[0].components.map((item) => item.spiceRef)).toEqual([
      "U1",
      "U1",
    ]);
    expect(
      placeLocalDeviceUnit(project, {
        action: "addDeviceComponent",
        packSha256: "test-pack",
        deviceId: "stmcu24",
        variantId: "industrial",
        unitId: "core",
        logicalInstanceId: logicalId,
        position: { x: 600, y: 0 },
      }),
    ).toBe(false);
  });

  it("clones one new logical instance when shared units are copied", () => {
    const project = createBlankSnapshot().project;
    project.devicePacks.push({
      sha256: "test-pack",
      pack: fixture as unknown as DevicePack,
    });
    placeLocalDeviceUnit(project, {
      action: "addDeviceComponent",
      packSha256: "test-pack",
      deviceId: "stmcu24",
      variantId: "industrial",
      unitId: "core",
      logicalInstanceId: null,
      position: { x: 0, y: 0 },
    });
    const logicalId = project.deviceInstances[0].id;
    placeLocalDeviceUnit(project, {
      action: "addDeviceComponent",
      packSha256: "test-pack",
      deviceId: "stmcu24",
      variantId: "industrial",
      unitId: "io",
      logicalInstanceId: logicalId,
      position: { x: 300, y: 0 },
    });
    project.boardConfigurations.push({
      id: "config-original",
      logicalInstanceId: logicalId,
      sourceFormat: "json",
      sourceName: "test-mcu-valid.device-config.json",
      sourceSha256: "a".repeat(64),
      config: {
        formatVersion: 1,
        id: "org.sugareda.test.board",
        name: "Test board",
        source: "SugarEDA test fixture",
        license: "CC0-1.0",
        target: {
          packId: fixture.manifest.id,
          packVersion: fixture.manifest.version,
          deviceId: "stmcu24",
          variantId: "industrial",
        },
        pinMux: [],
        bootStraps: [],
        voltageSelections: [],
      },
    });
    const selected = new Set(
      project.sheets[0].components.map((component) => component.id),
    );
    const copied = clipboardFromSelection(project, selected);
    addLocalSchematicSheet(project, "Power");
    project.sheets[1].components.push({
      id: crypto.randomUUID(),
      kind: "resistor",
      position: { x: 0, y: 0 },
      rotation: 0,
      parameters: { value: "1k" },
      pins: [],
      displayName: "U2",
      spiceRef: "U2",
      model: null,
    });
    const pasted = instantiateClipboard(copied, project, {
      x: 20,
      y: 20,
    });
    expect(pasted.deviceInstances).toHaveLength(1);
    expect(new Set(pasted.components.map((item) => item.spiceRef))).toEqual(
      new Set(["U3"]),
    );
    expect(
      new Set(pasted.components.map((item) => item.device?.logicalInstanceId))
        .size,
    ).toBe(1);
    expect(pasted.boardConfigurations).toHaveLength(1);
    expect(pasted.boardConfigurations[0].id).not.toBe("config-original");
    expect(pasted.boardConfigurations[0].logicalInstanceId).toBe(
      pasted.deviceInstances[0].id,
    );
  });
});
