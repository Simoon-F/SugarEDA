import type { DevicePack } from "./types";

type DeviceDefinition = DevicePack["devices"][number];

export type DeviceConfigurationScope = {
  available: boolean;
  alternateFunctionCount: number;
  bootPinCount: number;
  ruleCount: number;
};

/** Derives L5 configuration-check scope from DevicePack data only. */
export function deviceConfigurationScope(
  device: DeviceDefinition,
): DeviceConfigurationScope {
  const bootPinCount = new Set(
    device.rules
      .filter((rule) => rule.kind === "bootConfiguration")
      .flatMap((rule) => rule.pinIds),
  ).size;
  const alternateFunctionCount = device.alternateFunctions.length;
  const ruleCount = device.configurationRules?.length ?? 0;
  return {
    available: alternateFunctionCount > 0 || bootPinCount > 0 || ruleCount > 0,
    alternateFunctionCount,
    bootPinCount,
    ruleCount,
  };
}
