import type { Project } from "./types";

export type SchematicSheet = Project["sheets"][number];

export function activeSchematicSheet(project: Project): SchematicSheet {
  return (
    project.sheets.find(
      (sheet) => sheet.id === project.uiViewState.activeSheetId,
    ) ?? project.sheets[0]
  );
}

export function addLocalSchematicSheet(project: Project, name: string): void {
  const id = crypto.randomUUID();
  project.sheets.push({ id, name, components: [], wires: [], netLabels: [] });
  project.uiViewState.activeSheetId = id;
}

export function renameLocalSchematicSheet(
  project: Project,
  id: string,
  name: string,
): void {
  const sheet = project.sheets.find((candidate) => candidate.id === id);
  if (sheet) sheet.name = name;
}

export function deleteLocalSchematicSheet(project: Project, id: string): void {
  if (project.sheets.length <= 1) return;
  const index = project.sheets.findIndex((sheet) => sheet.id === id);
  if (index < 0) return;
  project.sheets.splice(index, 1);
  if (project.uiViewState.activeSheetId === id)
    project.uiViewState.activeSheetId =
      project.sheets[Math.min(index, project.sheets.length - 1)].id;
}

export function nextSheetName(project: Project, language: "zh-CN" | "en") {
  const prefix = language === "zh-CN" ? "原理图" : "Schematic";
  const used = new Set(project.sheets.map((sheet) => sheet.name.toLowerCase()));
  let sequence = project.sheets.length + 1;
  while (used.has(`${prefix} ${sequence}`.toLowerCase())) sequence += 1;
  return `${prefix} ${sequence}`;
}

export function validSheetName(
  project: Project,
  id: string | null,
  name: string,
): boolean {
  return (
    name.trim() === name &&
    name.length > 0 &&
    name.length <= 96 &&
    !/\p{Cc}/u.test(name) &&
    !project.sheets.some(
      (sheet) =>
        sheet.id !== id && sheet.name.toLowerCase() === name.toLowerCase(),
    )
  );
}
