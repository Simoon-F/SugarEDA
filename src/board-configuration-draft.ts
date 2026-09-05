import { deviceConfigurationScope } from "./device-configuration";
import type {
  BoardConfiguration,
  DeviceConfigurationData,
  DeviceInstance,
  DevicePack,
  EmbeddedDevicePack,
  Project,
} from "./types";

export type BoardConfigurationTarget = {
  instance: DeviceInstance;
  embeddedPack: EmbeddedDevicePack;
  device: DevicePack["devices"][number];
  configuration: BoardConfiguration | null;
};

export function boardConfigurationTargets(
  project: Project,
): BoardConfigurationTarget[] {
  return project.deviceInstances.flatMap((instance) => {
    const embeddedPack = project.devicePacks.find(
      (pack) => pack.sha256 === instance.packSha256,
    );
    const device = embeddedPack?.pack.devices.find(
      (candidate) => candidate.id === instance.deviceId,
    );
    if (!embeddedPack || !device || !deviceConfigurationScope(device).available)
      return [];
    return [
      {
        instance,
        embeddedPack,
        device,
        configuration:
          project.boardConfigurations.find(
            (configuration) => configuration.logicalInstanceId === instance.id,
          ) ?? null,
      },
    ];
  });
}

export function createBoardConfigurationDraft(
  target: BoardConfigurationTarget,
): DeviceConfigurationData {
  if (target.configuration) return structuredClone(target.configuration.config);
  return {
    formatVersion: 1,
    id: `project.${target.instance.id}`,
    name: `${target.instance.reference} board configuration`,
    source: "Created with the SugarEDA visual board configuration editor",
    license: "LicenseRef-Project",
    target: {
      packId: target.instance.packId,
      packVersion: target.instance.packVersion,
      deviceId: target.instance.deviceId,
      variantId: target.instance.variantId ?? null,
    },
    pinMux: [],
    bootStraps: [],
    voltageSelections: [],
  };
}

export function assignPinFunction(
  draft: DeviceConfigurationData,
  pinId: string,
  selectedFunction: string,
): DeviceConfigurationData {
  return {
    ...draft,
    pinMux: [
      ...draft.pinMux.filter((assignment) => assignment.pinId !== pinId),
      ...(selectedFunction ? [{ pinId, function: selectedFunction }] : []),
    ],
  };
}

export function assignBootStrap(
  draft: DeviceConfigurationData,
  pinId: string,
  value: DeviceConfigurationData["bootStraps"][number]["value"] | "",
): DeviceConfigurationData {
  return {
    ...draft,
    bootStraps: [
      ...draft.bootStraps.filter((strap) => strap.pinId !== pinId),
      ...(value ? [{ pinId, value }] : []),
    ],
  };
}

export function assignVoltage(
  draft: DeviceConfigurationData,
  domainId: string,
  voltage: number | null,
): DeviceConfigurationData {
  return {
    ...draft,
    voltageSelections: [
      ...draft.voltageSelections.filter(
        (selection) => selection.domainId !== domainId,
      ),
      ...(voltage !== null && Number.isFinite(voltage)
        ? [{ domainId, voltage }]
        : []),
    ],
  };
}

export function canonicalDraft(
  draft: DeviceConfigurationData,
): DeviceConfigurationData {
  return {
    ...draft,
    pinMux: [...draft.pinMux].sort((a, b) => a.pinId.localeCompare(b.pinId)),
    bootStraps: [...draft.bootStraps].sort((a, b) =>
      a.pinId.localeCompare(b.pinId),
    ),
    voltageSelections: [...draft.voltageSelections].sort((a, b) =>
      a.domainId.localeCompare(b.domainId),
    ),
  };
}

export const draftSignature = (draft: DeviceConfigurationData) =>
  JSON.stringify(canonicalDraft(draft));

export function countDraftChanges(
  baseline: DeviceConfigurationData,
  draft: DeviceConfigurationData,
): number {
  const before = canonicalDraft(baseline);
  const after = canonicalDraft(draft);
  let changes = 0;
  if (before.name !== after.name) changes += 1;
  if (before.source !== after.source) changes += 1;
  if (before.license !== after.license) changes += 1;
  const countMapChanges = <T>(
    left: T[],
    right: T[],
    key: (value: T) => string,
  ) => {
    const leftMap = new Map(left.map((value) => [key(value), value]));
    const rightMap = new Map(right.map((value) => [key(value), value]));
    return new Set([...leftMap.keys(), ...rightMap.keys()]).size === 0
      ? 0
      : [...new Set([...leftMap.keys(), ...rightMap.keys()])].filter(
          (item) =>
            JSON.stringify(leftMap.get(item)) !==
            JSON.stringify(rightMap.get(item)),
        ).length;
  };
  changes += countMapChanges(before.pinMux, after.pinMux, (item) => item.pinId);
  changes += countMapChanges(
    before.bootStraps,
    after.bootStraps,
    (item) => item.pinId,
  );
  changes += countMapChanges(
    before.voltageSelections,
    after.voltageSelections,
    (item) => item.domainId,
  );
  return changes;
}
