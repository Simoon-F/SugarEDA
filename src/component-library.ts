import type { ComponentKind, ComponentPlacement, Project } from "./types";

export type LibraryGroup = {
  group: string;
  items: {
    kind: ComponentKind;
    name: string;
    shortcut: string;
    glyph: string;
    model?: { libraryId: string; modelName: string };
    device?: ComponentPlacement["device"];
    sheetTargetId?: string;
  }[];
};

export function buildVisibleLibrary(
  base: LibraryGroup[],
  project: Project,
  query: string,
): LibraryGroup[] {
  const imported: LibraryGroup["items"] = project.spiceLibraries.flatMap(
    (source) =>
      source.models.map((model) => ({
        kind: (model.kind === "bipolar"
          ? "bipolarTransistor"
          : model.kind) as ComponentKind,
        name: model.name,
        shortcut:
          model.kind === "diode"
            ? "D"
            : model.kind === "bipolar"
              ? "Q"
              : model.kind === "mosfet"
                ? "M"
                : "X",
        glyph:
          model.kind === "diode"
            ? "—▷|—"
            : model.kind === "bipolar"
              ? "BJT"
              : model.kind === "mosfet"
                ? "MOS"
                : "▣",
        model: { libraryId: source.id, modelName: model.name },
      })),
  );
  const packed: LibraryGroup["items"] = project.devicePacks.flatMap(
    (embedded) =>
      embedded.pack.devices.flatMap((device) => {
        const symbol = embedded.pack.symbols.find(
          (item) => item.id === device.symbolId,
        );
        const units = symbol?.units.length
          ? symbol.units
          : [{ id: "", name: device.name, groups: [] }];
        return units.map((unit) => ({
          kind: "device" as const,
          name:
            units.length > 1 ? `${device.name} · ${unit.name}` : device.name,
          shortcut: "U",
          glyph:
            device.deviceType === "soc"
              ? "SOC"
              : device.deviceType === "microcontroller"
                ? "MCU"
                : "IC",
          device: {
            packSha256: embedded.sha256,
            deviceId: device.id,
            variantId: device.variants[0]?.id ?? null,
            unitId: unit.id || null,
          },
        }));
      }),
  );
  const hierarchy: LibraryGroup["items"] = project.sheets
    .filter((sheet) => sheet.id !== project.uiViewState.activeSheetId)
    .map((sheet) => ({
      kind: "sheetInstance" as const,
      name: sheet.name,
      shortcut: "H",
      glyph: "▤",
      sheetTargetId: sheet.id,
    }));
  const groups: LibraryGroup[] = imported.length
    ? [...base, { group: "IMPORTED MODELS", items: imported }]
    : [...base];
  if (packed.length) groups.push({ group: "DEVICE PACKS", items: packed });
  if (hierarchy.length) groups.push({ group: "HIERARCHY", items: hierarchy });
  const normalized = query.trim().toLowerCase();
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.name.toLowerCase().includes(normalized),
      ),
    }))
    .filter((group) => group.items.length);
}
