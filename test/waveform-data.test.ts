import { describe, expect, it } from "vitest";
import {
  frequencyFromCursorDelta,
  minMaxSampleIndices,
  nearestSample,
  seriesExtrema,
  waveformCsv,
} from "@/waveform-data";
describe("measurement data", () => {
  it("locates adaptive and descending sample coordinates instead of assuming a uniform time step", () => {
    expect(nearestSample([0, 0.001, 0.002, 0.8, 1], 0.77)).toBe(3);
    expect(nearestSample([5, 4, 0], 0.1)).toBe(2);
  });
  it("exports every probe and AC phase with quoted headings", () => {
    expect(
      waveformCsv({
        analysisType: "acSweep",
        signals: [
          { name: "v(out,in)", unit: "V", samples: [0.707], phase: [-45] },
        ],
        xAxis: { name: "frequency", unit: "Hz", samples: [159] },
        warnings: [],
        log: "",
        executionTimeMs: 0,
      }),
    ).toContain("159,0.707,-45");
  });
  it("preserves narrow peaks when reducing a large trace for Canvas", () => {
    const values = Array.from({ length: 1000 }, () => 0);
    values[417] = 12;
    values[418] = -4;
    const indices = minMaxSampleIndices(values, 0, 999, 100);
    expect(indices).toContain(417);
    expect(indices).toContain(418);
    expect(indices.length).toBeLessThanOrEqual(102);
  });
  it("calculates extrema and frequency from two time cursors", () => {
    expect(seriesExtrema([3, -2, 8, 1])).toMatchObject({
      minimum: -2,
      maximum: 8,
    });
    expect(frequencyFromCursorDelta(0.002, "s")).toBe(500);
    expect(frequencyFromCursorDelta(2, "Hz")).toBeNull();
  });
});
