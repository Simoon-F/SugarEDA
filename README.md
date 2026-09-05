# SugarEDA

SugarEDA is a focused cross-platform schematic capture and SPICE simulation workbench. This first MVP combines a Rust-owned engineering model with a high-density Tauri 2 / React desktop interface.

## MVP features

- Canvas-rendered schematic editor with grid snapping, zoom around cursor, pan, box selection, move, rotate, delete, component drag/drop, pin snapping, and orthogonal wires.
- Resistor, capacitor, inductor, voltage/current source, ground, and net-label primitives.
- Rust-owned semantic edit commands with a 100-entry Undo/Redo history.
- Versioned, human-readable `.sugeda` project files with validated loading and atomic writes.
- Deterministic SPICE netlist generation with checks for ground, floating pins, references, labels, and parameter injection.
- `SimulationBackend` abstraction and an ngspice child-process implementation with detection, cancellation, temp workspace cleanup, logs, and ASCII raw-result parsing.
- Operating Point, DC Sweep, Transient, and AC Sweep profiles with voltage/current probes.
- Portable SPICE model import: diode, BJT, MOSFET (source-tied bulk), and pin-ordered subcircuit symbols, with source text and SHA-256 embedded in the project.
- AC magnitude/dB/phase plots, logarithmic frequency axis, complete operating-point tables, and CSV export.
- Canvas waveform viewer with multi-signal visibility, engineering units, cursor readings, mouse-centered zoom, logs, and explicit empty/running/error states.

## Development

Prerequisites: Node.js 22+, npm or pnpm, Rust stable, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). Building ngspice requires a C/C++ compiler, bash, make, curl, and tar.

```sh
npm install
pnpm build:ngspice
npm run tauri dev
```

The browser-only UI preview is available with `npm run dev`. It starts with an in-memory blank project; file and simulation operations remain desktop-only. A real Tauri session always treats the Rust workspace as the source of truth.

## Bundled ngspice

The local macOS Apple Silicon bundle now contains a source-built ngspice 47. End users of a prepared installer do not install it separately. Build the pinned headless engine on macOS/Linux, then package:

```sh
pnpm build:ngspice
npm run tauri build
```

For Windows, use `pnpm prepare:ngspice /trusted/payload-directory` with a self-contained native executable, required DLLs, and notices. Windows builds/installers have not been verified. Source checkouts do not commit third-party binaries. For development or recovery, a local override remains available:

```sh
export SUGAREDA_NGSPICE_PATH="/absolute/path/to/ngspice"
npm run tauri dev
```

An executable path can also be entered in **Configure**. Resolution order is UI override, `SUGAREDA_NGSPICE_PATH`, bundled binary, then system `PATH`. The builder includes root upstream notices and source provenance; public distribution still requires a release/license review. See [distribution notes](docs/NGSPICE_DISTRIBUTION.md).

## Try the simulation tools

The app defaults to Chinese and opens a blank project. Language selection is available in the top bar and persists locally. Follow the [Chinese user test guide](docs/USER_TEST_GUIDE.zh-CN.md) to draw an RC circuit yourself and verify the complete solver path.

1. Run `pnpm tauri dev`, then follow the manual guide to place and connect the RC circuit.
2. In **Configure**, choose OP/DC/AC and enter sweep values. Separate probes with semicolons: `v(out); i(v1)`. Blank means all signals.
3. For AC, change V1's value to `DC 0 AC 1`, choose AC Sweep, then use Magnitude/dB/Phase in the waveform toolbar.
4. Click the import button beside **COMPONENTS**, open `examples/models/learning.lib`, and drag its models onto the schematic. Wire pins according to their names/order. These are generic teaching models, not vendor-calibrated devices.
5. Export results from the waveform toolbar as CSV. See [model-library guidance](docs/MODEL_LIBRARY.md).

## Verification

```sh
npm run format
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --no-bundle
```

The architecture, file contract, and next-stage boundaries are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/FILE_FORMAT.md`](docs/FILE_FORMAT.md), and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Current limits

- One schematic sheet is editable at a time.
- Wires support click-to-click orthogonal routing, L-bend switching, and grid-snapped segment reshaping; explicit junction editing is not yet included.
- Results currently cross the Tauri command boundary as JSON. The result type is isolated so a channel or binary result-file transport can replace it without changing the domain model.
- macOS is verified in this repository; Windows and Linux builds rely on Tauri's portable APIs but still require platform CI.
- No RK3576 functional simulation, IBIS engine, encrypted vendor models, or automatic vendor downloads.
- Libraries must be self-contained text; external includes, instance parameter editing, and arbitrary pin remapping remain future work.
