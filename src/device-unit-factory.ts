import { deviceCapabilities } from "./device-pack";
import type { EditorCommand, Project } from "./types";
import { activeSchematicSheet } from "./schematic-sheet";

type AddDeviceCommand = Extract<
  EditorCommand,
  { action: "addDeviceComponent" }
>;

/** Browser-only fallback mirroring Rust's authoritative placement behavior. */
export function placeLocalDeviceUnit(
  project: Project,
  command: AddDeviceCommand,
): boolean {
  const activeSheet = activeSchematicSheet(project);
  const embedded = project.devicePacks.find(
    (pack) => pack.sha256 === command.packSha256,
  );
  const device = embedded?.pack.devices.find(
    (item) => item.id === command.deviceId,
  );
  const symbol = embedded?.pack.symbols.find(
    (item) => item.id === device?.symbolId,
  );
  const unit =
    symbol?.units.find((item) => item.id === command.unitId) ??
    symbol?.units[0];
  if (!embedded || !device) return false;

  const instance = command.logicalInstanceId
    ? project.deviceInstances.find(
        (item) => item.id === command.logicalInstanceId,
      )
    : undefined;
  if (
    command.logicalInstanceId &&
    (!instance ||
      instance.packSha256 !== command.packSha256 ||
      instance.deviceId !== command.deviceId ||
      (instance.variantId ?? null) !== command.variantId)
  )
    return false;
  if (
    instance &&
    project.sheets.some((sheet) =>
      sheet.components.some(
        (component) =>
          component.device?.logicalInstanceId === instance.id &&
          (component.device.symbolUnitId ?? null) === (unit?.id ?? null),
      ),
    )
  )
    return false;

  const sources = device.pins.filter(
    (pin) => !unit || !unit.groups.length || unit.groups.includes(pin.group),
  );
  if (!sources.length) return false;
  const left = sources.filter(
    (pin, index) =>
      ["input", "power"].includes(pin.direction) ||
      (index % 2 === 0 && ["passive", "bidirectional"].includes(pin.direction)),
  );
  const leftIds = new Set(left.map((pin) => pin.id));
  const right = sources.filter((pin) => !leftIds.has(pin.id));
  const halfWidth = sources.length > 40 ? 150 : 110;
  const domainById = new Map(
    device.voltageDomains.map((domain) => [domain.id, domain]),
  );
  const offset = (pin: (typeof sources)[number]) => {
    const side = leftIds.has(pin.id) ? left : right;
    const index = side.findIndex((item) => item.id === pin.id);
    return {
      x: leftIds.has(pin.id) ? -halfWidth : halfWidth,
      y: (index - (side.length - 1) / 2) * 20,
    };
  };
  const model = embedded.pack.models.find(
    (item) => item.kind === "spice" && device.modelIds.includes(item.id),
  );
  const library = model
    ? project.spiceLibraries.find(
        (item) =>
          item.sourceName === `devicepack:${embedded.sha256}:${model.id}`,
      )
    : undefined;
  const definition = library?.models.find(
    (item) => item.name === model?.modelName,
  );
  const prefix = definition ? "X" : "U";
  let sequence = 1;
  while (
    project.sheets
      .flatMap((sheet) => sheet.components)
      .some(
        (item) =>
          item.spiceRef.toLowerCase() === `${prefix}${sequence}`.toLowerCase(),
      )
  )
    sequence += 1;
  const reference = instance?.reference ?? `${prefix}${sequence}`;
  const logicalInstanceId = instance?.id ?? crypto.randomUUID();
  const capabilities = deviceCapabilities(embedded, device.id);
  const modelBinding = definition
    ? {
        libraryId: library!.id,
        modelName: definition.name,
        kind: definition.kind,
      }
    : null;

  if (!instance)
    project.deviceInstances.push({
      id: logicalInstanceId,
      packSha256: embedded.sha256,
      packId: embedded.pack.manifest.id,
      packVersion: embedded.pack.manifest.version,
      deviceId: device.id,
      variantId: command.variantId,
      reference,
      displayName: device.name,
      model: modelBinding,
      capabilities,
    });

  activeSheet.components.push({
    id: crypto.randomUUID(),
    kind: "device",
    position: command.position,
    rotation: 0,
    parameters: {},
    pins: sources.map((pin) => {
      const domain = pin.voltageDomainId
        ? domainById.get(pin.voltageDomainId)
        : undefined;
      const pair = device.differentialPairs.find(
        (item) =>
          item.positivePinId === pin.id || item.negativePinId === pin.id,
      );
      const rules = device.rules.filter((item) => item.pinIds.includes(pin.id));
      return {
        ...pin,
        offset: offset(pin),
        voltageMin: domain?.minVoltage,
        voltageMax: domain?.maxVoltage,
        alternateFunctions:
          device.alternateFunctions.find((item) => item.pinId === pin.id)
            ?.functions ?? [],
        differentialPairId: pair?.id,
        differentialPolarity: pair
          ? pair.positivePinId === pin.id
            ? ("positive" as const)
            : ("negative" as const)
          : null,
        required: rules.some(
          (item) => item.kind === "required" || item.kind === "powerInput",
        ),
        allowFloating:
          rules.some((item) => item.kind === "allowFloating") ||
          pin.direction === "notConnected",
        noConnect: false,
      };
    }),
    displayName: instance?.displayName ?? device.name,
    spiceRef: reference,
    model: instance?.model ?? modelBinding,
    device: {
      logicalInstanceId,
      packSha256: embedded.sha256,
      packId: embedded.pack.manifest.id,
      packVersion: embedded.pack.manifest.version,
      deviceId: device.id,
      variantId: command.variantId,
      symbolUnitId: unit?.id ?? null,
      capabilities,
    },
    symbolWidth: halfWidth * 2,
    symbolHeight: Math.max(left.length, right.length, 2) * 20 + 36,
  });
  return true;
}
