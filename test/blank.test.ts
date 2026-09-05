import { describe, expect, it } from "vitest";
import { createBlankSnapshot } from "@/blank";

describe("blank workspace", () => {
  it("starts without demo components or wires", () => {
    const snapshot = createBlankSnapshot();
    expect(snapshot.project.metadata.name).toBe("Untitled circuit");
    expect(snapshot.project.sheets[0].components).toEqual([]);
    expect(snapshot.project.sheets[0].wires).toEqual([]);
    expect(snapshot.project.simulationProfiles).toHaveLength(1);
  });
});
