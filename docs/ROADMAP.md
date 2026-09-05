# Roadmap

## Implemented simulation foundation

- Pinned ngspice 47 source build and bundled engine lookup; local macOS arm64 app bundle verified.
- Real OP, transient, DC and AC execution, cancellation, timeout, logs, and result parsing.
- Self-contained SPICE library import, embedded provenance/hash, generated diode/BJT/MOS/subcircuit symbols, model-aware netlists.
- Editable sweep settings and probes; AC magnitude/dB/phase, operating-point table, adaptive-sample cursor, CSV export.
- Schema 1 migration to schema 2 with portable model content.

## Next: cross-platform delivery and model workflows

- Windows native engine build, dependency collection, installer CI and clean-machine tests; Intel macOS verification, signing/notarization.
- Vendor compatibility fixtures, instance parameter editing, configurable MOS bulk, symbol/model pin mapping, controlled include dependencies, model removal/version updates.
- Structured ERC findings, SoC symbols/footprints and pin metadata. Full RK3576 functional simulation is not an ngspice feature.

## Engineering depth

- Noise, temperature/parameter sweeps, Monte Carlo, FFT, measurements, suitable IBIS/backend integration.
- Multi-sheet hierarchy, buses, junction editing, wire segment reshaping, annotation, clipboard.
- Binary/chunked result transport, persisted plot layouts, background queue and progress events.

## PCB foundation

Board model, schematic-to-PCB linkage, footprints, ratsnest, routing, zones, DRC, Gerber/drill export, 3D preview.

Cloud sync, accounts, collaboration, mobile clients, and marketplace remain outside the near-term scope.
