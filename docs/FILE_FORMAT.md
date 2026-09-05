# .sugeda file format — schema 2

Projects are UTF-8 JSON. Loading schema 1 upgrades it to schema 2 with an empty model library list; newer versions are rejected. Writers produce indented JSON.

Root fields: schemaVersion (2), metadata, sheets, spiceLibraries, simulationProfiles, activeSimulationProfile, uiViewState, createdAt, updatedAt.

Components retain UUID, kind, position, quadrant rotation, parameters, explicit pin IDs/names/offsets, display name, and SPICE reference. Optional model holds libraryId, modelName, and kind. Subcircuit pin order matches its declaration; imported three-terminal MOS models use D/G/S and tie bulk to source.

Each library stores id, name, sourceName, sha256, models, content. The source name is descriptive, not an include path. Original text travels with the project. Import and load check declarations and SHA-256; this detects inconsistent content but is not a signature or trust guarantee.

## Analyses

```json
{ "type": "operatingPoint" }
{ "type": "transient", "step": "10u", "stop": "30m" }
{ "type": "dcSweep", "source": "V1", "start": "0", "stop": "5", "step": "0.1" }
{ "type": "acSweep", "variation": "dec", "points": 100, "start": "10", "stop": "1Meg" }
```

Profile signals is an array of expressions, e.g. v(out), v(out,in), i(v1). Empty requests all signals. The UI separates expressions with semicolons, preserving differential-probe commas.

Results are not persisted in projects. They contain an x-axis and named signals with units/samples; AC samples are magnitudes and phase holds degrees. OP uses a synthetic point axis and retains each variable once. CSV exports all returned signals, not just visible ones.

## Connectivity and persistence

Coordinates are world units. Wires are ordered points; pins, labels, and wire points at matching coordinates connect. Pins/points lying on a segment connect too. An interior crossing alone does not create a junction. Ground nets map to node 0.

Saving uses a temporary file in the destination directory followed by flush, sync, and atomic persistence. Loading/saving requires .sugeda, at most 16 MiB, valid JSON, supported schema, and validated embedded libraries. Each imported model file is limited to 2 MiB.
