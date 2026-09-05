import type { SimulationResult } from "./types";

export function nearestSample(samples: number[], value: number): number {
  if (samples.length < 2) return 0;
  const direction = samples[samples.length - 1] >= samples[0] ? 1 : -1;
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid] * direction < value * direction) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 &&
    Math.abs(samples[lo - 1] - value) < Math.abs(samples[lo] - value)
    ? lo - 1
    : lo;
}

export function waveformCsv(result: SimulationResult): string {
  // Prefix formula-leading names to keep spreadsheet applications from evaluating them.
  const quote = (text: string) =>
    '"' + (/^[=+\-@]/.test(text) ? "'" : "") + text.replace(/"/g, '""') + '"';
  const columns = result.signals.flatMap((signal) => [
    { name: signal.name + " [" + signal.unit + "]", samples: signal.samples },
    ...(signal.phase
      ? [{ name: signal.name + " phase [deg]", samples: signal.phase }]
      : []),
  ]);
  return [
    [
      quote(result.xAxis.name + " [" + result.xAxis.unit + "]"),
      ...columns.map((column) => quote(column.name)),
    ].join(","),
    ...result.xAxis.samples.map((x, index) =>
      [x, ...columns.map((column) => column.samples[index])].join(","),
    ),
  ].join("\r\n");
}
