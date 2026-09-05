import type { Component, DeviceInstance, Point, Project, Wire } from "./types";

export type ClipboardPayload = {
  components: Component[];
  wires: Wire[];
  deviceInstances: DeviceInstance[];
};

const translate = (points: Point[], delta: Point) =>
  points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));

const nextReference = (reference: string, used: Set<string>) => {
  if (!reference) return "";
  const prefix = reference.match(/^[A-Za-z]+/)?.[0] ?? reference;
  let number = 1;
  while (used.has(`${prefix}${number}`.toLowerCase())) number += 1;
  const next = `${prefix}${number}`;
  used.add(next.toLowerCase());
  return next;
};

export function clipboardFromSelection(
  project: Project,
  selected: Set<string>,
): ClipboardPayload {
  const components = project.sheets[0].components
    .filter((component) => selected.has(component.id))
    .map((component) => structuredClone(component));
  const logicalIds = new Set(
    components.flatMap((component) =>
      component.device?.logicalInstanceId
        ? [component.device.logicalInstanceId]
        : [],
    ),
  );
  return {
    components,
    wires: project.sheets[0].wires
      .filter((wire) => selected.has(wire.id))
      .map((wire) => structuredClone(wire)),
    deviceInstances: project.deviceInstances
      .filter((instance) => logicalIds.has(instance.id))
      .map((instance) => structuredClone(instance)),
  };
}

export function instantiateClipboard(
  clipboard: ClipboardPayload,
  sheet: Project["sheets"][number],
  offset: Point,
  reservedReferences?: Set<string>,
): ClipboardPayload {
  const used = new Set(
    [
      ...sheet.components.map((component) => component.spiceRef.toLowerCase()),
      ...(reservedReferences ?? []),
    ].filter(Boolean),
  );
  const instances = new Map(
    clipboard.deviceInstances.map((source) => {
      const instance = structuredClone(source);
      instance.id = crypto.randomUUID();
      instance.reference = nextReference(source.reference, used);
      return [source.id, instance] as const;
    }),
  );
  const components = clipboard.components.map((source) => {
    const component = structuredClone(source);
    component.id = crypto.randomUUID();
    component.position = {
      x: source.position.x + offset.x,
      y: source.position.y + offset.y,
    };
    const oldId = source.device?.logicalInstanceId;
    const instance = oldId ? instances.get(oldId) : undefined;
    const reference = instance
      ? instance.reference
      : nextReference(source.spiceRef, used);
    if (component.displayName === component.spiceRef)
      component.displayName = reference;
    component.spiceRef = reference;
    if (component.device && instance)
      component.device.logicalInstanceId = instance.id;
    return component;
  });
  if (reservedReferences)
    for (const reference of used) reservedReferences.add(reference);
  return {
    components,
    wires: clipboard.wires.map((source) => ({
      id: crypto.randomUUID(),
      points: translate(source.points, offset),
    })),
    deviceInstances: [...instances.values()],
  };
}
