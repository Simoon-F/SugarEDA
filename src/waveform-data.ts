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

export function seriesExtrema(
  values: number[],
  first = 0,
  last = values.length - 1,
) {
  let minimum = Infinity;
  let maximum = -Infinity;
  let minimumIndex = -1;
  let maximumIndex = -1;
  for (let index = Math.max(0, first); index <= last; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (value < minimum) {
      minimum = value;
      minimumIndex = index;
    }
    if (value > maximum) {
      maximum = value;
      maximumIndex = index;
    }
  }
  return minimumIndex < 0
    ? null
    : { minimum, maximum, minimumIndex, maximumIndex };
}

/** Min/max envelope indices preserve narrow peaks while bounding Canvas work. */
export function minMaxSampleIndices(
  values: number[],
  first: number,
  last: number,
  maxPoints: number,
) {
  const count = Math.max(0, last - first + 1);
  if (count <= maxPoints)
    return Array.from({ length: count }, (_, index) => first + index);
  const bucketSize = Math.max(1, Math.ceil(count / Math.max(1, maxPoints / 2)));
  const indices = new Set<number>([first, last]);
  for (let start = first; start <= last; start += bucketSize) {
    const end = Math.min(last, start + bucketSize - 1);
    const extrema = seriesExtrema(values, start, end);
    if (extrema) {
      indices.add(extrema.minimumIndex);
      indices.add(extrema.maximumIndex);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

export function frequencyFromCursorDelta(delta: number, xUnit: string) {
  return xUnit === "s" && Number.isFinite(delta) && Math.abs(delta) > 0
    ? 1 / Math.abs(delta)
    : null;
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
