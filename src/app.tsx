import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./app.css";
import { api, isDesktop } from "./bridge";
import { createBlankSnapshot } from "./blank";
import { SchematicCanvas } from "./schematic-canvas";
import { Waveform } from "./waveform";
import { SimulationConfig } from "./simulation-config";
import { useI18n } from "./i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Cable,
  FileCode2,
  MousePointer2,
  PackagePlus,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import type {
  BackendStatus,
  Component,
  ComponentKind,
  ComponentPlacement,
  EditorCommand,
  Point,
  SimulationProfile,
  SimulationResult,
  Snapshot,
} from "./types";

const library: {
  group: string;
  items: {
    kind: ComponentKind;
    name: string;
    shortcut: string;
    glyph: string;
    model?: { libraryId: string; modelName: string };
  }[];
}[] = [
  {
    group: "PASSIVES",
    items: [
      { kind: "resistor", name: "Resistor", shortcut: "R", glyph: "—╱╲—" },
      { kind: "capacitor", name: "Capacitor", shortcut: "C", glyph: "—| |—" },
      { kind: "inductor", name: "Inductor", shortcut: "L", glyph: "—∿∿—" },
    ],
  },
  {
    group: "SOURCES",
    items: [
      {
        kind: "voltageSource",
        name: "Voltage source",
        shortcut: "V",
        glyph: "⊕",
      },
      {
        kind: "currentSource",
        name: "Current source",
        shortcut: "I",
        glyph: "↑",
      },
    ],
  },
  {
    group: "CONNECT",
    items: [
      { kind: "ground", name: "Ground", shortcut: "G", glyph: "⏚" },
      { kind: "netLabel", name: "Net label", shortcut: "N", glyph: "⌁" },
    ],
  },
];
const validationMessage = (item: object, language: "zh-CN" | "en") => {
  if (!("message" in item)) return String(item);
  const message = String(item.message);
  if (language !== "zh-CN" || !("code" in item)) return message;
  const quoted = [...message.matchAll(/'([^']*)'/g)].map((match) => match[1]);
  switch (String(item.code)) {
    case "floating_label":
      return `网络标签“${quoted[0] || "未命名"}”没有连接。请把标签尖端放到绿色引脚或已连接的导线上。`;
    case "unknown_probe":
      return quoted.length > 1
        ? `探针“${quoted[0]}”引用了不存在或未连接的节点“${quoted[1]}”。请放置同名网络标签并确认标签尖端已经吸附。`
        : `探针引用了不存在的器件“${quoted[0] || "未知"}”。`;
    case "invalid_probe":
      return `探针表达式“${quoted[0] || ""}”无效。请使用 v(out)、v(out,in) 或 i(v1)。`;
    case "missing_ground":
      return "原理图缺少接地参考。请放置 Ground 并把其绿色引脚接入电路。";
    case "floating_pin":
      return `存在未连接的引脚：${message}`;
    case "duplicate_reference":
      return `存在重复位号“${quoted[0] || ""}”。`;
    case "invalid_reference":
      return `位号“${quoted[0] || ""}”无效或与元件类型不匹配。`;
    case "invalid_analysis":
      return "仿真参数无效：请检查步长、起止时间或扫描范围。";
    default:
      return message;
  }
};
const errorText = (error: unknown, language: "zh-CN" | "en" = "en") =>
  Array.isArray(error)
    ? error
        .map((item) =>
          typeof item === "object" && item
            ? validationMessage(item, language)
            : String(item),
        )
        .join(" · ")
    : error instanceof Error
      ? error.message
      : String(error);

function App() {
  const { language, setLanguage, t } = useI18n();
  const pendingEdits = useRef<Promise<void>>(Promise.resolve());
  const libraryPointer = useRef<{
    placement: ComponentPlacement;
    start: Point;
    label: string;
  } | null>(null);
  const simulationInFlight = useRef(false);
  const simulationCancelled = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    createBlankSnapshot(),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<"select" | "wire">("select");
  const [placement, setPlacement] = useState<ComponentPlacement | null>(null);
  const [externalDrop, setExternalDrop] = useState<{
    id: number;
    placement: ComponentPlacement;
    screen: Point;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const endLibraryDrag = useCallback(() => {
    libraryPointer.current = null;
    setDragPreview(null);
    document.body.classList.remove("component-dragging");
    window.getSelection()?.removeAllRanges();
  }, []);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [bottomTab, setBottomTab] = useState("Waveform");
  const [bottomOpen, setBottomOpen] = useState(true);
  const [netlist, setNetlist] = useState("");
  const [logs, setLogs] = useState<string[]>([t("Workspace initialized")]);
  const [status, setStatus] = useState<BackendStatus>({
    available: false,
    executable: "ngspice",
    version: null,
    message: t("Checking ngspice…"),
  });
  const [ngspicePath, setNgspicePath] = useState("");
  const [running, setRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [query, setQuery] = useState("");
  const sheet = snapshot.project.sheets[0];
  const selectedComponent = sheet.components.find((c) => c.id === selected[0]);
  const profile =
    snapshot.project.simulationProfiles.find(
      (p) => p.id === snapshot.project.activeSimulationProfile,
    ) || snapshot.project.simulationProfiles[0];
  useEffect(
    () => () => document.body.classList.remove("component-dragging"),
    [],
  );
  useEffect(() => {
    if (isDesktop()) {
      api
        .snapshot()
        .then(setSnapshot)
        .catch((e) => setLogs((l) => [...l, errorText(e, language)]));
      api
        .status()
        .then(setStatus)
        .catch((e) =>
          setStatus({
            available: false,
            executable: "ngspice",
            version: null,
            message: errorText(e, language),
          }),
        );
    } else
      setStatus({
        available: false,
        executable: "ngspice",
        version: null,
        message: t(
          "Browser preview — simulation is available in the Tauri desktop app",
        ),
      });
  }, [language, t]);
  const localApply = useCallback(
    (command: EditorCommand) => {
      const next = structuredClone(snapshot);
      if (command.action === "moveComponent") {
        const c = next.project.sheets[0].components.find(
          (c) => c.id === command.id,
        );
        if (c) c.position = command.position;
      } else if (command.action === "updateComponent") {
        const c = next.project.sheets[0].components.find(
          (c) => c.id === command.id,
        );
        if (c) {
          c.displayName = command.displayName;
          c.spiceRef = command.spiceRef;
          c.parameters.value = command.value;
        }
      } else if (command.action === "rotateComponent") {
        const c = next.project.sheets[0].components.find(
          (c) => c.id === command.id,
        );
        if (c) c.rotation = (c.rotation + 90) % 360;
      } else if (command.action === "deleteSelection") {
        next.project.sheets[0].components =
          next.project.sheets[0].components.filter(
            (c) => !command.componentIds.includes(c.id),
          );
        next.project.sheets[0].wires = next.project.sheets[0].wires.filter(
          (w) => !command.wireIds.includes(w.id),
        );
      } else if (command.action === "addWire")
        next.project.sheets[0].wires.push({
          id: crypto.randomUUID(),
          points: command.points,
        });
      else if (command.action === "updateWire") {
        const wire = next.project.sheets[0].wires.find(
          (item) => item.id === command.id,
        );
        if (wire) wire.points = command.points;
      } else if (command.action === "updateView")
        next.project.uiViewState = {
          ...next.project.uiViewState,
          zoom: command.zoom,
          pan: command.pan,
          gridVisible: command.gridVisible,
        };
      else if (command.action === "updateSimulation") {
        const i = next.project.simulationProfiles.findIndex(
          (p) => p.id === command.profile.id,
        );
        next.project.simulationProfiles[i] = command.profile;
      } else if (command.action === "addModelComponent") {
        const definition = next.project.spiceLibraries
          .find((source) => source.id === command.libraryId)
          ?.models.find((model) => model.name === command.modelName);
        if (!definition) return;
        const prefix =
          definition.kind === "diode"
            ? "D"
            : definition.kind === "bipolar"
              ? "Q"
              : definition.kind === "mosfet"
                ? "M"
                : "X";
        const kind: ComponentKind =
          definition.kind === "bipolar" ? "bipolarTransistor" : definition.kind;
        const leftCount = Math.ceil(definition.pins.length / 2);
        const sequence =
          next.project.sheets[0].components.filter((component) =>
            component.spiceRef.startsWith(prefix),
          ).length + 1;
        next.project.sheets[0].components.push({
          id: crypto.randomUUID(),
          kind,
          position: command.position,
          rotation: 0,
          parameters: {},
          pins: definition.pins.map((name, index) => ({
            id: String(index + 1),
            name,
            offset:
              definition.pins.length === 2
                ? { x: index ? 40 : -40, y: 0 }
                : {
                    x: index < leftCount ? -50 : 50,
                    y:
                      ((index < leftCount ? index : index - leftCount) -
                        (leftCount - 1) / 2) *
                      20,
                  },
          })),
          displayName: definition.name,
          spiceRef: `${prefix}${sequence}`,
          model: {
            libraryId: command.libraryId,
            modelName: command.modelName,
            kind: definition.kind,
          },
        });
      } else if (command.action === "addComponent") {
        const defaults: Partial<Record<ComponentKind, [string, string]>> = {
          resistor: ["R", "1k"],
          capacitor: ["C", "1u"],
          inductor: ["L", "1m"],
          voltageSource: ["V", "DC 5"],
          currentSource: ["I", "DC 1m"],
          ground: ["", ""],
          netLabel: ["", "net"],
        };
        const defaultsForKind = defaults[command.kind];
        if (!defaultsForKind) return;
        const [prefix, value] = defaultsForKind,
          vertical =
            command.kind === "voltageSource" ||
            command.kind === "currentSource";
        const pins =
          command.kind === "netLabel"
            ? [{ id: "1", name: "NET", offset: { x: 0, y: 0 } }]
            : command.kind === "ground"
              ? [{ id: "1", name: "GND", offset: { x: 0, y: -20 } }]
              : vertical
                ? [
                    { id: "1", name: "+", offset: { x: 0, y: -30 } },
                    { id: "2", name: "-", offset: { x: 0, y: 30 } },
                  ]
                : [
                    { id: "1", name: "1", offset: { x: -40, y: 0 } },
                    { id: "2", name: "2", offset: { x: 40, y: 0 } },
                  ];
        const n =
          next.project.sheets[0].components.filter(
            (c) => c.kind === command.kind,
          ).length + 1;
        next.project.sheets[0].components.push({
          id: crypto.randomUUID(),
          kind: command.kind,
          position: command.position,
          rotation: 0,
          parameters: { value },
          pins,
          displayName: prefix
            ? `${prefix}${n}`
            : command.kind === "netLabel"
              ? "Net label"
              : "Ground",
          spiceRef: prefix ? `${prefix}${n}` : "",
          model: null,
        });
      }
      next.dirty = true;
      setSnapshot(next);
    },
    [snapshot],
  );
  const command = useCallback(
    async (c: EditorCommand) => {
      const task = pendingEdits.current.then(async () => {
        try {
          if (isDesktop()) setSnapshot(await api.apply(c));
          else localApply(c);
        } catch (e) {
          setLogs((l) => [...l, `ERROR ${errorText(e, language)}`]);
        }
      });
      pendingEdits.current = task;
      await task;
    },
    [language, localApply],
  );
  const doUndo = useCallback(async () => {
    if (isDesktop()) setSnapshot(await api.undo());
  }, []);
  const doRedo = useCallback(async () => {
    if (isDesktop()) setSnapshot(await api.redo());
  }, []);
  const remove = useCallback(() => {
    if (selected.length) {
      const componentIds = selected.filter((id) =>
        sheet.components.some((component) => component.id === id),
      );
      const wireIds = selected.filter((id) =>
        sheet.wires.some((wire) => wire.id === id),
      );
      void command({
        action: "deleteSelection",
        componentIds,
        wireIds,
      });
      setSelected([]);
    }
  }, [selected, command, sheet.components, sheet.wires]);
  const newProject = async () => {
    if (
      snapshot.dirty &&
      !confirm(
        language === "zh-CN"
          ? "放弃未保存的更改并新建项目？"
          : "Discard unsaved changes and create a new project?",
      )
    )
      return;
    if (isDesktop()) setSnapshot(await api.newProject());
    else setSnapshot(createBlankSnapshot());
    setSelected([]);
    setResult(null);
  };
  const openProject = async () => {
    if (!isDesktop()) return;
    const path = await open({
      multiple: false,
      filters: [{ name: "SugarEDA project", extensions: ["sugeda"] }],
    });
    if (path) {
      try {
        setSnapshot(await api.load(path));
        setLogs((l) => [...l, `Opened ${path}`]);
      } catch (e) {
        setLogs((l) => [...l, `OPEN ERROR ${errorText(e, language)}`]);
        setBottomTab("Console");
      }
    }
  };
  const saveProject = async (as = false) => {
    if (!isDesktop()) return;
    let path: string | null =
      as || !snapshot.path
        ? await save({
            defaultPath: `${snapshot.project.metadata.name}.sugeda`,
            filters: [{ name: "SugarEDA project", extensions: ["sugeda"] }],
          })
        : snapshot.path;
    if (path && !path.toLowerCase().endsWith(".sugeda")) path += `.sugeda`;
    if (path)
      try {
        setSnapshot(await api.save(path));
        setLogs((l) => [...l, `Saved ${path}`]);
      } catch (e) {
        setLogs((l) => [...l, `SAVE ERROR ${errorText(e, language)}`]);
      }
  };
  const importSpiceLibrary = async () => {
    if (!isDesktop()) {
      setLogs((lines) => [
        ...lines,
        "MODEL IMPORT requires the Tauri desktop app",
      ]);
      return;
    }
    const path = await open({
      multiple: false,
      filters: [
        {
          name: "SPICE model library",
          extensions: ["lib", "cir", "mod", "model", "spice"],
        },
      ],
    });
    if (typeof path !== "string") return;
    try {
      const next = await api.importSpiceLibrary(path);
      setSnapshot(next);
      const imported =
        next.project.spiceLibraries[next.project.spiceLibraries.length - 1];
      setLogs((lines) => [
        ...lines,
        `Imported ${imported?.models.length || 0} models from ${path}`,
      ]);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `MODEL ERROR ${errorText(error, language)}`,
      ]);
      setBottomOpen(true);
      setBottomTab("Console");
    }
  };
  const inspectNetlist = async () => {
    setBottomOpen(true);
    setBottomTab("Netlist");
    try {
      const text = isDesktop()
        ? await api.netlist()
        : "* Browser preview\nV1 in 0 PULSE(0 5 0 1u 1u 5m 10m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 30m\n.end";
      setNetlist(text);
      setLogs((l) => [...l, t("Netlist generated without errors")]);
    } catch (e) {
      setNetlist("");
      setLogs((l) => [...l, `NETLIST ERROR ${errorText(e, language)}`]);
      setBottomTab("Console");
    }
  };
  const run = async () => {
    if (simulationInFlight.current) return;
    simulationInFlight.current = true;
    simulationCancelled.current = false;
    // F5 must commit an active field just as clicking Run does.
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
    setBottomOpen(true);
    setBottomTab("Waveform");
    setRunning(true);
    setSimError(null);
    setResult(null);
    try {
      await pendingEdits.current;
      await inspectNetlist();
      if (simulationCancelled.current)
        throw new Error(t("Simulation cancelled by user"));
      setBottomTab("Waveform");
      if (!isDesktop())
        throw new Error(
          t("Open this project in the Tauri desktop app to run ngspice"),
        );
      const data = await api.run(ngspicePath);
      if (simulationCancelled.current)
        throw new Error(t("Simulation cancelled by user"));
      setResult(data);
      setLogs((l) => [
        ...l,
        `${t("Simulation succeeded")} · ${data.executionTimeMs} ms`,
        data.log,
      ]);
    } catch (e) {
      const message = errorText(e, language);
      setSimError(message);
      setLogs((l) => [...l, `SIMULATION ERROR ${message}`]);
    } finally {
      simulationInFlight.current = false;
      setRunning(false);
    }
  };
  const stop = async () => {
    if (!simulationInFlight.current) return;
    simulationCancelled.current = true;
    try {
      if (isDesktop()) await api.stop();
      setLogs((l) => [...l, t("Cancellation requested")]);
    } catch (error) {
      setLogs((l) => [...l, `STOP ERROR ${errorText(error, language)}`]);
    }
  };
  const updateView = useCallback(
    (zoom: number, pan: Point) => {
      void command({
        action: "updateView",
        zoom,
        pan,
        gridVisible: snapshot.project.uiViewState.gridVisible,
      });
    },
    [command, snapshot.project.uiViewState.gridVisible],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newProject();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? doRedo() : doUndo());
      } else if (e.key === "F5") {
        e.preventDefault();
        void (e.shiftKey ? stop() : run());
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
      )
        remove();
      else if (e.key === "Escape") {
        setPlacement(null);
        setTool("select");
        setSelected([]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const visibleLibrary = useMemo(() => {
    const imported = snapshot.project.spiceLibraries.flatMap((source) =>
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
    const groups = imported.length
      ? [...library, { group: "IMPORTED MODELS", items: imported }]
      : library;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          i.name.toLowerCase().includes(query.toLowerCase()),
        ),
      }))
      .filter((g) => g.items.length);
  }, [query, snapshot.project.spiceLibraries]);
  const updateProfile = (change: Partial<SimulationProfile>) =>
    profile &&
    void command({
      action: "updateSimulation",
      profile: { ...profile, ...change },
    });
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">
            <i />
            <i />
            <i />
          </div>
          <span>SUGAR</span>
          <b>EDA</b>
          <em>ALPHA</em>
        </div>
        <nav className="menus">
          <Menu
            label={t("File")}
            items={[
              [t("New"), "⌘N", newProject],
              [t("Open…"), "⌘O", openProject],
              [t("Save"), "⌘S", () => saveProject()],
              [t("Save As…"), "⇧⌘S", () => saveProject(true)],
            ]}
          />
          <Menu
            label={t("Edit")}
            items={[
              [t("Undo"), "⌘Z", doUndo],
              [t("Redo"), "⇧⌘Z", doRedo],
              [t("Delete"), "⌫", remove],
            ]}
          />
          <Menu
            label={t("View")}
            items={[
              [
                t("Zoom In"),
                "+",
                () =>
                  updateView(
                    Math.min(4, snapshot.project.uiViewState.zoom * 1.2),
                    snapshot.project.uiViewState.pan,
                  ),
              ],
              [
                t("Zoom Out"),
                "−",
                () =>
                  updateView(
                    Math.max(0.2, snapshot.project.uiViewState.zoom / 1.2),
                    snapshot.project.uiViewState.pan,
                  ),
              ],
              [t("Fit"), "F", () => updateView(1, { x: 80, y: 80 })],
              [
                t("Grid"),
                "G",
                () =>
                  command({
                    action: "updateView",
                    zoom: snapshot.project.uiViewState.zoom,
                    pan: snapshot.project.uiViewState.pan,
                    gridVisible: !snapshot.project.uiViewState.gridVisible,
                  }),
              ],
            ]}
          />
          <Menu
            label={t("Simulation")}
            items={[
              [
                t("Configure"),
                "",
                () => {
                  setBottomOpen(true);
                  setBottomTab("Configure");
                },
              ],
              [t("Run"), "F5", run],
              [t("Stop"), "⇧F5", stop],
            ]}
          />
          <Menu
            label={t("Help")}
            items={[
              [
                t("About SugarEDA"),
                "",
                () =>
                  alert(
                    language === "zh-CN"
                      ? "SugarEDA 0.1.0\n专注于原理图和电路仿真的开源工作台。"
                      : "SugarEDA 0.1.0\nA focused open-source circuit workbench.",
                  ),
              ],
            ]}
          />
          <Menu
            label={t("Language")}
            items={[
              [
                `${language === "zh-CN" ? "✓ " : ""}${t("Chinese")}`,
                "",
                () => setLanguage("zh-CN"),
              ],
              [
                `${language === "en" ? "✓ " : ""}${t("English")}`,
                "",
                () => setLanguage("en"),
              ],
            ]}
          />
        </nav>
        <div className="project-title">
          <span className={snapshot.dirty ? "dirty-dot active" : "dirty-dot"} />
          <strong>{t(snapshot.project.metadata.name)}</strong>
          <small>
            {snapshot.dirty
              ? t("Modified")
              : snapshot.path
                ? t("Saved")
                : t("Unsaved")}
          </small>
        </div>
        <div className="run-controls">
          <Button
            variant="outline"
            size="icon"
            className="icon-button"
            title={t("Generate netlist")}
            onClick={inspectNetlist}
          >
            <FileCode2 />
          </Button>
          {running ? (
            <Button variant="destructive" className="stop" onClick={stop}>
              <Square /> {t("Stop")}
            </Button>
          ) : (
            <Button className="run" onClick={run}>
              <Play /> {t("Run")} <kbd>F5</kbd>
            </Button>
          )}
        </div>
      </header>
      <main className={`workspace ${bottomOpen ? "" : "bottom-closed"}`}>
        <aside className="library-panel panel">
          <div className="panel-heading">
            <span>{t("COMPONENTS")}</span>
            <button
              title={t("Import SPICE model library")}
              onClick={() => void importSpiceLibrary()}
            >
              <PackagePlus />
            </button>
          </div>
          <div className="search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Filter library")}
            />
          </div>
          <div className="library-scroll">
            {visibleLibrary.map((group) => (
              <section key={group.group}>
                <h3>
                  {t(group.group)}
                  <span>{group.items.length}</span>
                </h3>
                {group.items.map((item) => (
                  <div
                    className={`library-item ${placement?.kind === item.kind && placement?.model?.modelName === item.model?.modelName ? "placing" : ""}`}
                    role="button"
                    tabIndex={0}
                    title={
                      language === "zh-CN"
                        ? "点击后在画布放置，也可直接拖拽"
                        : "Click, then place on canvas; or drag directly"
                    }
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      window.getSelection()?.removeAllRanges();
                      document.body.classList.add("component-dragging");
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const next = { kind: item.kind, model: item.model };
                      libraryPointer.current = {
                        placement: next,
                        start: { x: event.clientX, y: event.clientY },
                        label: t(item.name),
                      };
                      setDragPreview({
                        x: event.clientX,
                        y: event.clientY,
                        label: t(item.name),
                      });
                    }}
                    onPointerMove={(event) => {
                      if (libraryPointer.current) {
                        event.preventDefault();
                        setDragPreview({
                          x: event.clientX,
                          y: event.clientY,
                          label: libraryPointer.current.label,
                        });
                      }
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const active = libraryPointer.current;
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      )
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      endLibraryDrag();
                      if (!active) return;
                      const moved =
                        Math.hypot(
                          event.clientX - active.start.x,
                          event.clientY - active.start.y,
                        ) > 6;
                      if (!moved) {
                        setTool("select");
                        setPlacement(active.placement);
                        return;
                      }
                      const canvas = document.querySelector<HTMLCanvasElement>(
                        "[data-testid='schematic-canvas']",
                      );
                      const bounds = canvas?.getBoundingClientRect();
                      if (
                        bounds &&
                        event.clientX >= bounds.left &&
                        event.clientX <= bounds.right &&
                        event.clientY >= bounds.top &&
                        event.clientY <= bounds.bottom
                      ) {
                        setExternalDrop({
                          id: Date.now(),
                          placement: active.placement,
                          screen: {
                            x: event.clientX - bounds.left,
                            y: event.clientY - bounds.top,
                          },
                        });
                      }
                    }}
                    onPointerCancel={endLibraryDrag}
                    onLostPointerCapture={endLibraryDrag}
                    onDragStart={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setTool("select");
                        setPlacement({ kind: item.kind, model: item.model });
                      }
                    }}
                    key={`${item.kind}-${item.model?.libraryId || "builtin"}-${item.name}`}
                  >
                    <div className="symbol-mini">{item.glyph}</div>
                    <span>{t(item.name)}</span>
                    <kbd>{item.shortcut}</kbd>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <div className="library-foot">
            {snapshot.project.spiceLibraries.length
              ? `${snapshot.project.spiceLibraries.length} ${t("model libraries embedded")}`
              : t("Import a vendor model or drag a device")}
          </div>
        </aside>
        <section className="editor">
          <TooltipProvider delayDuration={300}>
            <div className="editor-tools">
              <div className="tool-group">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={tool === "select" ? "active" : ""}
                      onClick={() => setTool("select")}
                    >
                      <MousePointer2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Select and move")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={tool === "wire" ? "active" : ""}
                      onClick={() => setTool("wire")}
                    >
                      <Cable />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Draw orthogonal wire")}</TooltipContent>
                </Tooltip>
              </div>
              <div className="tool-group">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!selected.length}
                      onClick={() =>
                        selectedComponent &&
                        command({
                          action: "rotateComponent",
                          id: selectedComponent.id,
                        })
                      }
                    >
                      <RotateCw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Rotate 90°")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!selected.length}
                      onClick={remove}
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Delete selection")}</TooltipContent>
                </Tooltip>
              </div>
              <span className="mode-readout">
                {tool === "wire"
                  ? t("WIRE · Click two endpoints")
                  : placement
                    ? language === "zh-CN"
                      ? `放置 ${t(visibleLibrary.flatMap((group) => group.items).find((item) => item.kind === placement.kind && item.model?.modelName === placement.model?.modelName)?.name || placement.kind)} · 点击画布，Esc 取消`
                      : "PLACE · Click canvas, Esc to cancel"
                    : sheet.wires.some((wire) => selected.includes(wire.id))
                      ? t("SELECT · Drag wire handles to reshape")
                      : t("SELECT · Drag to move, space to pan")}
              </span>
            </div>
          </TooltipProvider>
          <SchematicCanvas
            project={snapshot.project}
            selectedIds={selected}
            tool={tool}
            onSelect={setSelected}
            onCommand={(c) => void command(c)}
            onCursor={setCursor}
            onView={updateView}
            placement={placement}
            onPlacementComplete={() => setPlacement(null)}
            externalDrop={externalDrop}
            onExternalDropComplete={() => setExternalDrop(null)}
          />
        </section>
        <aside className="inspector panel">
          <div className="panel-heading">
            <span>{t("INSPECTOR")}</span>
            <small>{selectedComponent?.spiceRef || t("NO SELECTION")}</small>
          </div>
          {selectedComponent ? (
            <ComponentInspector
              component={selectedComponent}
              onUpdate={(name, ref, value) =>
                void command({
                  action: "updateComponent",
                  id: selectedComponent.id,
                  displayName: name,
                  spiceRef: ref,
                  value,
                })
              }
              onRotate={() =>
                void command({
                  action: "rotateComponent",
                  id: selectedComponent.id,
                })
              }
            />
          ) : (
            <div className="inspector-empty">
              <div className="crosshair">⌖</div>
              <strong>{t("Nothing selected")}</strong>
              <p>
                {t("Select a component to edit its electrical properties.")}
              </p>
            </div>
          )}
          <div className="design-info">
            <h3>{t("DOCUMENT")}</h3>
            <dl>
              <dt>{t("Sheet")}</dt>
              <dd>{t("Main")} · 1 / 1</dd>
              <dt>{t("Components")}</dt>
              <dd>{sheet.components.length}</dd>
              <dt>{t("Nets")}</dt>
              <dd>{sheet.wires.length}</dd>
              <dt>{t("Schema")}</dt>
              <dd>v{snapshot.project.schemaVersion}</dd>
            </dl>
          </div>
        </aside>
        <section className="bottom-panel">
          <Tabs
            value={bottomTab}
            onValueChange={(tab) => {
              setBottomOpen(true);
              setBottomTab(tab);
            }}
            className="bottom-tabs"
          >
            <TabsList className="tabs-list">
              {["Configure", "Netlist", "Console", "Waveform"].map((tab) => (
                <TabsTrigger
                  key={tab}
                  className={bottomTab === tab ? "active" : ""}
                  value={tab}
                >
                  {t(tab)}
                  {tab === "Console" &&
                    logs.some((l) => l.includes("ERROR")) && <i />}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="sim-health">
              <span className={status.available ? "led ok" : "led"} />
              {status.available
                ? status.version || "ngspice ready"
                : t("ngspice offline")}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="collapse"
              onClick={() => setBottomOpen((v) => !v)}
              title={t("Collapse panel")}
            >
              {bottomOpen ? "⌄" : "⌃"}
            </Button>
          </Tabs>
          <div className="bottom-content">
            {bottomTab === "Waveform" && (
              <Waveform result={result} running={running} error={simError} />
            )}{" "}
            {bottomTab === "Netlist" && (
              <div className="netlist-view">
                <pre>
                  {netlist ||
                    (language === "zh-CN"
                      ? "点击“重新生成”查看确定性的 SPICE 网表。"
                      : "Generate the netlist to inspect the deterministic SPICE deck.")}
                </pre>
                <button onClick={inspectNetlist}>
                  {language === "zh-CN" ? "重新生成" : "Regenerate"}
                </button>
              </div>
            )}{" "}
            {bottomTab === "Console" && (
              <div className="console-view">
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={line.includes("ERROR") ? "error" : ""}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {line}
                  </div>
                ))}
              </div>
            )}{" "}
            {bottomTab === "Configure" && profile && (
              <SimulationConfig
                profile={profile}
                path={ngspicePath}
                status={status}
                onPath={setNgspicePath}
                onRefresh={async () =>
                  setStatus(
                    isDesktop() ? await api.status(ngspicePath) : status,
                  )
                }
                onUpdate={updateProfile}
              />
            )}
          </div>
        </section>
      </main>
      <footer className="statusbar">
        <span className="status-brand">S</span>
        <span>
          {language === "zh-CN"
            ? snapshot.dirty
              ? "未保存更改"
              : "文档就绪"
            : snapshot.dirty
              ? "UNSAVED CHANGES"
              : "DOCUMENT READY"}
        </span>
        <span className="spacer" />
        <span>
          X {Math.round(cursor.x)} &nbsp; Y {Math.round(cursor.y)}
        </span>
        <span>
          {language === "zh-CN" ? "网格" : "GRID"}{" "}
          {snapshot.project.uiViewState.gridVisible
            ? "20 px"
            : language === "zh-CN"
              ? "关闭"
              : "OFF"}
        </span>
        <span>{Math.round(snapshot.project.uiViewState.zoom * 100)}%</span>
        <span className={status.available ? "backend ok" : "backend"}>
          {status.available
            ? language === "zh-CN"
              ? "● 仿真器就绪"
              : "● SOLVER READY"
            : language === "zh-CN"
              ? "○ 仿真器离线"
              : "○ SOLVER OFFLINE"}
        </span>
      </footer>
      {dragPreview && (
        <div
          className="component-drag-preview"
          style={{
            transform: `translate(${dragPreview.x + 14}px, ${dragPreview.y + 14}px)`,
          }}
        >
          <span>＋</span>
          {dragPreview.label}
        </div>
      )}
    </div>
  );
}

function Menu({
  label,
  items,
}: {
  label: string;
  items: [string, string, () => void | Promise<void>][];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="menu-trigger">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="menu-popover">
        {items.map(([name, key, action], index) => (
          <div key={name}>
            {index === 2 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => void action()}>
              <span>{name}</span>
              <kbd>{key}</kbd>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function ComponentInspector({
  component,
  onUpdate,
  onRotate,
}: {
  component: Component;
  onUpdate: (name: string, ref: string, value: string) => void;
  onRotate: () => void;
}) {
  const { language } = useI18n();
  const [name, setName] = useState(component.displayName),
    [ref, setRef] = useState(component.spiceRef),
    [value, setValue] = useState(component.parameters.value || "");
  useEffect(() => {
    setName(component.displayName);
    setRef(component.spiceRef);
    setValue(component.parameters.value || "");
  }, [component]);
  const valid = !/[;\n\r]/.test(value) && value.length <= 128;
  return (
    <div className="property-form">
      <div className="selection-banner">
        <span>{component.kind.replace(/([A-Z])/g, " $1")}</span>
        <b>
          {component.kind === "netLabel"
            ? component.parameters.value || "NET"
            : component.spiceRef || "GND"}
        </b>
      </div>
      <label>
        {language === "zh-CN" ? "显示名称" : "DISPLAY NAME"}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onUpdate(name, ref, value)}
        />
      </label>
      {component.kind !== "ground" && (
        <>
          {component.kind !== "netLabel" && (
            <label>
              {language === "zh-CN" ? "位号" : "REFERENCE"}
              <input
                className={!ref ? "invalid" : ""}
                value={ref}
                onChange={(e) => setRef(e.target.value.toUpperCase())}
                onBlur={() => onUpdate(name, ref, value)}
              />
            </label>
          )}
          {component.model ? (
            <label>
              {language === "zh-CN" ? "SPICE 模型" : "SPICE MODEL"}
              <input value={component.model.modelName} readOnly />
              <small className="model-kind">
                {component.model.kind} ·{" "}
                {language === "zh-CN" ? "嵌入模型库" : "embedded library"}
              </small>
            </label>
          ) : (
            <label>
              {component.kind === "netLabel"
                ? language === "zh-CN"
                  ? "网络名称"
                  : "NET NAME"
                : language === "zh-CN"
                  ? "SPICE 参数值"
                  : "SPICE VALUE"}
              <input
                className={!valid ? "invalid" : ""}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => valid && onUpdate(name, ref, value)}
              />
              {!valid && (
                <small className="field-error">
                  {language === "zh-CN"
                    ? "不能包含控制字符或分号。"
                    : "Control characters and semicolons are not allowed."}
                </small>
              )}
            </label>
          )}
        </>
      )}
      <div className="coordinate-row">
        <label>
          X<input value={component.position.x} readOnly />
        </label>
        <label>
          Y<input value={component.position.y} readOnly />
        </label>
      </div>
      <button className="property-action" onClick={onRotate}>
        ↻ {language === "zh-CN" ? "旋转 90°" : "Rotate 90°"}{" "}
        <span>{component.rotation}°</span>
      </button>
      <h3>{language === "zh-CN" ? "引脚" : "PINS"}</h3>
      {component.pins.map((pin) => (
        <div className="pin-row" key={pin.id}>
          <i />
          {pin.id}
          <span>{pin.name}</span>
        </div>
      ))}
    </div>
  );
}
export default App;
