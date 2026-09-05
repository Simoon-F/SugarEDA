# Model import and simulation scope

## Working example

Launch the desktop app with `pnpm tauri dev`; it opens a blank project. Import `examples/models/learning.lib` using the button next to COMPONENTS. This CC0 teaching library exports generic diode, NPN/PNP, NMOS/PMOS, idealized amplifier, and RC filter models.

Drag a model to place it. Pins follow its declaration; names appear on the symbol and inspector. Wire every external pin before Run. SUGAR_FILTER uses IN, OUT, GND. The amplifier does not model rail clipping, bandwidth, noise, or a manufacturer's part; it only demonstrates the workflow. Transistor symbols are generic: determine polarity from the model declaration, not a drawn arrow.

Models are embedded on save, so projects do not depend on the original path. Identical hashes are deduplicated; conflicting exported names are rejected. Import/placement support undo/redo.

## Accepted subset

- UTF-8 `.lib`, `.cir`, `.mod`, `.model`, `.spice`, at most 2 MiB each.
- Top-level `.model` types D, NPN, PNP, NMOS, PMOS; self-contained `.subckt` with up to 256 external pins.
- Continuation lines beginning with `+`, local models, default parameters, functions, conditional declarations.
- Three-terminal MOS ties bulk to source. Use an explicit four-pin subcircuit for separate bulk.

This conservative text importer is not a general PSpice/LTspice converter or a process sandbox. Import only trusted models. It rejects `.control`, `.include`, library-section `.lib` directives, external file references, and dynamic code-model devices. Multi-file libraries require a reviewed, flattened, self-contained model first. Encrypted models, XSPICE A devices, Verilog-A/OSDI modules, instance parameter editing, and arbitrary pin remapping are not implemented.

## AC and probes

Set a source value to `DC 0 AC 1`, then choose AC Sweep. Magnitude is absolute voltage/current; dBV/dBA is relative to 1 V/1 A, not automatically an input/output gain ratio. Phase is wrapped in degrees. Plot and cursor use actual solver sample coordinates.

Separate probes with `;`, e.g. `v(out); v(out,in); i(v1)`. Voltage-source current follows SPICE's sign convention. Invalid/unavailable vectors return solver errors. Blank requests all signals. OP is a table; CSV includes all returned signals and AC phase.

## RK3576 and other SoCs

A datasheet or symbol does not make a CPU executable in ngspice. This implementation simulates supported electrical models: power rails, passive/analog networks, and compatible peripherals. It does not simulate RK3576 instructions, firmware, or the entire chip.

Future SoC support must separate symbol/footprint and ERC metadata, analog peripheral models, IBIS I/O models with a suitable signal-integrity backend, and separate system emulation. No RK3576 model or IBIS backend is included, and no vendor downloads occur automatically. Availability and permitted use must be checked for each specific vendor/part.
