import { describe, expect, it } from "vitest";
import { nearestSample, waveformCsv } from "@/waveform-data";
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
});
