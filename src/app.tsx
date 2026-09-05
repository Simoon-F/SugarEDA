import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./app.css";
import { api, isDesktop } from "./bridge";
import { createBlankSnapshot } from "./blank";
import { SchematicCanvas } from "./schematic-canvas";
import { Waveform } from "./waveform";
import { SimulationConfig } from "./simulation-config";
import { SimulationCheckPanel } from "./simulation-check-panel";
import { RecoveryDialog, UnsavedChangesDialog } from "./reliability-dialogs";
import { DevicePackManager } from "./device-pack-manager";
import { ErcPanel } from "./erc-panel";
import { placeLocalDeviceUnit } from "./device-unit-factory";
import { removeOrphanDeviceInstances } from "./device-instance";
import { buildVisibleLibrary, type LibraryGroup } from "./component-library";
import {
  clipboardFromSelection,
  instantiateClipboard,
  type ClipboardPayload,
} from "./selection-clipboard";
import {
  availableProbeOptions,
  localSimulationCheck,
} from "./simulation-check";
import {
  GRID,
  moveWireEndpoint,
  moveWireWithComponent,
  pinPosition,
  samePoint,
} from "./schematic-geometry";
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
  Clock3,
  FileCode2,
  MousePointer2,
  PackagePlus,
  Play,
  RotateCw,
  Save,
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
  RecentProject,
  RecoveryInfo,
  SimulationProfile,
  SimulationCheckReport,
  SimulationResult,
  Snapshot,
  Wire,
  ErcReport,
} from "./types";

type PendingTransition = {
  destination: string;
  action: () => Promise<void>;
};

const isTextEditing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const translatedPoints = (points: Point[], delta: Point) =>
  points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));

function moveLocalSelection(
  components: Component[],
  wires: Wire[],
  componentIds: string[],
  wireIds: string[],
  delta: Point,
) {
  const componentIdSet = new Set(componentIds);
  const wireIdSet = new Set(wireIds);
  const attachedPins = components
    .filter(
      (component) =>
        componentIdSet.has(component.id) && component.kind !== "netLabel",
    )
    .flatMap((component) =>
      component.pins.map((pin) => pinPosition(component, pin.offset)),
    );
  for (const component of components)
    if (componentIdSet.has(component.id))
      component.position = {
        x: component.position.x + delta.x,
        y: component.position.y + delta.y,
      };
  for (const wire of wires) {
    if (wireIdSet.has(wire.id)) {
      wire.points = translatedPoints(wire.points, delta);
      continue;
    }
    if (attachedPins.some((pin) => samePoint(pin, wire.points[0])))
      wire.points = moveWireEndpoint(wire.points, "start", {
        x: wire.points[0].x + delta.x,
        y: wire.points[0].y + delta.y,
      });
    const end = wire.points[wire.points.length - 1];
    if (attachedPins.some((pin) => samePoint(pin, end)))
      wire.points = moveWireEndpoint(wire.points, "end", {
        x: end.x + delta.x,
        y: end.y + delta.y,
      });
  }
}

const library: LibraryGroup[] = [
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
        : `探针“${quoted[0] || "未知"}”引用了不可用的网络或器件。`;
    case "invalid_probe":
      return `探针表达式“${quoted[0] || ""}”无效。请使用 v(out)、v(out,in) 或 i(v1)。`;
    case "missing_ground":
      return "原理图缺少接地参考。请放置 Ground 并把其绿色引脚接入电路。";
    case "floating_pin":
      return `引脚“${message.match(/Pin\s+([^\s]+)/)?.[1] || "未知"}”未建立电气连接。`;
    case "invalid_label":
      return `网络标签“${quoted[0] || ""}”名称无效。`;
    case "conflicting_labels":
      return `同一网络存在冲突的标签：${message}`;
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
  const clipboard = useRef<ClipboardPayload | null>(null);
  const pasteSequence = useRef(0);
  const reservedReferences = useRef(new Set<string>());
  const libraryPointer = useRef<{
    placement: ComponentPlacement;
    start: Point;
    label: string;
  } | null>(null);
  const simulationInFlight = useRef(false);
  const simulationCancelled = useRef(false);
  const bootstrapStarted = useRef(false);
  const dirtyRef = useRef(false);
  const closingRef = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    createBlankSnapshot(),
  );
  const acceptSnapshot = useCallback((next: Snapshot) => {
    dirtyRef.current = next.dirty;
    setSnapshot(next);
  }, []);
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
  const [checkReport, setCheckReport] = useState<SimulationCheckReport | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [ercReport, setErcReport] = useState<ErcReport | null>(null);
  const [ercChecking, setErcChecking] = useState(false);
  const [packManagerOpen, setPackManagerOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    componentId: string;
    nonce: number;
  } | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [autosaveState, setAutosaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] =
    useState<PendingTransition | null>(null);
  const [transitionSaving, setTransitionSaving] = useState(false);
  const [query, setQuery] = useState("");
  const sheet = snapshot.project.sheets[0];
  const selectedComponent = sheet.components.find((c) => c.id === selected[0]);
  const profile =
    snapshot.project.simulationProfiles.find(
      (p) => p.id === snapshot.project.activeSimulationProfile,
    ) || snapshot.project.simulationProfiles[0];
  dirtyRef.current = snapshot.dirty;
  useEffect(
    () => () => document.body.classList.remove("component-dragging"),
    [],
  );
  useEffect(() => {
    if (!isDesktop()) {
      setStatus({
        available: false,
        executable: "ngspice",
        version: null,
        message: t(
          "Browser preview — simulation is available in the Tauri desktop app",
        ),
      });
      return;
    }
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void api
      .snapshot()
      .then(acceptSnapshot)
      .catch((error) =>
        setLogs((lines) => [
          ...lines,
          `WORKSPACE ERROR ${errorText(error, language)}`,
        ]),
      );
    void api
      .status()
      .then(setStatus)
      .catch((error) =>
        setStatus({
          available: false,
          executable: "ngspice",
          version: null,
          message: errorText(error, language),
        }),
      );
    void api
      .recentProjects()
      .then(setRecentProjects)
      .catch((error) =>
        setLogs((lines) => [
          ...lines,
          `RECENT PROJECTS ERROR ${errorText(error, language)}`,
        ]),
      );
    void api
      .recoveryStatus()
      .then(setRecovery)
      .catch((error) =>
        setLogs((lines) => [
          ...lines,
          `RECOVERY ERROR ${errorText(error, language)}`,
        ]),
      );
  }, [acceptSnapshot, language, t]);

  useEffect(() => {
    if (!isDesktop() || !snapshot.dirty || recovery) return;
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      void pendingEdits.current
        .then(() => api.autosave())
        .then((info) => {
          if (!info) {
            setAutosaveState("idle");
            return;
          }
          setAutosavedAt(info.savedAt);
          setAutosaveState("saved");
        })
        .catch((error) => {
          setAutosaveState("error");
          setLogs((lines) => [
            ...lines,
            `AUTOSAVE ERROR ${errorText(error, language)}`,
          ]);
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [language, recovery, snapshot.dirty, snapshot.project.updatedAt]);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (closingRef.current) return;
        if (!dirtyRef.current) return;
        event.preventDefault();
        setPendingTransition({
          destination: t("Close SugarEDA"),
          action: async () => {
            closingRef.current = true;
            await api.discardRecovery();
            await getCurrentWindow().destroy();
          },
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [t]);
  const localApply = useCallback((command: EditorCommand) => {
    dirtyRef.current = true;
    setSnapshot((current) => {
      const next = structuredClone(current);
      if (command.action === "moveComponent") {
        const c = next.project.sheets[0].components.find(
          (c) => c.id === command.id,
        );
        if (c) {
          next.project.sheets[0].wires = next.project.sheets[0].wires.map(
            (wire) => ({
              ...wire,
              points: moveWireWithComponent(wire.points, c, command.position),
            }),
          );
          c.position = command.position;
        }
      } else if (command.action === "moveSelection") {
        moveLocalSelection(
          next.project.sheets[0].components,
          next.project.sheets[0].wires,
          command.componentIds,
          command.wireIds,
          command.delta,
        );
      } else if (command.action === "updateComponent") {
        const c = next.project.sheets[0].components.find(
          (c) => c.id === command.id,
        );
        if (c) {
          const logicalId = c.device?.logicalInstanceId;
          if (logicalId) {
            const instance = next.project.deviceInstances.find(
              (item) => item.id === logicalId,
            );
            if (instance) {
              instance.displayName = command.displayName;
              instance.reference = command.spiceRef;
            }
            for (const unit of next.project.sheets.flatMap(
              (sheet) => sheet.components,
            ))
              if (unit.device?.logicalInstanceId === logicalId) {
                unit.displayName = command.displayName;
                unit.spiceRef = command.spiceRef;
              }
          } else {
            c.displayName = command.displayName;
            c.spiceRef = command.spiceRef;
          }
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
        removeOrphanDeviceInstances(next.project);
      } else if (command.action === "insertSelection") {
        next.project.deviceInstances.push(...command.deviceInstances);
        next.project.sheets[0].components.push(...command.components);
        next.project.sheets[0].wires.push(...command.wires);
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
        if (i >= 0) next.project.simulationProfiles[i] = command.profile;
        else next.project.simulationProfiles.push(command.profile);
      } else if (command.action === "addSimulationProfile") {
        next.project.simulationProfiles.push(command.profile);
        next.project.activeSimulationProfile = command.profile.id;
      } else if (command.action === "deleteSimulationProfile") {
        if (next.project.simulationProfiles.length <= 1) return current;
        next.project.simulationProfiles =
          next.project.simulationProfiles.filter(
            (profile) => profile.id !== command.id,
          );
        if (next.project.activeSimulationProfile === command.id)
          next.project.activeSimulationProfile =
            next.project.simulationProfiles[0]?.id ?? null;
      } else if (command.action === "selectSimulationProfile") {
        if (
          next.project.simulationProfiles.some(
            (profile) => profile.id === command.id,
          )
        )
          next.project.activeSimulationProfile = command.id;
      } else if (command.action === "addModelComponent") {
        const definition = next.project.spiceLibraries
          .find((source) => source.id === command.libraryId)
          ?.models.find((model) => model.name === command.modelName);
        if (!definition) return current;
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
      } else if (command.action === "addDeviceComponent") {
        if (!placeLocalDeviceUnit(next.project, command)) return current;
      } else if (command.action === "setPinNoConnect") {
        const component = next.project.sheets[0].components.find(
          (item) => item.id === command.componentId,
        );
        const pin = component?.pins.find((item) => item.id === command.pinId);
        if (pin) pin.noConnect = command.noConnect;
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
        if (!defaultsForKind) return current;
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
      return next;
    });
  }, []);
  const command = useCallback(
    async (c: EditorCommand) => {
      if (c.action !== "updateView") {
        setCheckReport(null);
        setErcReport(null);
      }
      const task = pendingEdits.current.then(async () => {
        try {
          if (isDesktop()) acceptSnapshot(await api.apply(c));
          else localApply(c);
        } catch (e) {
          setLogs((l) => [...l, `ERROR ${errorText(e, language)}`]);
        }
      });
      pendingEdits.current = task;
      await task;
    },
    [acceptSnapshot, language, localApply],
  );
  const handleCanvasCommand = useCallback(
    (nextCommand: EditorCommand) => void command(nextCommand),
    [command],
  );
  const completePlacement = useCallback(() => setPlacement(null), []);
  const completeExternalDrop = useCallback(() => setExternalDrop(null), []);
  const doUndo = useCallback(async () => {
    if (isDesktop()) acceptSnapshot(await api.undo());
  }, [acceptSnapshot]);
  const doRedo = useCallback(async () => {
    if (isDesktop()) acceptSnapshot(await api.redo());
  }, [acceptSnapshot]);
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
  const copySelection = useCallback(() => {
    const ids = new Set(selected);
    const payload = clipboardFromSelection(snapshot.project, ids);
    if (!payload.components.length && !payload.wires.length) return false;
    clipboard.current = payload;
    pasteSequence.current = 0;
    return true;
  }, [selected, snapshot.project]);
  const pasteSelection = useCallback(
    async (source = clipboard.current, steps?: number) => {
      if (!source) return;
      const sequence = steps ?? pasteSequence.current + 1;
      const inserted = instantiateClipboard(
        source,
        sheet,
        {
          x: GRID * sequence,
          y: GRID * sequence,
        },
        reservedReferences.current,
      );
      pasteSequence.current = sequence;
      await command({
        action: "insertSelection",
        components: inserted.components,
        wires: inserted.wires,
        deviceInstances: inserted.deviceInstances,
      });
      setSelected([
        ...inserted.components.map((component) => component.id),
        ...inserted.wires.map((wire) => wire.id),
      ]);
      setTool("select");
    },
    [command, sheet],
  );
  const duplicateSelection = useCallback(async () => {
    if (!copySelection()) return;
    await pasteSelection(clipboard.current, 1);
  }, [copySelection, pasteSelection]);
  const nudgeSelection = useCallback(
    (delta: Point) => {
      if (!selected.length) return;
      const componentIds = selected.filter((id) =>
        sheet.components.some((component) => component.id === id),
      );
      const wireIds = selected.filter((id) =>
        sheet.wires.some((wire) => wire.id === id),
      );
      void command({
        action: "moveSelection",
        componentIds,
        wireIds,
        delta,
      });
    },
    [command, selected, sheet.components, sheet.wires],
  );
  const resetWorkspaceUi = () => {
    setSelected([]);
    setResult(null);
    setCheckReport(null);
    setAutosaveState("idle");
    setAutosavedAt(null);
  };
  const refreshRecentProjects = async () => {
    try {
      setRecentProjects(await api.recentProjects());
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `RECENT PROJECTS ERROR ${errorText(error, language)}`,
      ]);
    }
  };
  const continueOrPrompt = async (
    destination: string,
    action: () => Promise<void>,
  ) => {
    await pendingEdits.current;
    if (dirtyRef.current) {
      setPendingTransition({ destination, action });
      return;
    }
    await action();
  };
  const newProject = async () => {
    await continueOrPrompt(t("Create a new project"), async () => {
      if (isDesktop()) acceptSnapshot(await api.newProject());
      else acceptSnapshot(createBlankSnapshot());
      resetWorkspaceUi();
    });
  };
  const openProject = async () => {
    if (!isDesktop()) return;
    await continueOrPrompt(t("Open another project"), async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: "SugarEDA project", extensions: ["sugeda"] }],
      });
      if (typeof path === "string") await loadProject(path);
    });
  };
  const loadProject = async (path: string) => {
    try {
      acceptSnapshot(await api.load(path));
      resetWorkspaceUi();
      await refreshRecentProjects();
      setLogs((lines) => [...lines, `Opened ${path}`]);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `OPEN ERROR ${errorText(error, language)}`,
      ]);
      setBottomOpen(true);
      setBottomTab("Console");
    }
  };
  const openRecentProject = async (entry: RecentProject) => {
    if (!entry.exists) {
      try {
        setRecentProjects(await api.forgetRecentProject(entry.path));
        setLogs((lines) => [
          ...lines,
          `${t("Removed missing recent project")}: ${entry.path}`,
        ]);
      } catch (error) {
        setLogs((lines) => [
          ...lines,
          `RECENT PROJECTS ERROR ${errorText(error, language)}`,
        ]);
      }
      return;
    }
    await continueOrPrompt(t("Open another project"), () =>
      loadProject(entry.path),
    );
  };
  const saveProject = async (as = false): Promise<boolean> => {
    if (!isDesktop()) return false;
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    await pendingEdits.current;
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
        acceptSnapshot(await api.save(path));
        await refreshRecentProjects();
        setAutosaveState("idle");
        setAutosavedAt(null);
        setLogs((l) => [...l, `Saved ${path}`]);
        return true;
      } catch (e) {
        setLogs((l) => [...l, `SAVE ERROR ${errorText(e, language)}`]);
        setBottomOpen(true);
        setBottomTab("Console");
      }
    return false;
  };
  const saveAndContinue = async () => {
    if (!pendingTransition) return;
    setTransitionSaving(true);
    const transition = pendingTransition;
    if (await saveProject()) {
      try {
        await transition.action();
        setPendingTransition(null);
      } catch (error) {
        setPendingTransition(null);
        setLogs((lines) => [
          ...lines,
          `TRANSITION ERROR ${errorText(error, language)}`,
        ]);
        setBottomOpen(true);
        setBottomTab("Console");
      }
    }
    setTransitionSaving(false);
  };
  const discardAndContinue = async () => {
    if (!pendingTransition) return;
    const transition = pendingTransition;
    setTransitionSaving(true);
    try {
      await transition.action();
      setPendingTransition(null);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `TRANSITION ERROR ${errorText(error, language)}`,
      ]);
      setBottomOpen(true);
      setBottomTab("Console");
    } finally {
      setTransitionSaving(false);
    }
  };
  const restoreAutosave = async () => {
    setRecoveryBusy(true);
    try {
      acceptSnapshot(await api.restoreRecovery());
      setRecovery(null);
      resetWorkspaceUi();
      setAutosaveState("saved");
      setLogs((lines) => [...lines, t("Recovered autosaved project")]);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `RECOVERY ERROR ${errorText(error, language)}`,
      ]);
    } finally {
      setRecoveryBusy(false);
    }
  };
  const discardAutosave = async () => {
    setRecoveryBusy(true);
    try {
      await api.discardRecovery();
      setRecovery(null);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `RECOVERY ERROR ${errorText(error, language)}`,
      ]);
    } finally {
      setRecoveryBusy(false);
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
      acceptSnapshot(next);
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
  const importDevicePack = async () => {
    if (!isDesktop()) {
      setLogs((lines) => [
        ...lines,
        "DEVICE PACK IMPORT requires the Tauri desktop app",
      ]);
      return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: "SugarEDA DevicePack", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const next = await api.importDevicePack(path);
      acceptSnapshot(next);
      setLogs((lines) => [
        ...lines,
        `${t("Imported device pack")}: ${next.project.devicePacks[next.project.devicePacks.length - 1]?.pack.manifest.name ?? path}`,
      ]);
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `DEVICE PACK ERROR ${errorText(error, language)}`,
      ]);
      setBottomOpen(true);
      setBottomTab("Console");
    }
  };

  const checkErc = async () => {
    setBottomOpen(true);
    setBottomTab("ERC");
    setErcChecking(true);
    try {
      await pendingEdits.current;
      setErcReport(
        isDesktop()
          ? await api.erc()
          : {
              passed: true,
              issues: [],
              checkedDevices: sheet.components.filter(
                (item) => item.kind === "device",
              ).length,
              checkedPins: sheet.components
                .filter((item) => item.kind === "device")
                .reduce((sum, item) => sum + item.pins.length, 0),
            },
      );
    } catch (error) {
      setLogs((lines) => [...lines, `ERC ERROR ${errorText(error, language)}`]);
    } finally {
      setErcChecking(false);
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
      setLogs((l) => [...l, t("Netlist generation succeeded")]);
    } catch (e) {
      setNetlist("");
      setLogs((l) => [...l, `NETLIST ERROR ${errorText(e, language)}`]);
      setBottomTab("Console");
    }
  };
  const checkSimulation = async () => {
    if (!profile) return null;
    setBottomOpen(true);
    setBottomTab("Check");
    setChecking(true);
    try {
      await pendingEdits.current;
      const report = isDesktop()
        ? await api.check()
        : localSimulationCheck(snapshot.project, profile);
      setCheckReport(report);
      if (report.netlist) setNetlist(report.netlist);
      return report;
    } catch (error) {
      setLogs((lines) => [
        ...lines,
        `CHECK ERROR ${errorText(error, language)}`,
      ]);
      return null;
    } finally {
      setChecking(false);
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
    setBottomTab("Check");
    setRunning(false);
    setSimError(null);
    setResult(null);
    try {
      await pendingEdits.current;
      const report = await checkSimulation();
      if (!report?.ready) {
        const message = report
          ? `${report.issues.length} ${t("simulation check issues must be resolved")}`
          : t("Simulation check failed");
        setSimError(message);
        setLogs((lines) => [...lines, `CHECK ${message}`]);
        return;
      }
      setLogs((lines) => [...lines, t("Netlist generation succeeded")]);
      if (simulationCancelled.current)
        throw new Error(t("Simulation cancelled by user"));
      setBottomTab("Waveform");
      setRunning(true);
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
        `${t("Simulation computation succeeded")} · ${data.executionTimeMs} ms`,
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
      const editing = isTextEditing(e.target);
      const keyName = e.key.toLowerCase();
      if (
        editing &&
        ((mod && ["c", "v", "d"].includes(keyName)) ||
          e.key.startsWith("Arrow") ||
          e.key === "Delete" ||
          e.key === "Backspace")
      )
        return;
      if (mod && keyName === "c") {
        if (copySelection()) e.preventDefault();
      } else if (mod && keyName === "v") {
        if (clipboard.current) {
          e.preventDefault();
          void pasteSelection();
        }
      } else if (mod && keyName === "d") {
        if (selected.length) {
          e.preventDefault();
          void duplicateSelection();
        }
      } else if (mod && keyName === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && keyName === "o") {
        e.preventDefault();
        void openProject();
      } else if (mod && keyName === "n") {
        e.preventDefault();
        void newProject();
      } else if (mod && keyName === "z") {
        e.preventDefault();
        void (e.shiftKey ? doRedo() : doUndo());
      } else if (e.key === "F4" && e.shiftKey) {
        e.preventDefault();
        void checkSimulation();
      } else if (e.key === "F5") {
        e.preventDefault();
        void (e.shiftKey ? stop() : run());
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelection({ x: e.shiftKey ? -GRID : -1, y: 0 });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelection({ x: e.shiftKey ? GRID : 1, y: 0 });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeSelection({ x: 0, y: e.shiftKey ? -GRID : -1 });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeSelection({ x: 0, y: e.shiftKey ? GRID : 1 });
      } else if (e.key === "Delete" || e.key === "Backspace") remove();
      else if (e.key === "Escape") {
        setPlacement(null);
        setTool("select");
        setSelected([]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const visibleLibrary = useMemo(
    () => buildVisibleLibrary(library, snapshot.project, query),
    [query, snapshot.project],
  );
  const probeOptions = useMemo(
    () => availableProbeOptions(snapshot.project),
    [snapshot.project],
  );
  const updateProfile = (change: Partial<SimulationProfile>) =>
    profile &&
    void command({
      action: "updateSimulation",
      profile: { ...profile, ...change },
    });
  const addProfile = () => {
    if (!profile) return;
    void command({
      action: "addSimulationProfile",
      profile: {
        ...structuredClone(profile),
        id: crypto.randomUUID(),
        name: `${t("Simulation")} ${snapshot.project.simulationProfiles.length + 1}`,
      },
    });
  };
  const deleteProfile = () =>
    profile &&
    void command({ action: "deleteSimulationProfile", id: profile.id });
  const selectProfile = (id: string) =>
    void command({ action: "selectSimulationProfile", id });
  const locateCheckIssue = (componentId: string) => {
    setTool("select");
    setPlacement(null);
    setSelected([componentId]);
    setFocusRequest({ componentId, nonce: Date.now() });
  };
  return (
    <div className="app-shell" data-testid="app-shell">
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
          <FileMenu
            recentProjects={recentProjects}
            onNew={newProject}
            onOpen={openProject}
            onSave={() => saveProject()}
            onSaveAs={() => saveProject(true)}
            onOpenRecent={openRecentProject}
          />
          <Menu
            label={t("Edit")}
            items={[
              [t("Undo"), "⌘Z", doUndo],
              [t("Redo"), "⇧⌘Z", doRedo],
              [t("Copy"), "⌘C", copySelection],
              [t("Paste"), "⌘V", () => pasteSelection()],
              [t("Duplicate"), "⌘D", duplicateSelection],
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
              [t("Simulation check"), "⇧F4", checkSimulation],
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
            label={t("Tools")}
            items={[
              [t("Device pack manager"), "", () => setPackManagerOpen(true)],
              [t("Import SPICE model library"), "", importSpiceLibrary],
              [t("Electrical rules check"), "", checkErc],
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
                      ? "SugarEDA 0.2.0 Alpha\n专注于原理图和电路仿真的开源工作台。"
                      : "SugarEDA 0.2.0 Alpha\nA focused open-source circuit workbench.",
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
        <div className="project-title" data-testid="project-state">
          <span className={snapshot.dirty ? "dirty-dot active" : "dirty-dot"} />
          <strong>{t(snapshot.project.metadata.name)}</strong>
          <small>
            {snapshot.dirty
              ? autosaveState === "saved"
                ? `${t("Recovery saved")} · ${
                    autosavedAt
                      ? new Date(autosavedAt).toLocaleTimeString(language, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : t("just now")
                  }`
                : autosaveState === "saving"
                  ? t("Autosaving…")
                  : autosaveState === "error"
                    ? t("Autosave failed")
                    : t("Modified")
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
              title={t("Device pack manager")}
              onClick={() => setPackManagerOpen(true)}
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
                    className={`library-item ${
                      placement?.kind === item.kind &&
                      placement?.model?.modelName === item.model?.modelName &&
                      placement?.device?.packSha256 ===
                        ("device" in item
                          ? item.device?.packSha256
                          : undefined) &&
                      placement?.device?.deviceId ===
                        ("device" in item
                          ? item.device?.deviceId
                          : undefined) &&
                      placement?.device?.unitId ===
                        ("device" in item ? item.device?.unitId : undefined)
                        ? "placing"
                        : ""
                    }`}
                    data-testid={`library-${item.kind}`}
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
                      const next = {
                        kind: item.kind,
                        model: item.model,
                        device: "device" in item ? item.device : undefined,
                      };
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
                        setPlacement({
                          kind: item.kind,
                          model: item.model,
                          device: "device" in item ? item.device : undefined,
                        });
                      }
                    }}
                    key={`${item.kind}-${item.model?.libraryId || ("device" in item ? item.device?.packSha256 : "") || "builtin"}-${item.name}`}
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
            {snapshot.project.devicePacks.length
              ? `${snapshot.project.devicePacks.length} ${t("packs embedded")}`
              : snapshot.project.spiceLibraries.length
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
                      ? `放置 ${t(
                          visibleLibrary
                            .flatMap((group) => group.items)
                            .find(
                              (item) =>
                                item.kind === placement.kind &&
                                item.model?.modelName ===
                                  placement.model?.modelName &&
                                ("device" in item
                                  ? item.device?.deviceId ===
                                      placement.device?.deviceId &&
                                    item.device?.unitId ===
                                      placement.device?.unitId
                                  : !placement.device),
                            )?.name || placement.kind,
                        )} · 点击画布，Esc 取消`
                      : "PLACE · Click canvas, Esc to cancel"
                    : sheet.wires.some((wire) => selected.includes(wire.id))
                      ? t("SELECT · Drag wire endpoints or handles to reshape")
                      : t("SELECT · Drag canvas to pan, Shift-drag to select")}
              </span>
            </div>
          </TooltipProvider>
          <SchematicCanvas
            project={snapshot.project}
            selectedIds={selected}
            tool={tool}
            onSelect={setSelected}
            onCommand={handleCanvasCommand}
            onCursor={setCursor}
            onView={updateView}
            placement={placement}
            onPlacementComplete={completePlacement}
            externalDrop={externalDrop}
            onExternalDropComplete={completeExternalDrop}
            focusRequest={focusRequest}
          />
        </section>
        <aside className="inspector panel">
          <div className="panel-heading">
            <span>{t("INSPECTOR")}</span>
            <small>{selectedComponent?.spiceRef || t("NO SELECTION")}</small>
          </div>
          {selectedComponent ? (
            <ComponentInspector
              key={selectedComponent.id}
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
              onSetPinNoConnect={(pinId, noConnect) =>
                void command({
                  action: "setPinNoConnect",
                  componentId: selectedComponent.id,
                  pinId,
                  noConnect,
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
              {[
                "ERC",
                "Check",
                "Configure",
                "Netlist",
                "Console",
                "Waveform",
              ].map((tab) => (
                <TabsTrigger
                  key={tab}
                  className={bottomTab === tab ? "active" : ""}
                  value={tab}
                >
                  {t(tab)}
                  {tab === "Console" &&
                    logs.some((l) => l.includes("ERROR")) && <i />}
                  {tab === "Check" && checkReport && !checkReport.ready && (
                    <i />
                  )}
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
            {bottomTab === "Check" && (
              <SimulationCheckPanel
                report={checkReport}
                checking={checking}
                onCheck={() => void checkSimulation()}
                onLocate={locateCheckIssue}
                formatIssue={(issue) => validationMessage(issue, language)}
              />
            )}{" "}
            {bottomTab === "ERC" && (
              <ErcPanel
                report={ercReport}
                checking={ercChecking}
                onCheck={() => void checkErc()}
                onLocate={locateCheckIssue}
              />
            )}{" "}
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
                profiles={snapshot.project.simulationProfiles}
                probeOptions={probeOptions}
                path={ngspicePath}
                status={status}
                onPath={setNgspicePath}
                onRefresh={async () =>
                  setStatus(
                    isDesktop() ? await api.status(ngspicePath) : status,
                  )
                }
                onUpdate={updateProfile}
                onSelectProfile={selectProfile}
                onAddProfile={addProfile}
                onDeleteProfile={deleteProfile}
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
        {snapshot.dirty && (
          <span className={`autosave-status ${autosaveState}`}>
            <Clock3 aria-hidden="true" />
            {autosaveState === "saving"
              ? t("Autosaving…")
              : autosaveState === "saved"
                ? t("Recovery protected")
                : autosaveState === "error"
                  ? t("Autosave failed")
                  : t("Waiting to autosave")}
          </span>
        )}
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
      <UnsavedChangesDialog
        open={Boolean(pendingTransition)}
        destination={pendingTransition?.destination || ""}
        saving={transitionSaving}
        onSave={() => void saveAndContinue()}
        onDiscard={() => void discardAndContinue()}
        onCancel={() => setPendingTransition(null)}
      />
      <RecoveryDialog
        recovery={recovery}
        busy={recoveryBusy}
        onRestore={() => void restoreAutosave()}
        onDiscard={() => void discardAutosave()}
      />
      <DevicePackManager
        open={packManagerOpen}
        project={snapshot.project}
        onClose={() => setPackManagerOpen(false)}
        onImport={() => void importDevicePack()}
        onPlace={(next) => {
          setTool("select");
          setPlacement(next);
        }}
      />
    </div>
  );
}

function FileMenu({
  recentProjects,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onOpenRecent,
}: {
  recentProjects: RecentProject[];
  onNew: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onSave: () => void | Promise<boolean>;
  onSaveAs: () => void | Promise<boolean>;
  onOpenRecent: (project: RecentProject) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const navigationItems: [string, string, () => void | Promise<void>][] = [
    [t("New"), "⌘N", onNew],
    [t("Open…"), "⌘O", onOpen],
  ];
  const savingItems: [string, string, () => void | Promise<boolean>][] = [
    [t("Save"), "⌘S", onSave],
    [t("Save As…"), "⇧⌘S", onSaveAs],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="menu-trigger"
          data-testid="file-menu"
        >
          {t("File")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="menu-popover file-menu">
        {navigationItems.map(([name, key, action]) => (
          <DropdownMenuItem
            key={name}
            onSelect={() => void action()}
            data-testid={key === "⌘N" ? "file-new" : "file-open"}
          >
            <span>{name}</span>
            <kbd>{key}</kbd>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {savingItems.map(([name, key, action]) => (
          <DropdownMenuItem key={name} onSelect={() => void action()}>
            <span>{name}</span>
            <kbd>{key}</kbd>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="recent-menu-heading">
          <Clock3 aria-hidden="true" /> {t("RECENT PROJECTS")}
        </div>
        {recentProjects.length ? (
          recentProjects.slice(0, 6).map((project) => (
            <DropdownMenuItem
              key={project.path}
              className={`recent-menu-item ${project.exists ? "" : "missing"}`}
              onSelect={() => void onOpenRecent(project)}
              title={project.path}
              data-testid="recent-project"
            >
              <span>
                <strong>{project.name}</strong>
                <small>{project.path.split(/[\\/]/).pop()}</small>
              </span>
              <kbd>{project.exists ? "↗" : t("Remove")}</kbd>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="recent-menu-empty">{t("No recent projects")}</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  onSetPinNoConnect,
}: {
  component: Component;
  onUpdate: (name: string, ref: string, value: string) => void;
  onRotate: () => void;
  onSetPinNoConnect: (pinId: string, noConnect: boolean) => void;
}) {
  const { language } = useI18n();
  const [name, setName] = useState(component.displayName),
    [ref, setRef] = useState(component.spiceRef),
    [value, setValue] = useState(component.parameters.value || "");
  useEffect(() => {
    setName(component.displayName);
    setRef(component.spiceRef);
    setValue(component.parameters.value || "");
  }, [component.displayName, component.parameters.value, component.spiceRef]);
  const valid = !/[;\n\r]/.test(value) && value.length <= 128;
  const changed =
    name !== component.displayName ||
    ref !== component.spiceRef ||
    value !== (component.parameters.value || "");
  const save = () => {
    if (valid && changed) onUpdate(name, ref, value);
  };
  return (
    <form
      className="property-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
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
        <input value={name} onChange={(e) => setName(e.target.value)} />
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
          ) : component.kind !== "device" ? (
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
              />
              {!valid && (
                <small className="field-error">
                  {language === "zh-CN"
                    ? "不能包含控制字符或分号。"
                    : "Control characters and semicolons are not allowed."}
                </small>
              )}
            </label>
          ) : (
            <div className="device-inspector-note">
              {language === "zh-CN"
                ? "此器件仅在声明并绑定 SPICE 模型时参与仿真。"
                : "This device participates in simulation only when an explicit SPICE model is bound."}
            </div>
          )}
        </>
      )}
      <button
        className="property-save"
        type="submit"
        disabled={!valid || !changed}
      >
        <Save aria-hidden="true" />
        <span>{language === "zh-CN" ? "保存参数" : "Save properties"}</span>
        <kbd>{language === "zh-CN" ? "点击保存" : "Click to save"}</kbd>
      </button>
      <div className="geometry-section">
        <div className="coordinate-row" aria-label="Component coordinates">
          <label>
            <span>X</span>
            <input value={component.position.x} readOnly />
          </label>
          <label>
            <span>Y</span>
            <input value={component.position.y} readOnly />
          </label>
        </div>
        <button className="property-action" type="button" onClick={onRotate}>
          <RotateCw aria-hidden="true" />
          <span>{language === "zh-CN" ? "旋转 90°" : "Rotate 90°"}</span>
          <output>{component.rotation}°</output>
        </button>
      </div>
      <section className="pins-section">
        <h3>{language === "zh-CN" ? "引脚" : "PINS"}</h3>
        {component.pins.map((pin) => (
          <div className="pin-row" key={pin.id}>
            <i />
            {pin.number || pin.id}
            <span>
              <b>{pin.name}</b>
              {pin.group && (
                <small>
                  {pin.group}
                  {pin.voltageDomainId ? ` · ${pin.voltageDomainId}` : ""}
                </small>
              )}
            </span>
            {component.kind === "device" && (
              <button
                type="button"
                className={pin.noConnect ? "nc active" : "nc"}
                title={
                  language === "zh-CN"
                    ? "明确标记 No Connect"
                    : "Explicit No Connect"
                }
                onClick={() => onSetPinNoConnect(pin.id, !pin.noConnect)}
              >
                NC
              </button>
            )}
          </div>
        ))}
      </section>
    </form>
  );
}
export default App;
