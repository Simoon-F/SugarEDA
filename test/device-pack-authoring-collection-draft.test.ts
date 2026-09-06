import { describe, expect, it } from "vitest";
import {
  addAuthoredDevice,
  removeAuthoredDevice,
  updateAuthoredPackage,
} from "../src/device-pack-authoring-collection-draft";
import {
  addDevicePackPin,
  createDevicePackDraft,
  updateDevicePackPin,
} from "../src/device-pack-authoring-draft";
import { addDeviceModel } from "../src/device-pack-authoring-advanced-draft";

describe("multi-device DevicePack authoring", () => {
  it("keeps symbol, package, pin, and model scopes independent", () => {
    const initial = createDevicePackDraft();
    const added = addAuthoredDevice(initial);
    let pack = addDevicePackPin(added.pack, added.deviceId);
    pack = updateDevicePackPin(
      pack,
      "pin2",
      { number: "B2", group: "GPIO" },
      added.deviceId,
    );
    pack = addDeviceModel(pack, "spice", added.deviceId);

    expect(pack.devices[0].pins).toHaveLength(1);
    expect(pack.devices[0].modelIds).toEqual([]);
    expect(pack.devices[1].pins).toHaveLength(2);
    expect(
      pack.packages.find((item) => item.id === pack.devices[1].packageId)?.pads,
    ).toEqual(["1", "B2"]);
    expect(
      pack.symbols.find((item) => item.id === pack.devices[1].symbolId)
        ?.units[0].groups,
    ).toEqual(["GENERAL", "GPIO"]);
  });

  it("renames package references and removes only selected device resources", () => {
    const added = addAuthoredDevice(createDevicePackDraft());
    const renamed = updateAuthoredPackage(added.pack, added.deviceId, {
      id: "qfn-32",
      name: "QFN-32",
    });
    expect(renamed.devices[1].packageId).toBe("qfn-32");
    expect(renamed.packages[1].name).toBe("QFN-32");

    const removed = removeAuthoredDevice(renamed, added.deviceId);
    expect(removed.devices).toHaveLength(1);
    expect(removed.symbols).toHaveLength(1);
    expect(removed.packages).toHaveLength(1);
  });
});
