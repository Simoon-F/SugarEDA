import { describe, expect, it } from "vitest";
import { deviceConfigurationScope } from "../src/device-configuration";
import type { DevicePack } from "../src/types";

const device = (
  alternateFunctions: DevicePack["devices"][number]["alternateFunctions"],
  rules: DevicePack["devices"][number]["rules"],
  configurationRules: NonNullable<
    DevicePack["devices"][number]["configurationRules"]
  > = [],
): DevicePack["devices"][number] => ({
  id: "test",
  name: "Test",
  deviceType: "test",
  symbolId: "symbol",
  packageId: "package",
  variants: [],
  pins: [],
  voltageDomains: [],
  alternateFunctions,
  differentialPairs: [],
  rules,
  configurationRules,
  modelIds: [],
  sdkAdapterIds: [],
});

describe("device configuration scope", () => {
  it("is available for PinMux metadata without an SDK adapter", () => {
    const scope = deviceConfigurationScope(
      device([{ pinId: "pa0", functions: ["UART1_TX"] }], []),
    );
    expect(scope).toEqual({
      available: true,
      alternateFunctionCount: 1,
      bootPinCount: 0,
      ruleCount: 0,
    });
  });

  it("deduplicates boot pins across rules", () => {
    const scope = deviceConfigurationScope(
      device(
        [],
        [
          { id: "boot-a", kind: "bootConfiguration", pinIds: ["boot0"] },
          {
            id: "boot-b",
            kind: "bootConfiguration",
            pinIds: ["boot0", "boot1"],
          },
        ],
      ),
    );
    expect(scope.available).toBe(true);
    expect(scope.bootPinCount).toBe(2);
  });

  it("stays unavailable for electrical rules alone", () => {
    const scope = deviceConfigurationScope(
      device([], [{ id: "power", kind: "powerInput", pinIds: ["vdd"] }]),
    );
    expect(scope.available).toBe(false);
  });

  it("is available when the pack declares structured configuration rules", () => {
    const scope = deviceConfigurationScope(
      device(
        [],
        [],
        [
          {
            id: "supply",
            kind: "requiredVoltageDomains",
            voltageDomainIds: ["vddio"],
          },
        ],
      ),
    );
    expect(scope.available).toBe(true);
    expect(scope.ruleCount).toBe(1);
  });
});
