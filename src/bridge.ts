import { invoke } from "@tauri-apps/api/core";
import type {
  BackendStatus,
  EditorCommand,
  RecentProject,
  RecoveryInfo,
  SimulationCheckReport,
  SimulationResult,
  Snapshot,
  ErcReport,
  DeviceConfigReport,
  DeviceTreeAdapterReport,
  SdkAdapterReport,
  BoardConfigurationCheckReport,
  BoardConfigurationExportFormat,
  BoardConfigurationExportReceipt,
  BoardConfigurationSourceFormat,
  DeviceConfigurationData,
  DevicePack,
  DevicePackAuthoringReport,
  DevicePackExportReceipt,
  DevicePackSignatureReport,
  TrustedDevicePackKey,
  TrustedDevicePackKeyExportReceipt,
  DevicePackSpiceModelFileReport,
  AdapterContractReport,
} from "./types";
export const isDesktop = () => "__TAURI_INTERNALS__" in window;
export const api = {
  snapshot: () => invoke<Snapshot>("workspace_snapshot"),
  newProject: () =>
    invoke<Snapshot>("new_project", { name: "Untitled circuit" }),
  load: (path: string) => invoke<Snapshot>("load_project", { path }),
  save: (path?: string | null) =>
    invoke<Snapshot>("save_project", { path: path || null }),
  autosave: () => invoke<RecoveryInfo | null>("autosave_project"),
  recoveryStatus: () => invoke<RecoveryInfo | null>("recovery_status"),
  restoreRecovery: () => invoke<Snapshot>("restore_recovery"),
  discardRecovery: () => invoke<void>("discard_recovery"),
  recentProjects: () => invoke<RecentProject[]>("recent_projects"),
  forgetRecentProject: (path: string) =>
    invoke<RecentProject[]>("forget_recent_project", { path }),
  apply: (command: EditorCommand) =>
    invoke<Snapshot>("apply_editor_command", { command }),
  undo: () => invoke<Snapshot>("undo"),
  redo: () => invoke<Snapshot>("redo"),
  netlist: () => invoke<string>("generate_netlist"),
  check: () => invoke<SimulationCheckReport>("simulation_check"),
  importSpiceLibrary: (path: string) =>
    invoke<Snapshot>("import_spice_library", { path }),
  importDevicePack: (path: string) =>
    invoke<Snapshot>("import_device_pack", { path }),
  validateDevicePackDraft: (pack: DevicePack) =>
    invoke<DevicePackAuthoringReport>("validate_device_pack_draft", { pack }),
  exportDevicePackDraft: (pack: DevicePack, path: string) =>
    invoke<DevicePackExportReceipt>("export_device_pack_draft", { pack, path }),
  inspectDevicePackSignature: (packPath: string, signaturePath: string) =>
    invoke<DevicePackSignatureReport>("inspect_device_pack_signature", {
      packPath,
      signaturePath,
    }),
  listTrustedDevicePackKeys: () =>
    invoke<TrustedDevicePackKey[]>("list_trusted_device_pack_keys"),
  trustDevicePackSignatureKey: (packPath: string, signaturePath: string) =>
    invoke<TrustedDevicePackKey[]>("trust_device_pack_signature_key", {
      packPath,
      signaturePath,
    }),
  removeTrustedDevicePackKey: (fingerprint: string) =>
    invoke<TrustedDevicePackKey[]>("remove_trusted_device_pack_key", {
      fingerprint,
    }),
  importTrustedDevicePackKey: (path: string) =>
    invoke<TrustedDevicePackKey[]>("import_trusted_device_pack_key", { path }),
  exportTrustedDevicePackKey: (fingerprint: string, path: string) =>
    invoke<TrustedDevicePackKeyExportReceipt>(
      "export_trusted_device_pack_key",
      {
        fingerprint,
        path,
      },
    ),
  inspectDevicePackSpiceModelFile: (path: string) =>
    invoke<DevicePackSpiceModelFileReport>(
      "inspect_device_pack_spice_model_file",
      { path },
    ),
  validateAdapterContract: (path: string) =>
    invoke<AdapterContractReport>("validate_adapter_contract", { path }),
  erc: () => invoke<ErcReport>("run_erc"),
  inspectSdkAdapter: (
    packSha256: string,
    adapterId: string,
    rootPath: string,
  ) =>
    invoke<SdkAdapterReport>("inspect_sdk_adapter", {
      packSha256,
      adapterId,
      rootPath,
    }),
  checkDeviceConfig: (packSha256: string, deviceId: string, path: string) =>
    invoke<DeviceConfigReport>("check_device_config", {
      packSha256,
      deviceId,
      path,
    }),
  checkDeviceTreeConfig: (packSha256: string, deviceId: string, path: string) =>
    invoke<DeviceTreeAdapterReport>("check_device_tree_config", {
      packSha256,
      deviceId,
      path,
    }),
  importBoardConfiguration: (
    logicalInstanceId: string,
    path: string,
    sourceFormat: BoardConfigurationSourceFormat,
  ) =>
    invoke<Snapshot>("import_board_configuration", {
      logicalInstanceId,
      path,
      sourceFormat,
    }),
  checkBoardConfigurations: () =>
    invoke<BoardConfigurationCheckReport>("check_board_configurations"),
  validateBoardConfigurationDraft: (
    logicalInstanceId: string,
    config: DeviceConfigurationData,
  ) =>
    invoke<DeviceConfigReport>("validate_board_configuration_draft", {
      logicalInstanceId,
      config,
    }),
  applyBoardConfigurationDraft: (
    logicalInstanceId: string,
    config: DeviceConfigurationData,
  ) =>
    invoke<Snapshot>("apply_board_configuration_draft", {
      logicalInstanceId,
      config,
    }),
  exportBoardConfiguration: (
    configurationId: string,
    path: string,
    format: BoardConfigurationExportFormat,
  ) =>
    invoke<BoardConfigurationExportReceipt>("export_board_configuration", {
      configurationId,
      path,
      format,
    }),
  exportWaveform: (path: string, csv: string) =>
    invoke<void>("export_waveform", { path, csv }),
  status: (configuredPath?: string) =>
    invoke<BackendStatus>("simulation_status", {
      configuredPath: configuredPath || null,
    }),
  run: (configuredPath?: string) =>
    invoke<SimulationResult>("run_simulation", {
      configuredPath: configuredPath || null,
    }),
  stop: () => invoke<void>("stop_simulation"),
};
