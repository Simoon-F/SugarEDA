import type { Project } from "./types";

export type DeviceConfigCanvasUnit = {
  componentId: string;
  unitId: string | null;
  pinIds: string[];
};

export type DeviceConfigCanvasInstance = {
  id: string;
  reference: string;
  displayName: string;
  units: DeviceConfigCanvasUnit[];
};

export function deviceConfigCanvasInstances(
  project: Project,
  packSha256: string,
  deviceId: string,
): DeviceConfigCanvasInstance[] {
  return project.deviceInstances
    .filter(
      (instance) =>
        instance.packSha256 === packSha256 && instance.deviceId === deviceId,
    )
    .map((instance) => ({
      id: instance.id,
      reference: instance.reference,
      displayName: instance.displayName,
      units: project.sheets.flatMap((sheet) =>
        sheet.components
          .filter(
            (component) => component.device?.logicalInstanceId === instance.id,
          )
          .map((component) => ({
            componentId: component.id,
            unitId: component.device?.symbolUnitId ?? null,
            pinIds: component.pins.map((pin) => pin.id),
          })),
      ),
    }))
    .filter((instance) => instance.units.length > 0);
}

export function locateDeviceConfigIssue(
  instances: DeviceConfigCanvasInstance[],
  instanceId: string,
  pinId?: string | null,
): string | null {
  const instance = instances.find((item) => item.id === instanceId);
  if (!instance) return null;
  if (pinId) {
    return (
      instance.units.find((unit) => unit.pinIds.includes(pinId))?.componentId ??
      null
    );
  }
  return instance.units[0]?.componentId ?? null;
}
