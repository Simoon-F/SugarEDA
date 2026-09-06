import type { DevicePack } from "./types";
import {
  authoredDevice,
  uniqueAuthoredId,
} from "./device-pack-authoring-scope";

export function addAuthoredDevice(pack: DevicePack): {
  pack: DevicePack;
  deviceId: string;
} {
  const ordinal = pack.devices.length + 1;
  const deviceId = uniqueAuthoredId(
    `device-${ordinal}`,
    pack.devices.map((device) => device.id),
  );
  const symbolId = uniqueAuthoredId(
    `${deviceId}-symbol`,
    pack.symbols.map((symbol) => symbol.id),
  );
  const packageId = uniqueAuthoredId(
    `${deviceId}-package`,
    pack.packages.map((item) => item.id),
  );
  return {
    deviceId,
    pack: {
      ...pack,
      devices: [
        ...pack.devices,
        {
          id: deviceId,
          name: `New device ${ordinal}`,
          deviceType: "integrated-circuit",
          symbolId,
          packageId,
          variants: [],
          pins: [defaultPin()],
          voltageDomains: [],
          alternateFunctions: [],
          differentialPairs: [],
          rules: [],
          configurationRules: [],
          modelIds: [],
          spiceBindings: [],
          sdkAdapterIds: [],
        },
      ],
      symbols: [
        ...pack.symbols,
        {
          id: symbolId,
          name: `Generated symbol ${ordinal}`,
          units: [{ id: "main", name: "Main", groups: ["GENERAL"] }],
        },
      ],
      packages: [
        ...pack.packages,
        {
          id: packageId,
          name: `Package ${ordinal}`,
          kind: "generic",
          pads: ["1"],
        },
      ],
    },
  };
}

export function removeAuthoredDevice(
  pack: DevicePack,
  deviceId: string,
): DevicePack {
  if (pack.devices.length <= 1) return pack;
  const removed = authoredDevice(pack, deviceId);
  const remaining = pack.devices.filter((device) => device.id !== deviceId);
  const referencedSymbols = new Set(remaining.map((device) => device.symbolId));
  const referencedPackages = new Set(
    remaining.map((device) => device.packageId),
  );
  const referencedModels = new Set(
    remaining.flatMap((device) => device.modelIds),
  );
  return {
    ...pack,
    devices: remaining,
    symbols: pack.symbols.filter(
      (symbol) =>
        symbol.id !== removed.symbolId || referencedSymbols.has(symbol.id),
    ),
    packages: pack.packages.filter(
      (item) =>
        item.id !== removed.packageId || referencedPackages.has(item.id),
    ),
    models: pack.models.filter(
      (model) =>
        !removed.modelIds.includes(model.id) || referencedModels.has(model.id),
    ),
  };
}

export function updateAuthoredPackage(
  pack: DevicePack,
  deviceId: string,
  patch: Partial<DevicePack["packages"][number]>,
): DevicePack {
  const device = authoredDevice(pack, deviceId);
  const current = pack.packages.find((item) => item.id === device.packageId);
  if (!current) return pack;
  const nextId = patch.id ?? current.id;
  return {
    ...pack,
    devices: pack.devices.map((candidate) =>
      candidate.id === deviceId
        ? {
            ...candidate,
            packageId: nextId,
            variants: candidate.variants.map((variant) =>
              variant.packageId === current.id
                ? { ...variant, packageId: nextId }
                : variant,
            ),
          }
        : candidate,
    ),
    packages: pack.packages.map((item) =>
      item.id === current.id ? { ...item, ...patch } : item,
    ),
  };
}

function defaultPin() {
  return {
    id: "pin1",
    number: "1",
    name: "PIN1",
    group: "GENERAL",
    electricalType: "passive" as const,
    direction: "passive",
    voltageDomainId: null,
  };
}
