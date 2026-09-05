import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";
import {
  deviceConfigCanvasInstances,
  locateDeviceConfigIssue,
} from "@/device-config-location";
import { placeLocalDeviceUnit } from "@/device-unit-factory";
import fixture from "../examples/devicepacks/test-mcu.devicepack.json";
import type { DevicePack } from "@/types";

describe("device configuration canvas location", () => {
  it("maps a diagnostic pin to the unit that exposes it", () => {
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
    const instanceId = project.deviceInstances[0].id;
    placeLocalDeviceUnit(project, {
      action: "addDeviceComponent",
      packSha256: "test-pack",
      deviceId: "stmcu24",
      variantId: "industrial",
      unitId: "io",
      logicalInstanceId: instanceId,
      position: { x: 300, y: 0 },
    });

    const instances = deviceConfigCanvasInstances(
      project,
      "test-pack",
      "stmcu24",
    );
    expect(instances).toHaveLength(1);
    const ioComponent = project.sheets[0].components.find(
      (component) => component.device?.symbolUnitId === "io",
    );
    expect(locateDeviceConfigIssue(instances, instanceId, "pa0")).toBe(
      ioComponent?.id,
    );
  });

  it("does not claim a location when the required unit is not placed", () => {
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
    const instances = deviceConfigCanvasInstances(
      project,
      "test-pack",
      "stmcu24",
    );
    expect(
      locateDeviceConfigIssue(instances, instances[0].id, "pa0"),
    ).toBeNull();
  });
});
