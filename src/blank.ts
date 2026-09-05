import type { Project, Snapshot } from "./types";

export function createBlankSnapshot(name = "Untitled circuit"): Snapshot {
  const sheetId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const project: Project = {
    schemaVersion: 4,
    metadata: {
      id: crypto.randomUUID(),
      name,
      description: "",
      author: "",
    },
    sheets: [
      {
        id: sheetId,
        name: "Main",
        components: [],
        wires: [],
        netLabels: [],
      },
    ],
    simulationProfiles: [
      {
        id: profileId,
        name: "Transient",
        analysis: { type: "transient", step: "10u", stop: "30m" },
        signals: ["v(in)", "v(out)"],
      },
    ],
    spiceLibraries: [],
    devicePacks: [],
    deviceInstances: [],
    activeSimulationProfile: profileId,
    uiViewState: {
      activeSheetId: sheetId,
      zoom: 1,
      pan: { x: 80, y: 80 },
      gridVisible: true,
    },
    createdAt: now,
    updatedAt: now,
  };
  return {
    project,
    path: null,
    dirty: false,
    canUndo: false,
    canRedo: false,
  };
}
