import type { DeviceInstance, Project } from "./types";

export function compatibleDeviceInstances(
  project: Project,
  packSha256: string,
  deviceId: string,
  variantId: string | null,
): DeviceInstance[] {
  return project.deviceInstances.filter(
    (instance) =>
      instance.packSha256 === packSha256 &&
      instance.deviceId === deviceId &&
      (instance.variantId ?? null) === variantId,
  );
}

export function placedUnitIds(project: Project, instanceId: string) {
  return new Set(
    project.sheets.flatMap((sheet) =>
      sheet.components
        .filter(
          (component) => component.device?.logicalInstanceId === instanceId,
        )
        .map((component) => component.device?.symbolUnitId ?? ""),
    ),
  );
}

export function removeOrphanDeviceInstances(project: Project) {
  const used = new Set(
    project.sheets.flatMap((sheet) =>
      sheet.components.flatMap((component) =>
        component.device?.logicalInstanceId
          ? [component.device.logicalInstanceId]
          : [],
      ),
    ),
  );
  project.deviceInstances = project.deviceInstances.filter((instance) =>
    used.has(instance.id),
  );
  project.boardConfigurations = project.boardConfigurations.filter(
    (configuration) => used.has(configuration.logicalInstanceId),
  );
}
