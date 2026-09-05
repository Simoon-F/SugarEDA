import type { DevicePackCapability, EmbeddedDevicePack } from "./types";

/** UI capability labels are derived from pack data and never inferred from a product name. */
export function deviceCapabilities(
  pack: EmbeddedDevicePack,
  deviceId: string,
): DevicePackCapability[] {
  const device = pack.pack.devices.find((item) => item.id === deviceId);
  if (!device) return [];
  const models = pack.pack.models.filter((model) =>
    device.modelIds.includes(model.id),
  );
  return [
    { level: 1, code: "schematic", available: true },
    {
      level: 2,
      code: "erc",
      available:
        device.rules.length > 0 ||
        device.pins.some((pin) => pin.electricalType !== "passive"),
    },
    {
      level: 3,
      code: "spice",
      available: models.some((model) => model.kind === "spice"),
    },
    {
      level: 4,
      code: "signalIntegrityMetadata",
      available: models.some(
        (model) => model.kind === "ibis" || model.kind === "sParameter",
      ),
    },
    {
      level: 5,
      code: "sdkAdapterMetadata",
      available: device.sdkAdapterIds.length > 0,
    },
    { level: 6, code: "firmwareSimulation", available: false },
  ];
}

export function searchableDeviceText(
  pack: EmbeddedDevicePack,
  deviceId: string,
) {
  const device = pack.pack.devices.find((item) => item.id === deviceId);
  return device
    ? [
        pack.pack.manifest.name,
        pack.pack.manifest.vendor,
        device.id,
        device.name,
        device.deviceType,
        ...device.pins.flatMap((pin) => [pin.name, pin.number, pin.group]),
      ]
        .join(" ")
        .toLocaleLowerCase()
    : "";
}
