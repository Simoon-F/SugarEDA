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
  | "netLabel"
  | "device";
export type PinElectricalType =
  | "passive"
  | "input"
  | "output"
  | "bidirectional"
  | "openDrain"
  | "openCollector"
  | "powerInput"
  | "powerOutput"
  | "noConnect";
export type Pin = {
  id: string;
  name: string;
  offset: Point;
  number?: string | null;
  group?: string | null;
  electricalType?: PinElectricalType | null;
  direction?: string | null;
  voltageDomainId?: string | null;
  voltageMin?: number | null;
  voltageMax?: number | null;
  alternateFunctions?: string[];
  differentialPairId?: string | null;
  differentialPolarity?: "positive" | "negative" | null;
  required?: boolean;
  allowFloating?: boolean;
  noConnect?: boolean;
};
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
  device?: DeviceBinding | null;
  symbolWidth?: number | null;
  symbolHeight?: number | null;
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
  device?: {
    packSha256: string;
    deviceId: string;
    variantId?: string | null;
    unitId?: string | null;
    logicalInstanceId?: string | null;
  };
};

export type DevicePackCapability = {
  level: number;
  code: string;
  available: boolean;
};
export type DeviceBinding = {
  logicalInstanceId?: string | null;
  packSha256: string;
  packId: string;
  packVersion: string;
  deviceId: string;
  variantId?: string | null;
  symbolUnitId?: string | null;
  capabilities: DevicePackCapability[];
};
export type DeviceInstance = {
  id: string;
  packSha256: string;
  packId: string;
  packVersion: string;
  deviceId: string;
  variantId?: string | null;
  reference: string;
  displayName: string;
  model?: ModelBinding | null;
  capabilities: DevicePackCapability[];
};
export type DevicePackPin = {
  id: string;
  number: string;
  name: string;
  group: string;
  electricalType: PinElectricalType;
  direction: string;
  voltageDomainId?: string | null;
};
export type DevicePack = {
  manifest: {
    formatVersion: number;
    id: string;
    name: string;
    vendor: string;
    version: string;
    source: string;
    license: string;
    description?: string;
  };
  devices: {
    id: string;
    name: string;
    deviceType: string;
    symbolId: string;
    packageId: string;
    variants: { id: string; name: string; packageId?: string | null }[];
    pins: DevicePackPin[];
    voltageDomains: {
      id: string;
      name: string;
      minVoltage: number;
      maxVoltage: number;
    }[];
    alternateFunctions: { pinId: string; functions: string[] }[];
    differentialPairs: {
      id: string;
      positivePinId: string;
      negativePinId: string;
    }[];
    rules: { id: string; kind: string; pinIds: string[]; message?: string }[];
    modelIds: string[];
    spiceBindings?: {
      modelId: string;
      ports: { modelPort: string; pinId: string }[];
    }[];
    sdkAdapterIds: string[];
  }[];
  symbols: {
    id: string;
    name: string;
    units: { id: string; name: string; groups: string[] }[];
  }[];
  packages: { id: string; name: string; kind: string; pads: string[] }[];
  models: {
    id: string;
    kind: "spice" | "ibis" | "sParameter";
    format: string;
    modelName?: string | null;
    metadata: Record<string, string>;
  }[];
  sdkAdapters: {
    id: string;
    sdkType: string;
    versionRequirement: string;
    localPathPatterns: string[];
    metadata: Record<string, string>;
  }[];
  documents: {
    kind: string;
    title: string;
    sourceUrl: string;
    revision?: string;
    license?: string;
  }[];
};
export type EmbeddedDevicePack = { sha256: string; pack: DevicePack };
export type ErcIssue = {
  code: string;
  severity: string;
  deviceId: string;
  pinId: string | null;
  messageZh: string;
  messageEn: string;
};
export type ErcReport = {
  passed: boolean;
  issues: ErcIssue[];
  checkedDevices: number;
  checkedPins: number;
};
export type SdkAdapterIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  messageZh: string;
  messageEn: string;
};
export type SdkAdapterReport = {
  packSha256: string;
  adapterId: string;
  sdkType: string;
  versionRequirement: string;
  selectedRoot: string;
  verificationLevel: "pathMetadataOnly";
  matched: boolean;
  patterns: { pattern: string; matches: string[] }[];
  issues: SdkAdapterIssue[];
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
  devicePacks: EmbeddedDevicePack[];
  deviceInstances: DeviceInstance[];
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
  | {
      action: "addDeviceComponent";
      packSha256: string;
      deviceId: string;
      variantId: string | null;
      unitId: string | null;
      logicalInstanceId: string | null;
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
  | {
      action: "setPinNoConnect";
      componentId: string;
      pinId: string;
      noConnect: boolean;
    }
  | { action: "deleteSelection"; componentIds: string[]; wireIds: string[] }
  | {
      action: "insertSelection";
      components: Component[];
      wires: Wire[];
      deviceInstances: DeviceInstance[];
    }
  | { action: "addWire"; points: Point[] }
  | { action: "updateWire"; id: string; points: Point[] }
  | { action: "deleteWire"; id: string }
  | { action: "updateView"; zoom: number; pan: Point; gridVisible: boolean }
  | { action: "updateSimulation"; profile: SimulationProfile }
  | { action: "addSimulationProfile"; profile: SimulationProfile }
  | { action: "deleteSimulationProfile"; id: string }
  | { action: "selectSimulationProfile"; id: string };
