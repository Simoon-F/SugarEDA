# Architecture

## Direction

SugarEDA is split by responsibility rather than framework. Rust is the authoritative engineering core; React is an interaction and rendering client. Every committed canvas edit is a semantic command. Temporary pointer movement stays in the frontend until pointer-up.

```text
React canvas / inspector / waveform
              │ typed Tauri commands
application — workspace, edit commands, history, use cases
              │
domain      — project, sheets, components, wires, profiles
              │
infrastructure — JSON filesystem, ngspice process, raw parser
```

## Rust modules

- `domain.rs`: serialization types, device/pin definitions, and the built-in RC project.
- `application.rs`: `Workspace`, Undo/Redo, dirty state, and semantic `EditorCommand` handling.
- `project.rs`: 16 MiB resource cap, schema checks, readable JSON, fsync, and same-directory atomic persistence.
- `netlist.rs`: coordinate graph/union-find connectivity, ground and label resolution, deterministic device ordering, validation, and analysis cards.
- `simulation.rs`: backend trait, packaged-resource discovery, development overrides, process lifecycle/cancellation, isolated temp files, and unified simulation results.
- `lib.rs`: narrow Tauri command adapter. It offers no arbitrary shell command and no general filesystem API.

## Frontend

`SchematicCanvas.tsx` renders the complete engineering scene into one HiDPI canvas. The render representation never becomes project data. `Waveform.tsx` similarly draws paths rather than one DOM node per sample. `App.tsx` owns the desktop shell and a typed mirror of the most recent Rust snapshot.

The UI uses local shadcn/ui primitives with Tailwind CSS for menus, buttons, tabs, selects, and tooltips. It follows SugarCode's light blue-gray palette, blue controls (#2869df), system UI fonts, compact labels, and white plotting surfaces. It favors density and legibility over dashboard cards.

## Extension boundaries

- New devices extend `ComponentKind`, pin factories, symbol rendering, and the netlist emitter.
- PCB data should be a new domain document linked by component UUID, not canvas state attached to the schematic.
- ERC/DRC should consume immutable project snapshots and return structured findings with object UUIDs.
- A new solver implements `SimulationBackend`; the UI consumes only `SimulationResult`.
- Large results can move from command JSON to chunked Channels or a read-only binary result file without altering waveform semantics.

## Security decisions

The CSP permits only packaged content and Tauri IPC. Capabilities expose core window behavior and open/save dialogs only. File commands require `.sugeda`, reject files over 16 MiB, and surface parse failures. SPICE values reject newlines, carriage returns, semicolons, excessive length, and unknown characters, preventing injected control cards. ngspice receives argument-array paths and runs in an automatically cleaned temporary directory.
