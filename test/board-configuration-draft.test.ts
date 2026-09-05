import { describe, expect, it } from "vitest";
import {
  assignBootStrap,
  assignPinFunction,
  assignVoltage,
  boardConfigurationTargets,
  canonicalDraft,
  countDraftChanges,
  createBoardConfigurationDraft,
} from "../src/board-configuration-draft";
import { createBlankSnapshot } from "../src/blank";
import type { DevicePack, EmbeddedDevicePack, Project } from "../src/types";

function configurableProject(pinCount = 2): Project {
  const project = createBlankSnapshot().project;
  const pins = Array.from({ length: pinCount }, (_, index) => ({
    id: `pa${index}`,
    number: String(index + 1),
    name: `PA${index}`,
    group: index % 2 ? "UART" : "GPIO",
    electricalType: "bidirectional" as const,
    direction: "bidirectional",
    voltageDomainId: "vdd",
  }));
  const device: DevicePack["devices"][number] = {
    id: "fictional-mcu",
    name: "Fictional MCU",
    deviceType: "mcu",
    symbolId: "main",
    packageId: "qfp",
    variants: [{ id: "industrial", name: "Industrial" }],
    pins,
    voltageDomains: [
      { id: "vdd", name: "I/O supply", minVoltage: 1.8, maxVoltage: 3.6 },
    ],
    alternateFunctions: pins.map((pin, index) => ({
      pinId: pin.id,
      functions: [`GPIO_${index}`, `UART_${index}`],
    })),
    differentialPairs: [],
    rules: [{ id: "boot", kind: "bootConfiguration", pinIds: ["pa0"] }],
    configurationRules: [],
    modelIds: [],
    sdkAdapterIds: [],
  };
  const pack: EmbeddedDevicePack = {
    sha256: "a".repeat(64),
    pack: {
      manifest: {
        formatVersion: 1,
        id: "org.sugareda.test.editor",
        name: "Editor test pack",
        vendor: "SugarEDA Test Devices",
        version: "1.0.0",
        source: "Self-contained test",
        license: "CC0-1.0",
      },
      devices: [device],
      symbols: [{ id: "main", name: "Main", units: [] }],
      packages: [
        {
          id: "qfp",
          name: "Test QFP",
          kind: "qfp",
          pads: pins.map((pin) => pin.number),
        },
      ],
      models: [],
      sdkAdapters: [],
      documents: [],
    },
  };
  project.devicePacks.push(pack);
  project.deviceInstances.push({
    id: "11111111-1111-4111-8111-111111111111",
    packSha256: pack.sha256,
    packId: pack.pack.manifest.id,
    packVersion: pack.pack.manifest.version,
    deviceId: device.id,
    variantId: "industrial",
    reference: "U1",
    displayName: device.name,
    model: null,
    capabilities: [],
  });
  return project;
}

describe("visual board configuration draft", () => {
  it("derives targets and a vendor-neutral draft from embedded project data", () => {
    const target = boardConfigurationTargets(configurableProject())[0];
    const draft = createBoardConfigurationDraft(target);
    expect(draft.target).toEqual({
      packId: "org.sugareda.test.editor",
      packVersion: "1.0.0",
      deviceId: "fictional-mcu",
      variantId: "industrial",
    });
    expect(draft.source).toContain("SugarEDA");
    expect(draft.pinMux).toEqual([]);
  });

  it("updates assignments immutably and counts meaningful changes", () => {
    const baseline = createBoardConfigurationDraft(
      boardConfigurationTargets(configurableProject())[0],
    );
    const withMux = assignPinFunction(baseline, "pa1", "UART_1");
    const withBoot = assignBootStrap(withMux, "pa0", "pullDown");
    const withVoltage = assignVoltage(withBoot, "vdd", 3.3);
    expect(baseline.pinMux).toEqual([]);
    expect(countDraftChanges(baseline, withVoltage)).toBe(3);
    expect(canonicalDraft(withVoltage).pinMux[0]).toEqual({
      pinId: "pa1",
      function: "UART_1",
    });
    expect(assignPinFunction(withVoltage, "pa1", "").pinMux).toEqual([]);
  });

  it("handles a thousand-pin fictional target without scanning the canvas", () => {
    const project = configurableProject(1_000);
    const started = performance.now();
    const targets = boardConfigurationTargets(project);
    const draft = createBoardConfigurationDraft(targets[0]);
    const elapsed = performance.now() - started;
    expect(targets[0].device.alternateFunctions).toHaveLength(1_000);
    expect(draft.pinMux).toHaveLength(0);
    expect(elapsed).toBeLessThan(100);
  });
});
