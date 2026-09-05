import { describe, expect, it } from "vitest";
import { deviceCapabilities, searchableDeviceText } from "../src/device-pack";
import type { EmbeddedDevicePack } from "../src/types";

const embedded = (kind: "spice" | "ibis", sdk = false): EmbeddedDevicePack => ({
  sha256: "a".repeat(64),
  pack: {
    manifest: {
      formatVersion: 1,
      id: "org.sugareda.test",
      name: "Test Pack",
      vendor: "SugarEDA Project",
      version: "1.0.0",
      source: "self",
      license: "CC0-1.0",
    },
    devices: [
      {
        id: "chip",
        name: "Fictional Chip",
        deviceType: "test-mcu",
        symbolId: "s",
        packageId: "p",
        variants: [],
        pins: [
          {
            id: "pa0",
            number: "A1",
            name: "PA0",
            group: "GPIO",
            electricalType: "bidirectional",
            direction: "bidirectional",
          },
        ],
        voltageDomains: [],
        alternateFunctions: [],
        differentialPairs: [],
        rules: [{ id: "required", kind: "required", pinIds: ["pa0"] }],
        modelIds: ["model"],
        sdkAdapterIds: sdk ? ["sdk"] : [],
      },
    ],
    symbols: [{ id: "s", name: "Symbol", units: [] }],
    packages: [{ id: "p", name: "Package", kind: "BGA", pads: ["A1"] }],
    models: [{ id: "model", kind, format: `${kind}-metadata`, metadata: {} }],
    sdkAdapters: sdk
      ? [
          {
            id: "sdk",
            sdkType: "metadata",
            versionRequirement: "1",
            localPathPatterns: [],
            metadata: {},
          },
        ]
      : [],
    documents: [],
  },
});

describe("DevicePack capabilities", () => {
  it("does not describe an IBIS-only chip as SPICE simulatable", () => {
    const caps = deviceCapabilities(embedded("ibis", true), "chip");
    expect(caps.find((cap) => cap.level === 1)?.available).toBe(true);
    expect(caps.find((cap) => cap.level === 2)?.available).toBe(true);
    expect(caps.find((cap) => cap.level === 3)?.available).toBe(false);
    expect(caps.find((cap) => cap.level === 4)?.available).toBe(true);
    expect(caps.find((cap) => cap.level === 5)?.available).toBe(true);
    expect(caps.find((cap) => cap.level === 6)?.available).toBe(false);
  });

  it("indexes vendor, type, pin group, name, and number", () => {
    const text = searchableDeviceText(embedded("spice"), "chip");
    for (const term of ["sugareda", "test-mcu", "fictional chip", "gpio", "a1"])
      expect(text).toContain(term);
  });
});
