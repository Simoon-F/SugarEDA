import { describe, expect, it } from "vitest";
import {
  addDeviceModel,
  addDifferentialPair,
  addDocument,
  addSymbolUnit,
  removeDeviceModel,
  updateSpicePort,
  updateSymbolUnit,
} from "../src/device-pack-authoring-advanced-draft";
import {
  addDevicePackPin,
  createDevicePackDraft,
  updateDevicePackPin,
} from "../src/device-pack-authoring-draft";

describe("advanced DevicePack authoring draft", () => {
  it("builds multi-unit and differential metadata without mutating the source", () => {
    const initial = updateDevicePackPin(
      addDevicePackPin(createDevicePackDraft()),
      "pin2",
      { group: "POWER" },
    );
    const withUnit = addSymbolUnit(initial);
    const result = addDifferentialPair(
      updateSymbolUnit(withUnit, "main", { groups: ["GENERAL"] }),
    );

    expect(initial.symbols[0].units).toHaveLength(1);
    expect(result.symbols[0].units).toHaveLength(2);
    expect(result.symbols[0].units[1].groups).toEqual(["POWER"]);
    expect(result.devices[0].differentialPairs[0]).toEqual({
      id: "diff1",
      positivePinId: "pin1",
      negativePinId: "pin2",
    });
  });

  it("preserves multi-unit structure while pin collections change", () => {
    const twoGroups = updateDevicePackPin(
      addDevicePackPin(createDevicePackDraft()),
      "pin2",
      { group: "POWER" },
    );
    const multiUnit = addSymbolUnit(twoGroups);
    const withNewPin = updateDevicePackPin(
      addDevicePackPin(multiUnit),
      "pin3",
      { group: "GPIO" },
    );

    expect(withNewPin.symbols[0].units).toHaveLength(2);
    expect(withNewPin.symbols[0].units[0].groups).toEqual(["GENERAL", "GPIO"]);
    expect(withNewPin.symbols[0].units[1].groups).toEqual(["POWER"]);
  });

  it("creates a complete default SPICE port map and propagates pin renames", () => {
    const twoPins = addDevicePackPin(createDevicePackDraft());
    const withModel = addDeviceModel(twoPins, "spice");
    const modelId = withModel.models[0].id;
    const remapped = updateSpicePort(withModel, modelId, "pin2", "OUT");
    const renamed = updateDevicePackPin(remapped, "pin2", { id: "output" });

    expect(renamed.models[0].embeddedContent).toContain(".subckt");
    expect(renamed.devices[0].modelIds).toEqual([modelId]);
    expect(renamed.devices[0].spiceBindings?.[0].ports).toEqual([
      { modelPort: "P1", pinId: "pin1" },
      { modelPort: "OUT", pinId: "output" },
    ]);
  });

  it("keeps capability references and documents consistent when removing a model", () => {
    const withModels = addDeviceModel(
      addDeviceModel(createDevicePackDraft(), "spice"),
      "ibis",
    );
    const withDocument = addDocument(withModels);
    const result = removeDeviceModel(withDocument, withModels.models[0].id);

    expect(result.models.map((model) => model.kind)).toEqual(["ibis"]);
    expect(result.devices[0].modelIds).toEqual([withModels.models[1].id]);
    expect(result.devices[0].spiceBindings).toEqual([]);
    expect(result.documents[0].license).toBe("LicenseRef-Author-Defined");
  });
});
