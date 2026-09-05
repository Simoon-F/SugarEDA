import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Component,
  ComponentPlacement,
  EditorCommand,
  Point,
  Project,
  Wire,
} from "./types";
import { useI18n } from "./i18n";
import {
  analyzeSchematic,
  GRID,
  insertWireBend,
  nearestElectricalPoint,
  moveOrthogonalSegment,
  moveWireEndpoint,
  moveWireWithComponent,
  orthogonalRoute,
  pinPosition,
  removeWireBend,
  SchematicSpatialIndex,
  samePoint,
  snapPoint,
  wireIntersectsRect,
  wireBendFromPoints,
  type WireBend,
  type WireEndpoint,
} from "./schematic-geometry";

type Props = {
  project: Project;
  selectedIds: string[];
  tool: "select" | "wire";
  onSelect: (ids: string[]) => void;
  onCommand: (command: EditorCommand) => void;
  onCursor: (point: Point) => void;
  onView: (zoom: number, pan: Point) => void;
  placement: ComponentPlacement | null;
  onPlacementComplete: () => void;
  externalDrop: {
    id: number;
    placement: ComponentPlacement;
    screen: Point;
  } | null;
  onExternalDropComplete: () => void;
  focusRequest: { componentId: string; nonce: number } | null;
};
export const SchematicCanvas = memo(function SchematicCanvas({
  project,
  selectedIds,
  tool,
  onSelect,
  onCommand,
  onCursor,
  onView,
  placement,
  onPlacementComplete,
  externalDrop,
  onExternalDropComplete,
  focusRequest,
}: Props) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(project.uiViewState);
  const [drag, setDrag] = useState<{
    id: string;
    start: Point;
    origin: Point;
  } | null>(null);
  const [panStart, setPanStart] = useState<{
    screen: Point;
    pan: Point;
  } | null>(null);
  const [wireStart, setWireStart] = useState<Point | null>(null);
  const [wireBend, setWireBend] = useState<WireBend>("horizontal-first");
  const [wireSegmentDrag, setWireSegmentDrag] = useState<{
    id: string;
    index: number;
    startScreen: Point;
    points: Point[];
  } | null>(null);
  const [wireEndpointDrag, setWireEndpointDrag] = useState<{
    id: string;
    endpoint: WireEndpoint;
    startScreen: Point;
    points: Point[];
  } | null>(null);
  const [selectedBend, setSelectedBend] = useState<{
    wireId: string;
    index: number;
  } | null>(null);
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });
  const [box, setBox] = useState<{ start: Point; end: Point } | null>(null);
  const space = useRef(false);
  const pointerFrame = useRef<number | null>(null);
  const pendingPointer = useRef<Point | null>(null);
  const cursorEmitAt = useRef(0);
  const viewCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusNonce = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const selectedWire = useMemo(
    () =>
      project.sheets[0].wires.find((wire) => selectedIds.includes(wire.id)) ??
      null,
    [project, selectedIds],
  );
  const spatialIndex = useMemo(
    () =>
      new SchematicSpatialIndex(
        project.sheets[0].components,
        project.sheets[0].wires,
      ),
    [project.sheets],
  );
  const diagnostics = useMemo(() => analyzeSchematic(project), [project]);
  const reshapeWire = useCallback(
    (wire: Wire, bend: WireBend) => {
      const start = wire.points[0];
      const end = wire.points[wire.points.length - 1];
      if (!start || !end) return;
      const points = orthogonalRoute(start, end, bend);
      if (
        points.length === wire.points.length &&
        points.every((point, index) =>
          sameScreenPoint(point, wire.points[index]),
        )
      )
        return;
      onCommand({ action: "updateWire", id: wire.id, points });
    },
    [onCommand],
  );
  useEffect(() => setView(project.uiViewState), [project.uiViewState]);
  useEffect(() => {
    if (!focusRequest || lastFocusNonce.current === focusRequest.nonce) return;
    const component = project.sheets[0].components.find(
      (item) => item.id === focusRequest.componentId,
    );
    const rect = host.current?.getBoundingClientRect();
    if (!component || !rect) return;
    lastFocusNonce.current = focusRequest.nonce;
    const pan = {
      x: rect.width / 2 - component.position.x * view.zoom,
      y: rect.height / 2 - component.position.y * view.zoom,
    };
    setView((current) => ({ ...current, pan }));
    onView(view.zoom, pan);
  }, [focusRequest, onView, project.sheets, view.zoom]);
  const toWorld = useCallback(
    (p: Point): Point => ({
      x: (p.x - view.pan.x) / view.zoom,
      y: (p.y - view.pan.y) / view.zoom,
    }),
    [view],
  );
  const toScreen = useCallback(
    (p: Point): Point => ({
      x: p.x * view.zoom + view.pan.x,
      y: p.y * view.zoom + view.pan.y,
    }),
    [view],
  );
  const electricalSnap = useCallback(
    (world: Point, ignoredComponentId?: string, ignoredWireId?: string) =>
      nearestElectricalPoint(
        project,
        world,
        16 / view.zoom,
        ignoredComponentId,
        ignoredWireId,
      ) ?? snapPoint(world),
    [project, view.zoom],
  );
  const componentSnap = useCallback(
    (kind: ComponentPlacement["kind"], world: Point, ignoredId?: string) =>
      kind === "netLabel" ? electricalSnap(world, ignoredId) : snapPoint(world),
    [electricalSnap],
  );
  const eventPoint = (event: React.PointerEvent): Point => {
    const r = canvas.current?.getBoundingClientRect();
    return {
      x: event.clientX - (r?.left ?? 0),
      y: event.clientY - (r?.top ?? 0),
    };
  };
  const placeComponent = useCallback(
    (selection: ComponentPlacement, world: Point) => {
      const position = componentSnap(selection.kind, world);
      onCommand(
        selection.model
          ? {
              action: "addModelComponent",
              libraryId: selection.model.libraryId,
              modelName: selection.model.modelName,
              position,
            }
          : { action: "addComponent", kind: selection.kind, position },
      );
    },
    [componentSnap, onCommand],
  );
  useEffect(() => {
    if (!externalDrop) return;
    placeComponent(externalDrop.placement, toWorld(externalDrop.screen));
    onExternalDropComplete();
  }, [externalDrop, onExternalDropComplete, placeComponent, toWorld]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (e.code === "Tab" && tool === "wire" && wireStart) {
        e.preventDefault();
        setWireBend((current) =>
          current === "horizontal-first"
            ? "vertical-first"
            : "horizontal-first",
        );
        return;
      }
      if (
        e.code === "Tab" &&
        tool === "select" &&
        selectedWire &&
        !isEditingText
      ) {
        e.preventDefault();
        const current = wireBendFromPoints(selectedWire.points) ?? wireBend;
        reshapeWire(
          selectedWire,
          current === "horizontal-first"
            ? "vertical-first"
            : "horizontal-first",
        );
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedBend &&
        selectedWire?.id === selectedBend.wireId &&
        !isEditingText
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const points = removeWireBend(selectedWire.points, selectedBend.index);
        if (points !== selectedWire.points)
          onCommand({ action: "updateWire", id: selectedWire.id, points });
        setSelectedBend(null);
        return;
      }
      if (e.code === "Space") space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
    };
  }, [
    onCommand,
    reshapeWire,
    selectedBend,
    selectedWire,
    tool,
    wireBend,
    wireStart,
  ]);
  useEffect(() => {
    if (selectedBend?.wireId !== selectedWire?.id) setSelectedBend(null);
  }, [selectedBend?.wireId, selectedWire?.id]);
  useEffect(() => {
    if (tool !== "wire") setWireStart(null);
  }, [tool]);
  useEffect(
    () => () => {
      if (pointerFrame.current !== null)
        cancelAnimationFrame(pointerFrame.current);
      if (viewCommitTimer.current !== null)
        clearTimeout(viewCommitTimer.current);
    },
    [],
  );

  const highlightedWires = useMemo(() => {
    const sheet = project.sheets[0];
    const keys = new Set<string>();
    const ids = new Set(
      sheet.wires
        .filter((wire) => selectedIds.includes(wire.id))
        .map((wire) => wire.id),
    );
    for (const wire of sheet.wires.filter((wire) => ids.has(wire.id)))
      wire.points.forEach((point) => keys.add(`${point.x},${point.y}`));
    for (const c of sheet.components.filter((c) => selectedIds.includes(c.id)))
      for (const pin of c.pins) {
        const p = pinPosition(c, pin.offset);
        keys.add(`${p.x},${p.y}`);
      }
    let changed = true;
    while (changed) {
      changed = false;
      for (const wire of sheet.wires) {
        if (ids.has(wire.id)) continue;
        if (wire.points.some((p) => keys.has(`${p.x},${p.y}`))) {
          ids.add(wire.id);
          wire.points.forEach((p) => keys.add(`${p.x},${p.y}`));
          changed = true;
        }
      }
    }
    return ids;
  }, [project, selectedIds]);
  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const bufferWidth = Math.round(rect.width * dpr);
    const bufferHeight = Math.round(rect.height * dpr);
    if (el.width !== bufferWidth || el.height !== bufferHeight) {
      el.width = bufferWidth;
      el.height = bufferHeight;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f6f8fa";
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (view.gridVisible) {
      const small = GRID * view.zoom;
      if (small >= 10) {
        ctx.beginPath();
        for (
          let x = ((view.pan.x % small) + small) % small;
          x < rect.width;
          x += small
        )
          if (Math.round((x - view.pan.x) / small) % 5 !== 0) {
            const aligned = Math.round(x) + 0.5;
            ctx.moveTo(aligned, 0);
            ctx.lineTo(aligned, rect.height);
          }
        for (
          let y = ((view.pan.y % small) + small) % small;
          y < rect.height;
          y += small
        )
          if (Math.round((y - view.pan.y) / small) % 5 !== 0) {
            const aligned = Math.round(y) + 0.5;
            ctx.moveTo(0, aligned);
            ctx.lineTo(rect.width, aligned);
          }
        ctx.strokeStyle = "#e7ebef";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const major = small * 5;
      ctx.beginPath();
      for (
        let x = ((view.pan.x % major) + major) % major;
        x < rect.width;
        x += major
      ) {
        const aligned = Math.round(x) + 0.5;
        ctx.moveTo(aligned, 0);
        ctx.lineTo(aligned, rect.height);
      }
      for (
        let y = ((view.pan.y % major) + major) % major;
        y < rect.height;
        y += major
      ) {
        const aligned = Math.round(y) + 0.5;
        ctx.moveTo(0, aligned);
        ctx.lineTo(rect.width, aligned);
      }
      ctx.strokeStyle = "#d6dde5";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.25, 1.5 * view.zoom);
    ctx.lineJoin = "miter";
    const current = toWorld(pointer);
    const viewport = {
      left: -view.pan.x / view.zoom - 100,
      top: -view.pan.y / view.zoom - 100,
      right: (rect.width - view.pan.x) / view.zoom + 100,
      bottom: (rect.height - view.pan.y) / view.zoom + 100,
    };
    const pointVisible = (point: Point, margin = 0) =>
      point.x >= viewport.left - margin &&
      point.x <= viewport.right + margin &&
      point.y >= viewport.top - margin &&
      point.y <= viewport.bottom + margin;
    const visibleItems = spatialIndex.query({
      left: viewport.left - 80,
      top: viewport.top - 80,
      right: viewport.right + 80,
      bottom: viewport.bottom + 80,
    });
    const draggedComponent = drag
      ? project.sheets[0].components.find(
          (component) => component.id === drag.id,
        )
      : undefined;
    const draggedPosition =
      drag && draggedComponent
        ? componentSnap(
            draggedComponent.kind,
            {
              x: drag.origin.x + current.x - drag.start.x,
              y: drag.origin.y + current.y - drag.start.y,
            },
            draggedComponent.id,
          )
        : undefined;
    const draggedPins = draggedComponent
      ? draggedComponent.pins.map((pin) =>
          pinPosition(draggedComponent, pin.offset),
        )
      : [];
    for (const wire of visibleItems.wires) {
      const start = wire.points[0];
      const end = wire.points[wire.points.length - 1];
      const attached =
        draggedComponent &&
        (draggedPins.some((pin) => samePoint(pin, start)) ||
          draggedPins.some((pin) => samePoint(pin, end)));
      const attachedPoints =
        attached && draggedComponent && draggedPosition
          ? moveWireWithComponent(
              wire.points,
              draggedComponent,
              draggedPosition,
            )
          : wire.points;
      const wirePoints =
        wireEndpointDrag?.id === wire.id
          ? moveWireEndpoint(
              wireEndpointDrag.points,
              wireEndpointDrag.endpoint,
              electricalSnap(current, undefined, wire.id),
            )
          : wireSegmentDrag?.id === wire.id
            ? moveOrthogonalSegment(
                wireSegmentDrag.points,
                wireSegmentDrag.index,
                current,
              )
            : attachedPoints;
      if (
        !wireIntersectsRect(
          { id: wire.id, points: wirePoints },
          viewport.left,
          viewport.top,
          viewport.right,
          viewport.bottom,
        )
      )
        continue;
      ctx.beginPath();
      wirePoints.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = diagnostics.brokenWireIds.has(wire.id)
        ? "#c83f49"
        : highlightedWires.has(wire.id)
          ? "#2869df"
          : "#20865a";
      ctx.stroke();
      for (const p of wirePoints) {
        const s = toScreen(p);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    }
    for (const point of diagnostics.junctions) {
      if (!pointVisible(point)) continue;
      const screen = toScreen(point);
      ctx.beginPath();
      ctx.fillStyle = "#176f4a";
      ctx.arc(
        screen.x,
        screen.y,
        Math.max(3.5, 4.25 * view.zoom),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    for (const wire of visibleItems.wires) {
      [wire.points[0], wire.points[wire.points.length - 1]].forEach(
        (point, index) => {
          if (!diagnostics.brokenWireEndpoints.has(`${wire.id}:${index}`))
            return;
          if (!pointVisible(point)) return;
          const screen = toScreen(point);
          ctx.beginPath();
          ctx.fillStyle = "#fff7f7";
          ctx.strokeStyle = "#c83f49";
          ctx.lineWidth = 2;
          ctx.arc(screen.x, screen.y, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        },
      );
    }
    for (const label of project.sheets[0].netLabels) {
      if (!pointVisible(label.position, 60)) continue;
      const s = toScreen(label.position);
      ctx.fillStyle = diagnostics.disconnectedLabelIds.has(label.id)
        ? "#c83f49"
        : "#2869df";
      ctx.font = `600 ${12 * Math.max(0.85, view.zoom)}px SFMono-Regular, monospace`;
      ctx.fillText(label.name, s.x + 6, s.y - 6);
    }
    for (const component of visibleItems.components) {
      const dragPoint = drag?.id === component.id ? draggedPosition : undefined;
      const displayedPosition = dragPoint ?? component.position;
      if (!pointVisible(displayedPosition, 80)) continue;
      const disconnectedLabel =
        component.kind === "netLabel" &&
        (drag?.id === component.id
          ? nearestElectricalPoint(
              project,
              displayedPosition,
              0.001,
              component.id,
            ) === null
          : diagnostics.disconnectedLabelIds.has(component.id));
      drawComponent(
        ctx,
        component,
        toScreen,
        view.zoom,
        selectedIds.includes(component.id),
        dragPoint,
        disconnectedLabel,
        diagnostics.floatingPinIds,
      );
    }
    if (tool === "select" && selectedWire) {
      const points =
        wireEndpointDrag?.id === selectedWire.id
          ? moveWireEndpoint(
              wireEndpointDrag.points,
              wireEndpointDrag.endpoint,
              electricalSnap(current, undefined, selectedWire.id),
            )
          : wireSegmentDrag?.id === selectedWire.id
            ? moveOrthogonalSegment(
                wireSegmentDrag.points,
                wireSegmentDrag.index,
                current,
              )
            : selectedWire.points;
      ctx.lineWidth = 1.5;
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = toScreen(points[index]);
        const b = toScreen(points[index + 1]);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#df6718";
        ctx.fillRect(center.x - 5, center.y - 5, 10, 10);
        ctx.strokeRect(center.x - 5, center.y - 5, 10, 10);
        ctx.beginPath();
        if (Math.abs(a.y - b.y) < 0.001) {
          ctx.moveTo(center.x - 2.5, center.y);
          ctx.lineTo(center.x + 2.5, center.y);
        } else {
          ctx.moveTo(center.x, center.y - 2.5);
          ctx.lineTo(center.x, center.y + 2.5);
        }
        ctx.stroke();
      }
      for (const endpoint of [points[0], points[points.length - 1]]) {
        const p = toScreen(endpoint);
        ctx.beginPath();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#df6718";
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = "#df6718";
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = toScreen(points[index]);
        const active =
          selectedBend?.wireId === selectedWire.id &&
          selectedBend.index === index;
        ctx.beginPath();
        ctx.fillStyle = active ? "#df6718" : "#ffffff";
        ctx.strokeStyle = "#df6718";
        ctx.rect(point.x - 4.5, point.y - 4.5, 9, 9);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (wireStart) {
      const end = electricalSnap(current);
      const route = orthogonalRoute(wireStart, end, wireBend).map(toScreen);
      ctx.strokeStyle = "#2869df";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      route.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const endpoint = route[route.length - 1];
      if (endpoint) {
        ctx.fillStyle = "#2869df";
        ctx.beginPath();
        ctx.arc(endpoint.x, endpoint.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (box) {
      ctx.fillStyle = "#2869df20";
      ctx.strokeStyle = "#2869df";
      ctx.fillRect(
        box.start.x,
        box.start.y,
        box.end.x - box.start.x,
        box.end.y - box.start.y,
      );
      ctx.strokeRect(
        box.start.x,
        box.start.y,
        box.end.x - box.start.x,
        box.end.y - box.start.y,
      );
    }
  }, [
    view,
    project,
    selectedIds,
    wireStart,
    pointer,
    box,
    toScreen,
    toWorld,
    highlightedWires,
    drag,
    componentSnap,
    electricalSnap,
    wireBend,
    diagnostics,
    selectedWire,
    selectedBend,
    tool,
    wireSegmentDrag,
    wireEndpointDrag,
    spatialIndex,
  ]);
  drawRef.current = draw;
  useEffect(draw, [draw]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        drawRef.current();
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, []);

  const hitCandidates = (screen: Point) => {
    const world = toWorld(screen);
    const radius = 90 / view.zoom;
    return spatialIndex.query({
      left: world.x - radius,
      top: world.y - radius,
      right: world.x + radius,
      bottom: world.y + radius,
    });
  };
  const hitComponent = (screen: Point) =>
    hitCandidates(screen)
      .components.reverse()
      .find((c) => {
        const p = toScreen(c.position);
        const angle = (-c.rotation * Math.PI) / 180;
        const dx = (screen.x - p.x) / view.zoom,
          dy = (screen.y - p.y) / view.zoom;
        const x = dx * Math.cos(angle) - dy * Math.sin(angle);
        const y = dx * Math.sin(angle) + dy * Math.cos(angle);
        const halfHeight =
          c.kind === "subcircuit"
            ? Math.max(38, ...c.pins.map((pin) => Math.abs(pin.offset.y) + 10))
            : 38;
        return Math.abs(x) < 52 && Math.abs(y) < halfHeight;
      });
  const hitWire = (screen: Point) =>
    hitCandidates(screen)
      .wires.reverse()
      .find((wire) =>
        wire.points.slice(1).some((point, index) => {
          const a = toScreen(wire.points[index]),
            b = toScreen(point),
            dx = b.x - a.x,
            dy = b.y - a.y,
            lengthSquared = dx * dx + dy * dy,
            t = lengthSquared
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((screen.x - a.x) * dx + (screen.y - a.y) * dy) /
                      lengthSquared,
                  ),
                )
              : 0,
            closest = { x: a.x + t * dx, y: a.y + t * dy };
          return Math.hypot(screen.x - closest.x, screen.y - closest.y) < 7;
        }),
      );
  const hitWireHandle = (screen: Point, wire: Wire) => {
    for (let index = wire.points.length - 2; index >= 0; index -= 1) {
      const a = toScreen(wire.points[index]);
      const b = toScreen(wire.points[index + 1]);
      if (
        Math.hypot(screen.x - (a.x + b.x) / 2, screen.y - (a.y + b.y) / 2) <= 9
      )
        return index;
    }
    return -1;
  };
  const hitWireBend = (screen: Point, wire: Wire) => {
    for (let index = wire.points.length - 2; index >= 1; index -= 1) {
      const point = toScreen(wire.points[index]);
      if (Math.hypot(screen.x - point.x, screen.y - point.y) <= 9) return index;
    }
    return -1;
  };
  const hitWireSegment = (screen: Point, wire: Wire) => {
    for (let index = wire.points.length - 2; index >= 0; index -= 1) {
      const a = toScreen(wire.points[index]);
      const b = toScreen(wire.points[index + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared
        ? Math.max(
            0,
            Math.min(
              1,
              ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / lengthSquared,
            ),
          )
        : 0;
      if (
        Math.hypot(
          screen.x - (a.x + ratio * dx),
          screen.y - (a.y + ratio * dy),
        ) < 7
      )
        return index;
    }
    return -1;
  };
  const hitWireEndpoint = (screen: Point, wire: Wire): WireEndpoint | null => {
    const start = toScreen(wire.points[0]);
    const end = toScreen(wire.points[wire.points.length - 1]);
    if (Math.hypot(screen.x - start.x, screen.y - start.y) <= 10)
      return "start";
    if (Math.hypot(screen.x - end.x, screen.y - end.y) <= 10) return "end";
    return null;
  };
  const pointerDown = (e: React.PointerEvent) => {
    const screen = eventPoint(e),
      world = toWorld(screen);
    if (e.button === 2) {
      setWireStart(null);
      return;
    }
    if (placement && e.button === 0) {
      placeComponent(placement, world);
      onPlacementComplete();
      return;
    }
    canvas.current?.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current) {
      setPanStart({ screen, pan: view.pan });
      return;
    }
    if (tool === "wire") {
      const p = electricalSnap(world);
      if (!wireStart) setWireStart(p);
      else {
        const points = orthogonalRoute(wireStart, p, wireBend);
        if (!points.length) {
          setWireStart(null);
          return;
        }
        onCommand({
          action: "addWire",
          points,
        });
        setWireStart(null);
      }
      return;
    }
    if (selectedWire) {
      const bendIndex = hitWireBend(screen, selectedWire);
      if (bendIndex >= 1) {
        setSelectedBend({ wireId: selectedWire.id, index: bendIndex });
        return;
      }
      const endpoint = hitWireEndpoint(screen, selectedWire);
      if (endpoint) {
        setSelectedBend(null);
        setWireEndpointDrag({
          id: selectedWire.id,
          endpoint,
          startScreen: screen,
          points: selectedWire.points,
        });
        return;
      }
      const segmentIndex = hitWireHandle(screen, selectedWire);
      if (segmentIndex >= 0) {
        setSelectedBend(null);
        setWireSegmentDrag({
          id: selectedWire.id,
          index: segmentIndex,
          startScreen: screen,
          points: selectedWire.points,
        });
        return;
      }
    }
    const hit = hitComponent(screen);
    if (hit) {
      setSelectedBend(null);
      onSelect(e.shiftKey ? [...new Set([...selectedIds, hit.id])] : [hit.id]);
      setDrag({ id: hit.id, start: world, origin: hit.position });
    } else {
      const wire = hitWire(screen);
      if (wire) {
        setSelectedBend(null);
        onSelect(
          e.shiftKey ? [...new Set([...selectedIds, wire.id])] : [wire.id],
        );
      } else {
        setSelectedBend(null);
        if (e.shiftKey) setBox({ start: screen, end: screen });
        else {
          onSelect([]);
          setPanStart({ screen, pan: view.pan });
        }
      }
    }
  };
  const pointerMove = (e: React.PointerEvent) => {
    const screen = eventPoint(e);
    pendingPointer.current = screen;
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const nextScreen = pendingPointer.current;
      pendingPointer.current = null;
      if (!nextScreen) return;
      setPointer(nextScreen);
      const now = performance.now();
      if (now - cursorEmitAt.current >= 50) {
        cursorEmitAt.current = now;
        onCursor(toWorld(nextScreen));
      }
      if (panStart) {
        const nextPan = {
          x: panStart.pan.x + nextScreen.x - panStart.screen.x,
          y: panStart.pan.y + nextScreen.y - panStart.screen.y,
        };
        setView((currentView) => ({ ...currentView, pan: nextPan }));
        return;
      }
      if (box)
        setBox((currentBox) =>
          currentBox ? { ...currentBox, end: nextScreen } : null,
        );
    });
  };
  const pointerUp = (e: React.PointerEvent) => {
    const screen = eventPoint(e),
      world = toWorld(screen);
    if (pointerFrame.current !== null) {
      cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = null;
    }
    pendingPointer.current = null;
    setPointer(screen);
    onCursor(world);
    if (wireEndpointDrag) {
      if (
        Math.hypot(
          screen.x - wireEndpointDrag.startScreen.x,
          screen.y - wireEndpointDrag.startScreen.y,
        ) > 3
      ) {
        const wire = project.sheets[0].wires.find(
          (item) => item.id === wireEndpointDrag.id,
        );
        const points = moveWireEndpoint(
          wireEndpointDrag.points,
          wireEndpointDrag.endpoint,
          electricalSnap(world, undefined, wireEndpointDrag.id),
        );
        if (
          wire &&
          (points.length !== wire.points.length ||
            points.some(
              (point, index) => !sameScreenPoint(point, wire.points[index]),
            ))
        )
          onCommand({ action: "updateWire", id: wireEndpointDrag.id, points });
      }
      setWireEndpointDrag(null);
    }
    if (wireSegmentDrag) {
      if (
        Math.hypot(
          screen.x - wireSegmentDrag.startScreen.x,
          screen.y - wireSegmentDrag.startScreen.y,
        ) > 3
      ) {
        const points = moveOrthogonalSegment(
          wireSegmentDrag.points,
          wireSegmentDrag.index,
          world,
        );
        if (
          points.length !== wireSegmentDrag.points.length ||
          points.some(
            (point, index) =>
              !sameScreenPoint(point, wireSegmentDrag.points[index]),
          )
        )
          onCommand({
            action: "updateWire",
            id: wireSegmentDrag.id,
            points,
          });
      }
      setWireSegmentDrag(null);
    }
    if (drag) {
      const dx = world.x - drag.start.x,
        dy = world.y - drag.start.y;
      if (Math.hypot(dx, dy) > 2 / view.zoom) {
        const component = project.sheets[0].components.find(
          (item) => item.id === drag.id,
        );
        const rawPosition = {
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        };
        onCommand({
          action: "moveComponent",
          id: drag.id,
          position: component
            ? componentSnap(component.kind, rawPosition, component.id)
            : snapPoint(rawPosition),
        });
      }
      setDrag(null);
    }
    if (panStart) {
      const distance = Math.hypot(
        screen.x - panStart.screen.x,
        screen.y - panStart.screen.y,
      );
      const finalPan = {
        x: panStart.pan.x + screen.x - panStart.screen.x,
        y: panStart.pan.y + screen.y - panStart.screen.y,
      };
      if (distance > 2) {
        setView((currentView) => ({ ...currentView, pan: finalPan }));
        onView(view.zoom, finalPan);
      } else setView((currentView) => ({ ...currentView, pan: panStart.pan }));
      setPanStart(null);
    }
    if (box) {
      const x1 = Math.min(box.start.x, screen.x),
        x2 = Math.max(box.start.x, screen.x),
        y1 = Math.min(box.start.y, screen.y),
        y2 = Math.max(box.start.y, screen.y);
      if (x2 - x1 > 4 || y2 - y1 > 4) {
        const worldTopLeft = toWorld({ x: x1, y: y1 });
        const worldBottomRight = toWorld({ x: x2, y: y2 });
        onSelect([
          ...new Set([
            ...selectedIds,
            ...project.sheets[0].components
              .filter((c) => {
                const p = toScreen(c.position);
                return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
              })
              .map((c) => c.id),
            ...project.sheets[0].wires
              .filter((wire) =>
                wireIntersectsRect(
                  wire,
                  worldTopLeft.x,
                  worldTopLeft.y,
                  worldBottomRight.x,
                  worldBottomRight.y,
                ),
              )
              .map((wire) => wire.id),
          ]),
        ]);
      }
      setBox(null);
    }
    if (canvas.current?.hasPointerCapture(e.pointerId))
      canvas.current.releasePointerCapture(e.pointerId);
  };
  const pointerCancel = (e: React.PointerEvent) => {
    if (pointerFrame.current !== null) {
      cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = null;
    }
    pendingPointer.current = null;
    setDrag(null);
    setWireSegmentDrag(null);
    setWireEndpointDrag(null);
    setPanStart(null);
    setBox(null);
    if (canvas.current?.hasPointerCapture(e.pointerId))
      canvas.current.releasePointerCapture(e.pointerId);
  };
  const wheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    const before = toWorld(p);
    const zoom = Math.min(
      4,
      Math.max(0.2, view.zoom * Math.exp(-e.deltaY * 0.001)),
    );
    const pan = { x: p.x - before.x * zoom, y: p.y - before.y * zoom };
    setView((v) => ({ ...v, zoom, pan }));
    if (viewCommitTimer.current !== null) clearTimeout(viewCommitTimer.current);
    viewCommitTimer.current = setTimeout(() => {
      viewCommitTimer.current = null;
      onView(zoom, pan);
    }, 120);
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    const fallback = e.dataTransfer.getData("text/plain");
    let modelData = e.dataTransfer.getData("application/sugareda-model");
    let kind = e.dataTransfer.getData(
      "application/sugareda-component",
    ) as import("./types").ComponentKind;
    if (!kind && !modelData && fallback.startsWith("sugareda:")) {
      try {
        const payload = JSON.parse(fallback.slice(9)) as ComponentPlacement;
        kind = payload.kind;
        if (payload.model) modelData = JSON.stringify(payload.model);
      } catch {
        return;
      }
    }
    if (kind || modelData) {
      const r = canvas.current?.getBoundingClientRect();
      const p = toWorld({
        x: e.clientX - (r?.left ?? 0),
        y: e.clientY - (r?.top ?? 0),
      });
      const position = componentSnap(kind, p);
      if (modelData) {
        try {
          const model = JSON.parse(modelData) as {
            libraryId: string;
            modelName: string;
          };
          if (
            typeof model.libraryId === "string" &&
            typeof model.modelName === "string"
          )
            onCommand({
              action: "addModelComponent",
              libraryId: model.libraryId,
              modelName: model.modelName,
              position,
            });
        } catch {
          /* Ignore drops from unrelated applications. */
        }
      } else onCommand({ action: "addComponent", kind, position });
    }
  };
  const doubleClick = (e: React.MouseEvent) => {
    if (tool !== "select" || placement) return;
    const rect = canvas.current?.getBoundingClientRect();
    const screen = {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
    const wire = hitWire(screen);
    if (!wire) return;
    const insertion = insertWireBend(
      wire.points,
      hitWireSegment(screen, wire),
      toWorld(screen),
    );
    if (!insertion) return;
    e.preventDefault();
    onSelect([wire.id]);
    setSelectedBend({ wireId: wire.id, index: insertion.index });
    onCommand({ action: "updateWire", id: wire.id, points: insertion.points });
  };
  return (
    <div
      ref={host}
      className={`canvas-host tool-${placement ? "place" : tool}${panStart ? " is-panning" : ""}`}
      onDrop={drop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
    >
      <canvas
        data-testid="schematic-canvas"
        ref={canvas}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onDoubleClick={doubleClick}
        onWheel={wheel}
        onContextMenu={(e) => {
          e.preventDefault();
          setWireStart(null);
        }}
      />
      {tool === "wire" && (
        <div className="wire-route-controls" aria-label={t("Wire bend")}>
          <span>{t("Wire bend")}</span>
          <button
            className={wireBend === "horizontal-first" ? "active" : ""}
            onClick={() => setWireBend("horizontal-first")}
            title={t("Horizontal then vertical")}
          >
            H → V
          </button>
          <button
            className={wireBend === "vertical-first" ? "active" : ""}
            onClick={() => setWireBend("vertical-first")}
            title={t("Vertical then horizontal")}
          >
            V → H
          </button>
          <kbd>Tab</kbd>
        </div>
      )}
      {tool === "select" && selectedWire && (
        <div
          className="wire-route-controls wire-edit-controls"
          aria-label={t("Edit selected wire")}
        >
          <span>{t("Selected wire")}</span>
          <button
            className={
              wireBendFromPoints(selectedWire.points) === "horizontal-first"
                ? "active"
                : ""
            }
            onClick={() => reshapeWire(selectedWire, "horizontal-first")}
            title={t("Horizontal then vertical")}
          >
            H → V
          </button>
          <button
            className={
              wireBendFromPoints(selectedWire.points) === "vertical-first"
                ? "active"
                : ""
            }
            onClick={() => reshapeWire(selectedWire, "vertical-first")}
            title={t("Vertical then horizontal")}
          >
            V → H
          </button>
          <span className="wire-edit-hint">
            {t("Double-click to add a bend; select a bend and press Delete")}
          </span>
        </div>
      )}
      <div className="sheet-chip">
        <span>01</span> {t("Main schematic")}
      </div>
    </div>
  );
});

function sameScreenPoint(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function drawComponent(
  ctx: CanvasRenderingContext2D,
  c: Component,
  toScreen: (p: Point) => Point,
  zoom: number,
  selected: boolean,
  dragPoint?: Point,
  invalid = false,
  floatingPinIds = new Set<string>(),
) {
  const center = toScreen(dragPoint ?? c.position);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(zoom, zoom);
  ctx.strokeStyle = invalid ? "#c83f49" : selected ? "#2869df" : "#48515d";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = selected ? 2.4 : 1.6;
  ctx.shadowColor = selected ? "#2869df55" : "transparent";
  ctx.shadowBlur = selected ? 10 : 0;
  ctx.beginPath();
  if (c.kind === "resistor") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-25, 0);
    [-20, -10, 0, 10, 20].forEach((x, i) =>
      ctx.lineTo(x, i % 2 === 0 ? -8 : 8),
    );
    ctx.lineTo(25, 0);
    ctx.lineTo(40, 0);
  } else if (c.kind === "capacitor") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-7, 0);
    ctx.moveTo(-7, -15);
    ctx.lineTo(-7, 15);
    ctx.moveTo(7, -15);
    ctx.lineTo(7, 15);
    ctx.moveTo(7, 0);
    ctx.lineTo(40, 0);
  } else if (c.kind === "inductor") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-24, 0);
    for (let x = -18; x <= 18; x += 12) ctx.arc(x, 0, 6, Math.PI, 0);
    ctx.lineTo(40, 0);
  } else if (c.kind === "diode") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-16, 0);
    ctx.moveTo(-16, -14);
    ctx.lineTo(12, 0);
    ctx.lineTo(-16, 14);
    ctx.closePath();
    ctx.moveTo(12, -15);
    ctx.lineTo(12, 15);
    ctx.moveTo(12, 0);
    ctx.lineTo(40, 0);
  } else if (c.kind === "bipolarTransistor") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-10, 0);
    ctx.moveTo(-10, -18);
    ctx.lineTo(-10, 18);
    ctx.moveTo(-10, -10);
    ctx.lineTo(20, -30);
    ctx.moveTo(-10, 10);
    ctx.lineTo(20, 30);
  } else if (c.kind === "mosfet") {
    ctx.moveTo(-40, 0);
    ctx.lineTo(-14, 0);
    ctx.moveTo(-14, -18);
    ctx.lineTo(-14, 18);
    ctx.moveTo(-4, -18);
    ctx.lineTo(-4, 18);
    ctx.moveTo(-4, -11);
    ctx.lineTo(20, -30);
    ctx.moveTo(-4, 11);
    ctx.lineTo(20, 30);
  } else if (c.kind === "subcircuit") {
    const ys = c.pins.map((pin) => pin.offset.y);
    const top = Math.min(-24, ...ys) - 10;
    const bottom = Math.max(24, ...ys) + 10;
    ctx.rect(-32, top, 64, bottom - top);
    for (const pin of c.pins) {
      ctx.moveTo(pin.offset.x, pin.offset.y);
      ctx.lineTo(pin.offset.x < 0 ? -32 : 32, pin.offset.y);
    }
  } else if (c.kind === "voltageSource" || c.kind === "currentSource") {
    ctx.moveTo(0, -30);
    ctx.lineTo(0, -20);
    ctx.moveTo(0, 20);
    ctx.lineTo(0, 30);
    ctx.moveTo(20, 0);
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    if (c.kind === "voltageSource") {
      ctx.moveTo(-6, -7);
      ctx.lineTo(6, -7);
      ctx.moveTo(0, -13);
      ctx.lineTo(0, -1);
      ctx.moveTo(-6, 8);
      ctx.lineTo(6, 8);
    } else {
      ctx.moveTo(0, 11);
      ctx.lineTo(0, -10);
      ctx.moveTo(-5, -4);
      ctx.lineTo(0, -10);
      ctx.lineTo(5, -4);
    }
  } else if (c.kind === "ground") {
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 0);
    ctx.moveTo(-16, 0);
    ctx.lineTo(16, 0);
    ctx.moveTo(-11, 6);
    ctx.lineTo(11, 6);
    ctx.moveTo(-5, 12);
    ctx.lineTo(5, 12);
  } else if (c.kind === "netLabel") {
    ctx.moveTo(0, 0);
    ctx.lineTo(8, 0);
    ctx.lineTo(14, -8);
    ctx.lineTo(48, -8);
    ctx.lineTo(48, 8);
    ctx.lineTo(14, 8);
    ctx.closePath();
  }
  ctx.stroke();
  if (c.model) {
    ctx.font = "11px SFMono-Regular, monospace";
    ctx.fillStyle = "#6b7280";
    for (const pin of c.pins) {
      ctx.textAlign = pin.offset.x < 0 ? "left" : "right";
      ctx.fillText(
        pin.name,
        pin.offset.x + (pin.offset.x < 0 ? 7 : -7),
        pin.offset.y - 5,
      );
    }
    ctx.textAlign = "left";
  }
  for (const pin of c.pins) {
    const floating = floatingPinIds.has(`${c.id}:${pin.id}`);
    ctx.beginPath();
    ctx.fillStyle =
      invalid || floating ? "#c83f49" : selected ? "#2869df" : "#20865a";
    ctx.arc(pin.offset.x, pin.offset.y, floating ? 4.2 : 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (floating) {
      ctx.beginPath();
      ctx.strokeStyle = "#c83f49";
      ctx.lineWidth = 1.3;
      ctx.arc(pin.offset.x, pin.offset.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.fillStyle = invalid ? "#c83f49" : selected ? "#1f57bd" : "#20242b";
  ctx.font = "600 13px SFMono-Regular, monospace";
  ctx.fillText(
    c.kind === "netLabel" ? c.parameters.value : c.spiceRef,
    center.x + 10,
    center.y - 22,
  );
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px SFMono-Regular, monospace";
  if (c.kind !== "netLabel")
    ctx.fillText(
      c.model?.modelName || c.parameters.value || "",
      center.x + 10,
      center.y + 30,
    );
}
