import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationResult } from "./types";
import {
  frequencyFromCursorDelta,
  minMaxSampleIndices,
  nearestSample,
  seriesExtrema,
  waveformCsv,
} from "./waveform-data";
import { api, isDesktop } from "./bridge";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "./i18n";
const colors = ["#2869df", "#20865a", "#8250df", "#c83f49"];
const engineering = (value: number, unit: string) => {
  if (!Number.isFinite(value)) return "—";
  if (unit.startsWith("dB") || unit === "°")
    return value.toFixed(2) + " " + unit;
  if (value === 0) return "0 " + unit;
  const steps: [number, string][] = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const [scale, prefix] = steps.find(([scale]) => Math.abs(value) >= scale) || [
    1e-12,
    "p",
  ];
  return (value / scale).toFixed(3) + " " + prefix + unit;
};
export function Waveform({
  result,
  running,
  error,
}: {
  result: SimulationResult | null;
  running: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const envelopeCache = useRef(new WeakMap<number[], Map<string, number[]>>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [cursors, setCursors] = useState<[number | null, number | null]>([
    null,
    null,
  ]);
  const [activeCursor, setActiveCursor] = useState<0 | 1>(0);
  const [mode, setMode] = useState<"magnitude" | "db" | "phase">("magnitude");
  const [unit, setUnit] = useState("V");
  const [exportError, setExportError] = useState("");
  const drag = useRef<
    | { kind: "pan"; x: number; range: [number, number]; moved: boolean }
    | { kind: "cursor"; index: 0 | 1 }
    | null
  >(null);
  const ac = result?.analysisType === "acSweep";
  const op = result?.analysisType === "operatingPoint";
  useEffect(() => {
    setRange([0, 1]);
    setCursors([null, null]);
    setActiveCursor(0);
    setHidden(new Set());
    setUnit(result?.signals[0]?.unit || "V");
    setExportError("");
  }, [result]);
  const signals = useMemo(
    () =>
      (result?.signals || []).map((signal) => ({
        ...signal,
        displayUnit:
          ac && mode === "phase"
            ? "°"
            : ac && mode === "db"
              ? "dB" + signal.unit
              : signal.unit,
        values:
          ac && mode === "phase"
            ? signal.phase || []
            : ac && mode === "db"
              ? signal.samples.map(
                  (value) => 20 * Math.log10(Math.max(value, 1e-30)),
                )
              : signal.samples,
      })),
    [result, ac, mode],
  );
  const samples = result?.xAxis.samples || [];
  const transform = (value: number) =>
    ac ? Math.log10(Math.max(value, 1e-30)) : value;
  const first = Math.floor(range[0] * Math.max(0, samples.length - 1));
  const last = Math.min(
    samples.length - 1,
    Math.max(first + 1, Math.ceil(range[1] * (samples.length - 1))),
  );
  const x0 = transform(samples[first] ?? 0),
    x1 = transform(samples[last] ?? 1);
  const xFromPosition = (position: number) =>
    ac ? 10 ** (x0 + position * (x1 - x0)) : x0 + position * (x1 - x0);
  const positionFromX = (x: number) => (transform(x) - x0) / (x1 - x0 || 1);
  const cursorIndices = cursors.map((x) =>
    x === null ? null : nearestSample(samples, x),
  );
  const activeSignals = useMemo(
    () =>
      signals.filter(
        (signal) => signal.unit === unit && !hidden.has(signal.name),
      ),
    [hidden, signals, unit],
  );
  const statistics = useMemo(
    () =>
      activeSignals.map((signal) => ({
        signal,
        extrema: seriesExtrema(signal.values, first, last),
      })),
    [activeSignals, first, last],
  );
  const cursorDelta =
    cursorIndices[0] !== null && cursorIndices[1] !== null
      ? samples[cursorIndices[1]] - samples[cursorIndices[0]]
      : null;
  const measuredFrequency =
    cursorDelta === null
      ? null
      : frequencyFromCursorDelta(cursorDelta, result?.xAxis.unit || "");
  const draw = () => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect(),
      dpr = devicePixelRatio || 1;
    const bufferWidth = Math.round(rect.width * dpr);
    const bufferHeight = Math.round(rect.height * dpr);
    if (el.width !== bufferWidth || el.height !== bufferHeight) {
      el.width = bufferWidth;
      el.height = bufferHeight;
    }
    const c = el.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, rect.width, rect.height);
    const left = 64,
      top = 18,
      w = Math.max(1, rect.width - left - 18),
      h = Math.max(1, rect.height - top - 30);
    c.strokeStyle = "#e3e7eb";
    c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      c.beginPath();
      c.moveTo(left + (w * i) / 8, top);
      c.lineTo(left + (w * i) / 8, top + h);
      c.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      c.beginPath();
      c.moveTo(left, top + (h * i) / 4);
      c.lineTo(left + w, top + (h * i) / 4);
      c.stroke();
    }
    if (!result || !samples.length) return;
    const active = activeSignals;
    let ymin = Infinity,
      ymax = -Infinity;
    for (const { extrema } of statistics)
      if (extrema) {
        ymin = Math.min(ymin, extrema.minimum);
        ymax = Math.max(ymax, extrema.maximum);
      }
    if (!Number.isFinite(ymin)) {
      ymin = 0;
      ymax = 1;
    }
    if (ymin === ymax) {
      ymin -= 1;
      ymax += 1;
    }
    const padding = (ymax - ymin) * 0.05;
    ymin -= padding;
    ymax += padding;
    c.save();
    c.beginPath();
    c.rect(left, top, w, h);
    c.clip();
    for (const signal of active) {
      c.strokeStyle = colors[signals.indexOf(signal) % colors.length];
      c.lineWidth = 1.7;
      c.beginPath();
      const maxPoints = Math.max(200, Math.floor(w * 2));
      const cacheKey = `${first}:${last}:${maxPoints}`;
      let signalCache = envelopeCache.current.get(signal.values);
      if (!signalCache) {
        signalCache = new Map();
        envelopeCache.current.set(signal.values, signalCache);
      }
      let indices = signalCache.get(cacheKey);
      if (!indices) {
        indices = minMaxSampleIndices(signal.values, first, last, maxPoints);
        if (signalCache.size >= 12) signalCache.clear();
        signalCache.set(cacheKey, indices);
      }
      indices.forEach((i, pathIndex) => {
        const x = left + ((transform(samples[i]) - x0) / (x1 - x0 || 1)) * w;
        const y = top + h - ((signal.values[i] - ymin) / (ymax - ymin)) * h;
        if (pathIndex === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.stroke();
    }
    c.restore();
    c.fillStyle = "#6b7280";
    c.font = "11px SFMono-Regular, monospace";
    for (let i = 0; i <= 4; i++) {
      c.fillText(
        engineering(
          ymax - ((ymax - ymin) * i) / 4,
          active[0]?.displayUnit || unit,
        ),
        4,
        top + (h * i) / 4 + 3,
      );
      const coordinate = x0 + ((x1 - x0) * i) / 4;
      c.fillText(
        engineering(ac ? 10 ** coordinate : coordinate, result.xAxis.unit),
        left + (w * i) / 4 - 20,
        rect.height - 8,
      );
    }
    cursors.forEach((cursor, index) => {
      if (cursor === null) return;
      const position = positionFromX(cursor);
      if (position < 0 || position > 1) return;
      c.strokeStyle = index === 0 ? "#2869df" : "#df6718";
      c.fillStyle = c.strokeStyle;
      c.setLineDash(index === 0 ? [4, 3] : [2, 3]);
      c.beginPath();
      c.moveTo(left + position * w, top);
      c.lineTo(left + position * w, top + h);
      c.stroke();
      c.setLineDash([]);
      c.fillRect(left + position * w - 8, top, 16, 15);
      c.fillStyle = "#ffffff";
      c.font = "700 10px SFMono-Regular, monospace";
      c.fillText(index === 0 ? "A" : "B", left + position * w - 3, top + 11);
    });
  };
  drawRef.current = draw;
  useEffect(draw);
  useEffect(() => {
    const observer = new ResizeObserver(() => drawRef.current());
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const boundRange = (start: number, span: number) => {
    const a = Math.max(0, Math.min(1 - span, start));
    setRange([a, a + span]);
  };
  const exportCsv = async () => {
    if (!result) return;
    try {
      if (isDesktop()) {
        const path = await save({
          defaultPath: "waveform.csv",
          filters: [{ name: "Waveform CSV", extensions: ["csv"] }],
        });
        if (path)
          await api.exportWaveform(
            path.toLowerCase().endsWith(".csv") ? path : path + ".csv",
            waveformCsv(result),
          );
      } else {
        const url = URL.createObjectURL(
          new Blob([waveformCsv(result)], { type: "text/csv" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "waveform.csv";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setExportError(String(error));
    }
  };
  return (
    <div className="wave-shell">
      <div className="wave-legend">
        {result && (
          <div className="wave-success" role="status">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{t("Simulation computation succeeded")}</strong>
              <small>
                {result.xAxis.samples.length} {t("samples")} ·{" "}
                {result.executionTimeMs} ms
              </small>
            </div>
          </div>
        )}
        {ac && (
          <div className="wave-mode" aria-label="AC display">
            {(["magnitude", "db", "phase"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "magnitude"
                  ? t("Magnitude")
                  : value === "db"
                    ? "dB"
                    : t("Phase")}
              </button>
            ))}
          </div>
        )}
        {result && !op && (
          <div className="wave-mode">
            {[...new Set(result.signals.map((signal) => signal.unit))].map(
              (value) => (
                <button
                  key={value}
                  aria-pressed={unit === value}
                  onClick={() => setUnit(value)}
                >
                  {value || t("Value")}
                </button>
              ),
            )}
          </div>
        )}
        {signals.map((signal, index) => (
          <button
            key={signal.name}
            className={hidden.has(signal.name) ? "muted" : ""}
            onClick={() =>
              setHidden((old) => {
                const next = new Set(old);
                if (next.has(signal.name)) next.delete(signal.name);
                else next.add(signal.name);
                return next;
              })
            }
          >
            <i style={{ background: colors[index % colors.length] }} />
            {signal.name}
          </button>
        ))}
        {result && (
          <>
            {!op && (
              <button className="wave-fit" onClick={() => setRange([0, 1])}>
                ↔ {t("Fit trace")}
              </button>
            )}
            <button onClick={() => void exportCsv()}>
              ↓ {t("Export CSV")}
            </button>
          </>
        )}
        {result && !op && (
          <>
            <div className="cursor-toolbar">
              {([0, 1] as const).map((index) => (
                <button
                  key={index}
                  className={activeCursor === index ? "active" : ""}
                  onClick={() => setActiveCursor(index)}
                >
                  <i className={index === 0 ? "cursor-a" : "cursor-b"} />
                  {t("Cursor")} {index === 0 ? "A" : "B"}
                </button>
              ))}
              <button onClick={() => setCursors([null, null])}>
                {t("Clear")}
              </button>
            </div>
            <div className="cursor-readings">
              {cursorIndices.map(
                (sampleIndex, cursorIndex) =>
                  sampleIndex !== null && (
                    <section key={cursorIndex}>
                      <strong>{cursorIndex === 0 ? "A" : "B"}</strong>
                      <span>
                        {engineering(samples[sampleIndex], result.xAxis.unit)}
                      </span>
                      {activeSignals.map((signal) => (
                        <span key={signal.name}>
                          {signal.name}{" "}
                          {engineering(
                            signal.values[sampleIndex],
                            signal.displayUnit,
                          )}
                        </span>
                      ))}
                    </section>
                  ),
              )}
              {cursorDelta !== null && (
                <section className="cursor-delta">
                  <strong>Δ</strong>
                  <span>ΔX {engineering(cursorDelta, result.xAxis.unit)}</span>
                  {activeSignals.map((signal) => (
                    <span key={signal.name}>
                      Δ{signal.name}{" "}
                      {engineering(
                        signal.values[cursorIndices[1]!] -
                          signal.values[cursorIndices[0]!],
                        signal.displayUnit,
                      )}
                    </span>
                  ))}
                  {measuredFrequency !== null && (
                    <span>ƒ {engineering(measuredFrequency, "Hz")}</span>
                  )}
                </section>
              )}
            </div>
            <div className="wave-statistics">
              <strong>{t("VISIBLE RANGE")}</strong>
              {statistics.map(
                ({ signal, extrema }) =>
                  extrema && (
                    <span key={signal.name}>
                      {signal.name} ↓
                      {engineering(extrema.minimum, signal.displayUnit)}
                      {"  "}↑{engineering(extrema.maximum, signal.displayUnit)}
                    </span>
                  ),
              )}
            </div>
          </>
        )}
        {exportError && <p role="alert">{exportError}</p>}
      </div>
      <div className="wave-canvas" ref={host}>
        {op && result ? (
          <div className="operating-point">
            <table>
              <caption>{t("DC operating point")}</caption>
              <thead>
                <tr>
                  <th>{t("Signal")}</th>
                  <th>{t("Value")}</th>
                </tr>
              </thead>
              <tbody>
                {result.signals.map((signal) => (
                  <tr key={signal.name}>
                    <td>{signal.name}</td>
                    <td>{engineering(signal.samples[0], signal.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <canvas
            ref={canvas}
            aria-label={t("Simulation waveform")}
            onWheel={(event) => {
              if (!result) return;
              event.preventDefault();
              const point = Math.max(
                0,
                Math.min(
                  1,
                  (event.nativeEvent.offsetX - 64) /
                    ((canvas.current?.clientWidth || 100) - 82),
                ),
              );
              const span = range[1] - range[0],
                next = Math.min(
                  1,
                  Math.max(0.005, span * (event.deltaY > 0 ? 1.18 : 0.82)),
                );
              boundRange(range[0] + point * span - point * next, next);
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const width = (canvas.current?.clientWidth || 100) - 82;
              const position = Math.min(
                1,
                Math.max(0, (event.nativeEvent.offsetX - 64) / width),
              );
              const hit = cursors.findIndex(
                (cursor) =>
                  cursor !== null &&
                  Math.abs(positionFromX(cursor) - position) * width <= 9,
              );
              drag.current =
                hit >= 0
                  ? { kind: "cursor", index: hit as 0 | 1 }
                  : {
                      kind: "pan",
                      x: event.clientX,
                      range,
                      moved: false,
                    };
            }}
            onPointerMove={(event) => {
              const width = (canvas.current?.clientWidth || 100) - 82;
              const position = Math.min(
                1,
                Math.max(0, (event.nativeEvent.offsetX - 64) / width),
              );
              if (drag.current?.kind === "cursor") {
                const index = drag.current.index;
                setCursors((current) => {
                  const next: [number | null, number | null] = [...current];
                  next[index] = xFromPosition(position);
                  return next;
                });
              } else if (drag.current?.kind === "pan") {
                if (Math.abs(event.clientX - drag.current.x) > 2)
                  drag.current.moved = true;
                const span = drag.current.range[1] - drag.current.range[0];
                boundRange(
                  drag.current.range[0] -
                    ((event.clientX - drag.current.x) / width) * span,
                  span,
                );
              }
            }}
            onPointerUp={(event) => {
              const width = (canvas.current?.clientWidth || 100) - 82;
              const position = Math.min(
                1,
                Math.max(0, (event.nativeEvent.offsetX - 64) / width),
              );
              if (drag.current?.kind === "pan" && !drag.current.moved) {
                const index = activeCursor;
                setCursors((current) => {
                  const next: [number | null, number | null] = [...current];
                  next[index] = xFromPosition(position);
                  return next;
                });
                setActiveCursor(index === 0 ? 1 : 0);
              }
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
        )}
        {!result && (
          <div className={"wave-empty " + (error ? "error" : "")}>
            <div className="pulse-icon">⌁</div>
            <strong>
              {running
                ? t("Solving circuit…")
                : error
                  ? t("Simulation failed")
                  : t("No waveform data")}
            </strong>
            <span>
              {running
                ? t("ngspice is evaluating the active profile")
                : error || t("Run a valid SPICE analysis to inspect signals")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
