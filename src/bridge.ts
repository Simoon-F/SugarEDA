import { invoke } from "@tauri-apps/api/core";
import type {
  BackendStatus,
  EditorCommand,
  SimulationResult,
  Snapshot,
} from "./types";
export const isDesktop = () => "__TAURI_INTERNALS__" in window;
export const api = {
  snapshot: () => invoke<Snapshot>("workspace_snapshot"),
  newProject: () =>
    invoke<Snapshot>("new_project", { name: "Untitled circuit" }),
  load: (path: string) => invoke<Snapshot>("load_project", { path }),
  save: (path?: string | null) =>
    invoke<Snapshot>("save_project", { path: path || null }),
  apply: (command: EditorCommand) =>
    invoke<Snapshot>("apply_editor_command", { command }),
  undo: () => invoke<Snapshot>("undo"),
  redo: () => invoke<Snapshot>("redo"),
  netlist: () => invoke<string>("generate_netlist"),
  importSpiceLibrary: (path: string) =>
    invoke<Snapshot>("import_spice_library", { path }),
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
