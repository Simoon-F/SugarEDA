export type Point = { x: number; y: number };
export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltageSource"
  | "currentSource"
  | "diode"
  | "bipolarTransistor"
  | "mosfet"
  | "subcircuit"
  | "ground"
  | "netLabel";
export type Pin = { id: string; name: string; offset: Point };
export type Component = {
  id: string;
  kind: ComponentKind;
  position: Point;
  rotation: number;
  parameters: Record<string, string>;
  pins: Pin[];
  displayName: string;
  spiceRef: string;
  model?: ModelBinding | null;
};
export type SpiceModelKind = "diode" | "bipolar" | "mosfet" | "subcircuit";
export type SpiceModelDefinition = {
  name: string;
  kind: SpiceModelKind;
  pins: string[];
};
export type SpiceLibrary = {
  id: string;
  name: string;
  sourceName: string;
  sha256: string;
  models: SpiceModelDefinition[];
  content: string;
};
export type ModelBinding = {
  libraryId: string;
  modelName: string;
  kind: SpiceModelKind;
};
export type ComponentPlacement = {
  kind: ComponentKind;
  model?: { libraryId: string; modelName: string };
};
export type Wire = { id: string; points: Point[] };
export type NetLabel = { id: string; name: string; position: Point };
export type Analysis =
  | { type: "operatingPoint" }
  | { type: "transient"; step: string; stop: string }
  | {
      type: "dcSweep";
      source: string;
      start: string;
      stop: string;
      step: string;
    }
  | {
      type: "acSweep";
      variation: string;
      points: number;
      start: string;
      stop: string;
    };
export type SimulationProfile = {
  id: string;
  name: string;
  analysis: Analysis;
  signals: string[];
};
export type SimulationCheckCategory =
  "ground" | "pins" | "labels" | "probes" | "analysis";
export type SimulationCheckIssue = {
  code: string;
  category: SimulationCheckCategory;
  message: string;
  componentId: string | null;
};
export type SimulationCheckItem = {
  category: SimulationCheckCategory;
  passed: boolean;
  issueCount: number;
};
export type SimulationCheckReport = {
  ready: boolean;
  checks: SimulationCheckItem[];
  issues: SimulationCheckIssue[];
  netlist: string | null;
};
export type Project = {
  schemaVersion: number;
  metadata: { id: string; name: string; description: string; author: string };
  sheets: {
    id: string;
    name: string;
    components: Component[];
    wires: Wire[];
    netLabels: NetLabel[];
  }[];
  simulationProfiles: SimulationProfile[];
  spiceLibraries: SpiceLibrary[];
  activeSimulationProfile: string | null;
  uiViewState: {
    activeSheetId: string;
    zoom: number;
    pan: Point;
    gridVisible: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
export type Snapshot = {
  project: Project;
  path: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
};
export type RecoveryInfo = {
  projectName: string;
  originalPath: string | null;
  savedAt: string;
  componentCount: number;
  wireCount: number;
};
export type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: string;
  exists: boolean;
};
export type BackendStatus = {
  available: boolean;
  executable: string;
  version: string | null;
  message: string;
};
export type SimulationResult = {
  analysisType: string;
  signals: {
    name: string;
    unit: string;
    samples: number[];
    phase?: number[] | null;
  }[];
  xAxis: { name: string; unit: string; samples: number[] };
  warnings: string[];
  log: string;
  executionTimeMs: number;
};
export type EditorCommand =
  | { action: "addComponent"; kind: ComponentKind; position: Point }
  | {
      action: "addModelComponent";
      libraryId: string;
      modelName: string;
      position: Point;
    }
  | { action: "moveComponent"; id: string; position: Point }
  | {
      action: "moveSelection";
      componentIds: string[];
      wireIds: string[];
      delta: Point;
    }
  | {
      action: "updateComponent";
      id: string;
      displayName: string;
      spiceRef: string;
      value: string;
    }
  | { action: "rotateComponent"; id: string }
  | { action: "deleteSelection"; componentIds: string[]; wireIds: string[] }
  | { action: "insertSelection"; components: Component[]; wires: Wire[] }
  | { action: "addWire"; points: Point[] }
  | { action: "updateWire"; id: string; points: Point[] }
  | { action: "deleteWire"; id: string }
  | { action: "updateView"; zoom: number; pan: Point; gridVisible: boolean }
  | { action: "updateSimulation"; profile: SimulationProfile }
  | { action: "addSimulationProfile"; profile: SimulationProfile }
  | { action: "deleteSimulationProfile"; id: string }
  | { action: "selectSimulationProfile"; id: string };
