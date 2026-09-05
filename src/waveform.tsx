import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationResult } from "./types";
import { nearestSample, waveformCsv } from "./waveform-data";
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [mode, setMode] = useState<"magnitude" | "db" | "phase">("magnitude");
  const [unit, setUnit] = useState("V");
  const [exportError, setExportError] = useState("");
  const drag = useRef<{ x: number; range: [number, number] } | null>(null);
  const ac = result?.analysisType === "acSweep";
  const op = result?.analysisType === "operatingPoint";
  useEffect(() => {
    setRange([0, 1]);
    setCursor(null);
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
  const cursorX =
    cursor === null
      ? null
      : ac
        ? 10 ** (x0 + cursor * (x1 - x0))
        : x0 + cursor * (x1 - x0);
  const cursorIndex = cursorX === null ? 0 : nearestSample(samples, cursorX);
  useEffect(() => {
    const draw = () => {
      const el = canvas.current;
      if (!el) return;
      const rect = el.getBoundingClientRect(),
        dpr = devicePixelRatio || 1;
      el.width = Math.round(rect.width * dpr);
      el.height = Math.round(rect.height * dpr);
      const c = el.getContext("2d");
      if (!c) return;
      c.scale(dpr, dpr);
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
      const active = signals.filter(
        (signal) => signal.unit === unit && !hidden.has(signal.name),
      );
      let ymin = Infinity,
        ymax = -Infinity;
      for (const signal of active)
        for (let i = first; i <= last; i++) {
          const value = signal.values[i];
          if (Number.isFinite(value)) {
            ymin = Math.min(ymin, value);
            ymax = Math.max(ymax, value);
          }
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
        for (let i = first; i <= last; i++) {
          const x = left + ((transform(samples[i]) - x0) / (x1 - x0 || 1)) * w;
          const y = top + h - ((signal.values[i] - ymin) / (ymax - ymin)) * h;
          if (i === first) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
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
      if (cursor !== null) {
        c.strokeStyle = "#2869df";
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(left + cursor * w, top);
        c.lineTo(left + cursor * w, top + h);
        c.stroke();
        c.setLineDash([]);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  });
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
              <strong>{t("Simulation succeeded")}</strong>
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
        {cursor !== null && result && (
          <div className="cursor-readings">
            <span>{engineering(samples[cursorIndex], result.xAxis.unit)}</span>
            {signals
              .filter(
                (signal) => signal.unit === unit && !hidden.has(signal.name),
              )
              .map((signal) => (
                <span key={signal.name}>
                  {signal.name}{" "}
                  {engineering(signal.values[cursorIndex], signal.displayUnit)}
                </span>
              ))}
          </div>
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
              drag.current = { x: event.clientX, range };
            }}
            onPointerMove={(event) => {
              const width = (canvas.current?.clientWidth || 100) - 82;
              setCursor(
                Math.min(
                  1,
                  Math.max(0, (event.nativeEvent.offsetX - 64) / width),
                ),
              );
              if (drag.current) {
                const span = drag.current.range[1] - drag.current.range[0];
                boundRange(
                  drag.current.range[0] -
                    ((event.clientX - drag.current.x) / width) * span,
                  span,
                );
              }
            }}
            onPointerUp={(event) => {
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onPointerLeave={() => {
              if (!drag.current) setCursor(null);
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
