import type { Component, ComponentKind, Pin, Point, Project } from "./types";
import { activeSchematicSheet } from "./schematic-sheet";

export type ConnectorDirection =
  "input" | "output" | "bidirectional" | "passive";

export const connectorName = (component: Component) =>
  component.parameters.value ?? "";

export const isNetworkLabel = (kind: ComponentKind) =>
  kind === "netLabel" || kind === "globalLabel";

export function createLocalConnector(
  kind: "netLabel" | "globalLabel" | "hierarchicalPort",
  position: Point,
): Component {
  const value =
    kind === "netLabel"
      ? "net"
      : kind === "globalLabel"
        ? "global_net"
        : "PORT";
  return {
    id: crypto.randomUUID(),
    kind,
    position,
    rotation: 0,
    parameters: {
      value,
      ...(kind === "hierarchicalPort" ? { direction: "bidirectional" } : {}),
    },
    pins: [
      {
        id: "1",
        name: "NET",
        offset: { x: 0, y: 0 },
        allowFloating: true,
      },
    ],
    displayName: value,
    spiceRef: "",
    model: null,
  };
}

export function createLocalSheetInstance(
  project: Project,
  targetSheetId: string,
  position: Point,
): boolean {
  const owner = activeSchematicSheet(project);
  const target = project.sheets.find((sheet) => sheet.id === targetSheetId);
  if (!target || target.id === owner.id) return false;
  if (
    project.sheets.some((sheet) =>
      sheet.components.some(
        (component) =>
          component.kind === "sheetInstance" &&
          component.parameters.targetSheetId === targetSheetId,
      ),
    )
  )
    return false;
  const component: Component = {
    id: crypto.randomUUID(),
    kind: "sheetInstance",
    position,
    rotation: 0,
    parameters: { value: target.name, targetSheetId },
    pins: instancePins(target.components),
    displayName: target.name,
    spiceRef: "",
    model: null,
    symbolWidth: 160,
    symbolHeight: instanceHeight(target.components),
  };
  owner.components.push(component);
  if (containsCycle(project)) {
    owner.components.pop();
    return false;
  }
  return true;
}

export function synchronizeLocalSheetInstances(project: Project): void {
  const targets = new Map(project.sheets.map((sheet) => [sheet.id, sheet]));
  for (const component of project.sheets.flatMap((sheet) => sheet.components)) {
    if (component.kind !== "sheetInstance") continue;
    const target = targets.get(component.parameters.targetSheetId);
    if (!target) continue;
    component.pins = instancePins(target.components);
    component.parameters.value = target.name;
    component.displayName = target.name;
    component.symbolWidth = 160;
    component.symbolHeight = instanceHeight(target.components);
  }
}

const instancePins = (components: Component[]): Pin[] => {
  const ports = components.filter(
    (component) => component.kind === "hierarchicalPort",
  );
  const totals = [
    ports.filter((port) => port.parameters.direction !== "output").length,
    ports.filter((port) => port.parameters.direction === "output").length,
  ];
  const counts = [0, 0];
  return ports.map((port) => {
    const direction = (port.parameters.direction ??
      "bidirectional") as ConnectorDirection;
    const side = direction === "output" ? 1 : 0;
    const index = counts[side]++;
    return {
      id: port.id,
      name: connectorName(port),
      offset: {
        x: side ? 100 : -100,
        y: (index - (Math.max(totals[side], 1) - 1) / 2) * 24 + 8,
      },
      electricalType:
        direction === "input"
          ? "input"
          : direction === "output"
            ? "output"
            : direction === "passive"
              ? "passive"
              : "bidirectional",
      direction,
      allowFloating: true,
    };
  });
};

const instanceHeight = (components: Component[]) =>
  Math.max(
    80,
    Math.max(
      2,
      components.filter((component) => component.kind === "hierarchicalPort")
        .length,
    ) *
      24 +
      32,
  );

const containsCycle = (project: Project) => {
  const edges = new Map<string, string[]>();
  for (const sheet of project.sheets)
    edges.set(
      sheet.id,
      sheet.components
        .filter((component) => component.kind === "sheetInstance")
        .map((component) => component.parameters.targetSheetId),
    );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((edges.get(id) ?? []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return project.sheets.some((sheet) => visit(sheet.id));
};
