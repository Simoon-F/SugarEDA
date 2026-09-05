import { describe, expect, it } from "vitest";
import {
  addDevicePackPin,
  addVoltageDomain,
  createDevicePackDraft,
  removeDevicePackPin,
  removeVoltageDomain,
  setPinAlternateFunctions,
  setPinRule,
  updateDevicePackPin,
  updateVoltageDomain,
} from "../src/device-pack-authoring-draft";

describe("DevicePack authoring draft", () => {
  it("starts as a self-contained one-pin pack", () => {
    const pack = createDevicePackDraft();
    expect(pack.manifest.formatVersion).toBe(1);
    expect(pack.devices).toHaveLength(1);
    expect(pack.devices[0].pins).toHaveLength(1);
    expect(pack.packages[0].pads).toEqual(["1"]);
    expect(pack.symbols[0].units[0].groups).toEqual(["GENERAL"]);
  });

  it("keeps generated package pads and symbol groups synchronized", () => {
    let pack = addDevicePackPin(createDevicePackDraft());
    pack = updateDevicePackPin(pack, "pin2", {
      number: "A2",
      group: "POWER",
    });
    expect(pack.packages[0].pads).toEqual(["1", "A2"]);
    expect(pack.symbols[0].units[0].groups).toEqual(["GENERAL", "POWER"]);
    pack = removeDevicePackPin(pack, "pin1");
    expect(pack.packages[0].pads).toEqual(["A2"]);
  });

  it("cleans references when pins and voltage domains are removed", () => {
    let pack = addVoltageDomain(createDevicePackDraft());
    pack = updateVoltageDomain(pack, "vdd1", { id: "vddio" });
    pack = updateDevicePackPin(pack, "pin1", {
      voltageDomainId: "vddio",
    });
    pack = setPinAlternateFunctions(pack, "pin1", ["GPIO", "UART_TX"]);
    pack = setPinRule(pack, "pin1", "required", true);
    expect(pack.devices[0].alternateFunctions[0].functions).toEqual([
      "GPIO",
      "UART_TX",
    ]);
    pack = removeVoltageDomain(pack, "vddio");
    expect(pack.devices[0].pins[0].voltageDomainId).toBeNull();
    expect(pack.devices[0].voltageDomains).toEqual([]);
  });
});
