import type { DevicePack, DevicePackPin, PinElectricalType } from "./types";

export function createDevicePackDraft(): DevicePack {
  return {
    manifest: {
      formatVersion: 1,
      id: "org.example.device-pack",
      name: "New DevicePack",
      vendor: "Independent device author",
      version: "1.0.0",
      source: "Original data entered by the DevicePack author",
      license: "LicenseRef-Author-Defined",
      description: "Vendor-neutral SugarEDA DevicePack",
    },
    devices: [
      {
        id: "device",
        name: "New device",
        deviceType: "integrated-circuit",
        symbolId: "symbol",
        packageId: "package",
        variants: [],
        pins: [defaultPin(1)],
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
      {
        id: "symbol",
        name: "Generated symbol",
        units: [{ id: "main", name: "Main", groups: ["GENERAL"] }],
      },
    ],
    packages: [
      { id: "package", name: "Package", kind: "generic", pads: ["1"] },
    ],
    models: [],
    sdkAdapters: [],
    documents: [],
  };
}

export function addDevicePackPin(pack: DevicePack): DevicePack {
  const usedNumbers = new Set(pack.devices[0].pins.map((pin) => pin.number));
  let number = pack.devices[0].pins.length + 1;
  while (usedNumbers.has(String(number))) number += 1;
  return replacePins(pack, [...pack.devices[0].pins, defaultPin(number)]);
}

export function updateDevicePackPin(
  pack: DevicePack,
  pinId: string,
  patch: Partial<DevicePackPin>,
): DevicePack {
  return replacePins(
    pack,
    pack.devices[0].pins.map((pin) =>
      pin.id === pinId ? { ...pin, ...patch } : pin,
    ),
  );
}

export function removeDevicePackPin(
  pack: DevicePack,
  pinId: string,
): DevicePack {
  if (pack.devices[0].pins.length <= 1) return pack;
  return replacePins(
    pack,
    pack.devices[0].pins.filter((pin) => pin.id !== pinId),
  );
}

export function setPinAlternateFunctions(
  pack: DevicePack,
  pinId: string,
  functions: string[],
): DevicePack {
  const clean = [
    ...new Set(functions.map((item) => item.trim()).filter(Boolean)),
  ];
  const device = pack.devices[0];
  return replaceDevice(pack, {
    ...device,
    alternateFunctions: [
      ...device.alternateFunctions.filter((item) => item.pinId !== pinId),
      ...(clean.length ? [{ pinId, functions: clean }] : []),
    ],
  });
}

export function setPinRule(
  pack: DevicePack,
  pinId: string,
  kind: string,
  enabled: boolean,
): DevicePack {
  const device = pack.devices[0];
  const ruleId = `author-${kind}`;
  const current = device.rules.find((rule) => rule.id === ruleId);
  const pinIds = new Set(current?.pinIds ?? []);
  if (enabled) pinIds.add(pinId);
  else pinIds.delete(pinId);
  return replaceDevice(pack, {
    ...device,
    rules: [
      ...device.rules.filter((rule) => rule.id !== ruleId),
      ...(pinIds.size
        ? [{ id: ruleId, kind, pinIds: [...pinIds].sort(), message: "" }]
        : []),
    ],
  });
}

export function addVoltageDomain(pack: DevicePack): DevicePack {
  const device = pack.devices[0];
  let suffix = device.voltageDomains.length + 1;
  while (device.voltageDomains.some((domain) => domain.id === `vdd${suffix}`))
    suffix += 1;
  return replaceDevice(pack, {
    ...device,
    voltageDomains: [
      ...device.voltageDomains,
      {
        id: `vdd${suffix}`,
        name: `Supply domain ${suffix}`,
        minVoltage: 1.8,
        maxVoltage: 3.3,
      },
    ],
  });
}

export function removeVoltageDomain(
  pack: DevicePack,
  domainId: string,
): DevicePack {
  const device = pack.devices[0];
  return replaceDevice(pack, {
    ...device,
    pins: device.pins.map((pin) =>
      pin.voltageDomainId === domainId
        ? { ...pin, voltageDomainId: null }
        : pin,
    ),
    voltageDomains: device.voltageDomains.filter(
      (domain) => domain.id !== domainId,
    ),
  });
}

export function updateVoltageDomain(
  pack: DevicePack,
  domainId: string,
  patch: Partial<DevicePack["devices"][number]["voltageDomains"][number]>,
): DevicePack {
  const device = pack.devices[0];
  return replaceDevice(pack, {
    ...device,
    voltageDomains: device.voltageDomains.map((domain) =>
      domain.id === domainId ? { ...domain, ...patch } : domain,
    ),
    pins:
      patch.id && patch.id !== domainId
        ? device.pins.map((pin) =>
            pin.voltageDomainId === domainId
              ? { ...pin, voltageDomainId: patch.id }
              : pin,
          )
        : device.pins,
  });
}

export function updatePrimaryDevice(
  pack: DevicePack,
  patch: Partial<DevicePack["devices"][number]>,
): DevicePack {
  return replaceDevice(pack, { ...pack.devices[0], ...patch });
}

const defaultPin = (number: number): DevicePackPin => ({
  id: `pin${number}`,
  number: String(number),
  name: `PIN${number}`,
  group: "GENERAL",
  electricalType: "passive" as PinElectricalType,
  direction: "passive",
  voltageDomainId: null,
});

function replacePins(pack: DevicePack, pins: DevicePackPin[]): DevicePack {
  const pinIds = new Set(pins.map((pin) => pin.id));
  const device = pack.devices[0];
  return syncGeneratedReferences(
    replaceDevice(pack, {
      ...device,
      pins,
      alternateFunctions: device.alternateFunctions.filter((item) =>
        pinIds.has(item.pinId),
      ),
      rules: device.rules
        .map((rule) => ({
          ...rule,
          pinIds: rule.pinIds.filter((id) => pinIds.has(id)),
        }))
        .filter((rule) => rule.pinIds.length),
      differentialPairs: device.differentialPairs.filter(
        (pair) =>
          pinIds.has(pair.positivePinId) && pinIds.has(pair.negativePinId),
      ),
    }),
  );
}

function replaceDevice(
  pack: DevicePack,
  device: DevicePack["devices"][number],
): DevicePack {
  return { ...pack, devices: [device, ...pack.devices.slice(1)] };
}

function syncGeneratedReferences(pack: DevicePack): DevicePack {
  const device = pack.devices[0];
  const groups = [...new Set(device.pins.map((pin) => pin.group))];
  return {
    ...pack,
    symbols: pack.symbols.map((symbol) =>
      symbol.id === device.symbolId
        ? {
            ...symbol,
            units: [{ id: "main", name: "Main", groups }],
          }
        : symbol,
    ),
    packages: pack.packages.map((item) =>
      item.id === device.packageId
        ? { ...item, pads: device.pins.map((pin) => pin.number) }
        : item,
    ),
  };
}
