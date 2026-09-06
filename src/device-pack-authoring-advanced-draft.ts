import type { DevicePack } from "./types";

type SymbolUnit = DevicePack["symbols"][number]["units"][number];
type DifferentialPair =
  DevicePack["devices"][number]["differentialPairs"][number];
type DeviceModel = DevicePack["models"][number];
type DocumentMetadata = DevicePack["documents"][number];

export function addSymbolUnit(pack: DevicePack): DevicePack {
  const symbol = primarySymbol(pack);
  let suffix = symbol.units.length + 1;
  while (symbol.units.some((unit) => unit.id === `unit${suffix}`)) suffix += 1;
  const assigned = new Set(symbol.units.flatMap((unit) => unit.groups));
  const groups = unique(pack.devices[0].pins.map((pin) => pin.group));
  const firstUnassigned = groups.find((group) => !assigned.has(group));
  const splitGroup =
    firstUnassigned ??
    (symbol.units.length === 1 && groups.length > 1
      ? groups[groups.length - 1]
      : groups[0]);
  const existingUnits =
    !firstUnassigned && symbol.units.length === 1 && groups.length > 1
      ? symbol.units.map((unit) => ({
          ...unit,
          groups: unit.groups.filter((group) => group !== splitGroup),
        }))
      : symbol.units;
  return replacePrimarySymbol(pack, {
    ...symbol,
    units: [
      ...existingUnits,
      {
        id: `unit${suffix}`,
        name: `Unit ${suffix}`,
        groups: splitGroup ? [splitGroup] : [],
      },
    ],
  });
}

export function updateSymbolUnit(
  pack: DevicePack,
  unitId: string,
  patch: Partial<SymbolUnit>,
): DevicePack {
  const symbol = primarySymbol(pack);
  return replacePrimarySymbol(pack, {
    ...symbol,
    units: symbol.units.map((unit) =>
      unit.id === unitId ? { ...unit, ...patch } : unit,
    ),
  });
}

export function removeSymbolUnit(pack: DevicePack, unitId: string): DevicePack {
  const symbol = primarySymbol(pack);
  if (symbol.units.length <= 1) return pack;
  return replacePrimarySymbol(pack, {
    ...symbol,
    units: symbol.units.filter((unit) => unit.id !== unitId),
  });
}

export function addDifferentialPair(pack: DevicePack): DevicePack {
  const device = pack.devices[0];
  if (device.pins.length < 2) return pack;
  let suffix = device.differentialPairs.length + 1;
  while (device.differentialPairs.some((pair) => pair.id === `diff${suffix}`))
    suffix += 1;
  return replacePrimaryDevice(pack, {
    ...device,
    differentialPairs: [
      ...device.differentialPairs,
      {
        id: `diff${suffix}`,
        positivePinId: device.pins[0].id,
        negativePinId: device.pins[1].id,
      },
    ],
  });
}

export function updateDifferentialPair(
  pack: DevicePack,
  pairId: string,
  patch: Partial<DifferentialPair>,
): DevicePack {
  const device = pack.devices[0];
  return replacePrimaryDevice(pack, {
    ...device,
    differentialPairs: device.differentialPairs.map((pair) =>
      pair.id === pairId ? { ...pair, ...patch } : pair,
    ),
  });
}

export function removeDifferentialPair(
  pack: DevicePack,
  pairId: string,
): DevicePack {
  const device = pack.devices[0];
  return replacePrimaryDevice(pack, {
    ...device,
    differentialPairs: device.differentialPairs.filter(
      (pair) => pair.id !== pairId,
    ),
  });
}

export function addDeviceModel(
  pack: DevicePack,
  kind: DeviceModel["kind"],
): DevicePack {
  let suffix = pack.models.length + 1;
  while (pack.models.some((model) => model.id === `${kind}-model-${suffix}`))
    suffix += 1;
  const id = `${kind}-model-${suffix}`;
  const device = pack.devices[0];
  const model: DeviceModel = {
    id,
    kind,
    format:
      kind === "spice"
        ? "spice-subcircuit"
        : kind === "ibis"
          ? "ibis-metadata"
          : "touchstone-metadata",
    modelName: kind === "spice" ? `SUGAR_MODEL_${suffix}` : null,
    embeddedContent:
      kind === "spice"
        ? defaultSpiceContent(`SUGAR_MODEL_${suffix}`, device.pins.length)
        : null,
    sha256: null,
    metadata: {
      purpose: "Author-provided model metadata",
      license: "LicenseRef-Author-Defined",
    },
  };
  const nextDevice = {
    ...device,
    modelIds: [...device.modelIds, id],
    spiceBindings:
      kind === "spice"
        ? [
            ...(device.spiceBindings ?? []),
            {
              modelId: id,
              ports: device.pins.map((pin, index) => ({
                modelPort: `P${index + 1}`,
                pinId: pin.id,
              })),
            },
          ]
        : device.spiceBindings,
  };
  return {
    ...replacePrimaryDevice(pack, nextDevice),
    models: [...pack.models, model],
  };
}

export function updateDeviceModel(
  pack: DevicePack,
  modelId: string,
  patch: Partial<DeviceModel>,
): DevicePack {
  const nextId = patch.id ?? modelId;
  const device = pack.devices[0];
  return {
    ...replacePrimaryDevice(pack, {
      ...device,
      modelIds: device.modelIds.map((id) => (id === modelId ? nextId : id)),
      spiceBindings: (device.spiceBindings ?? []).map((binding) =>
        binding.modelId === modelId ? { ...binding, modelId: nextId } : binding,
      ),
    }),
    models: pack.models.map((model) =>
      model.id === modelId ? { ...model, ...patch } : model,
    ),
  };
}

export function updateDeviceModelMetadata(
  pack: DevicePack,
  modelId: string,
  key: string,
  value: string,
): DevicePack {
  const model = pack.models.find((candidate) => candidate.id === modelId);
  if (!model) return pack;
  return updateDeviceModel(pack, modelId, {
    metadata: { ...model.metadata, [key]: value },
  });
}

export function updateSpicePort(
  pack: DevicePack,
  modelId: string,
  pinId: string,
  modelPort: string,
): DevicePack {
  const device = pack.devices[0];
  return replacePrimaryDevice(pack, {
    ...device,
    spiceBindings: (device.spiceBindings ?? []).map((binding) =>
      binding.modelId === modelId
        ? {
            ...binding,
            ports: binding.ports.map((port) =>
              port.pinId === pinId ? { ...port, modelPort } : port,
            ),
          }
        : binding,
    ),
  });
}

export function removeDeviceModel(
  pack: DevicePack,
  modelId: string,
): DevicePack {
  const device = pack.devices[0];
  return {
    ...replacePrimaryDevice(pack, {
      ...device,
      modelIds: device.modelIds.filter((id) => id !== modelId),
      spiceBindings: (device.spiceBindings ?? []).filter(
        (binding) => binding.modelId !== modelId,
      ),
    }),
    models: pack.models.filter((model) => model.id !== modelId),
  };
}

export function addDocument(pack: DevicePack): DevicePack {
  const suffix = pack.documents.length + 1;
  return {
    ...pack,
    documents: [
      ...pack.documents,
      {
        kind: "datasheet",
        title: `Device document ${suffix}`,
        sourceUrl: `https://example.invalid/device-document-${suffix}`,
        revision: "1.0",
        license: "LicenseRef-Author-Defined",
      },
    ],
  };
}

export function updateDocument(
  pack: DevicePack,
  index: number,
  patch: Partial<DocumentMetadata>,
): DevicePack {
  return {
    ...pack,
    documents: pack.documents.map((document, current) =>
      current === index ? { ...document, ...patch } : document,
    ),
  };
}

export function removeDocument(pack: DevicePack, index: number): DevicePack {
  return {
    ...pack,
    documents: pack.documents.filter((_, current) => current !== index),
  };
}

function primarySymbol(pack: DevicePack) {
  return (
    pack.symbols.find((symbol) => symbol.id === pack.devices[0].symbolId) ??
    pack.symbols[0]
  );
}

function replacePrimarySymbol(
  pack: DevicePack,
  symbol: DevicePack["symbols"][number],
): DevicePack {
  return {
    ...pack,
    symbols: pack.symbols.map((candidate) =>
      candidate.id === symbol.id ? symbol : candidate,
    ),
  };
}

function replacePrimaryDevice(
  pack: DevicePack,
  device: DevicePack["devices"][number],
): DevicePack {
  return { ...pack, devices: [device, ...pack.devices.slice(1)] };
}

function defaultSpiceContent(modelName: string, pinCount: number): string {
  const ports = Array.from({ length: pinCount }, (_, index) => `P${index + 1}`);
  const first = ports[0] ?? "P1";
  const second = ports[1] ?? "0";
  return `* SugarEDA author-provided model\n.subckt ${modelName} ${ports.join(" ")}\nRLEAK ${first} ${second} 1T\n.ends ${modelName}\n`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
