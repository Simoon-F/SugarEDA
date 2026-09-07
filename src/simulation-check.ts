import { analyzeSchematic } from "./schematic-geometry";
import type {
  Project,
  SimulationCheckCategory,
  SimulationCheckIssue,
  SimulationCheckReport,
  SimulationProfile,
} from "./types";
import { activeSchematicSheet } from "./schematic-sheet";

export type ProbeOption = {
  value: string;
  label: string;
  kind: "voltage" | "current";
};

const identifier = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

export function availableProbeOptions(project: Project): ProbeOption[] {
  const sheet = activeSchematicSheet(project);
  if (!sheet) return [];
  const names = new Set<string>();
  for (const label of sheet.netLabels)
    if (identifier(label.name.trim())) names.add(label.name.trim());
  for (const component of sheet.components)
    if (component.kind === "netLabel") {
      const name = component.parameters.value?.trim();
      if (name && identifier(name)) names.add(name);
    }
  const voltage = [...names]
    .sort((first, second) => first.localeCompare(second))
    .map((name) => ({
      value: `v(${name})`,
      label: name,
      kind: "voltage" as const,
    }));
  const current = sheet.components
    .filter(
      (component) =>
        component.spiceRef &&
        (component.kind === "voltageSource" ||
          component.kind === "currentSource"),
    )
    .map((component) => ({
      value: `i(${component.spiceRef.toLowerCase()})`,
      label: component.spiceRef,
      kind: "current" as const,
    }));
  return [...voltage, ...current];
}

const spiceNumber = (value: string) => {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+))(meg|[tgkmunpf])?$/);
  if (!match) return null;
  const scales: Record<string, number> = {
    t: 1e12,
    g: 1e9,
    meg: 1e6,
    k: 1e3,
    m: 1e-3,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12,
    f: 1e-15,
  };
  return Number(match[1]) * (scales[match[2]] ?? 1);
};

const validAnalysis = (profile: SimulationProfile) => {
  const analysis = profile.analysis;
  if (analysis.type === "operatingPoint") return true;
  if (analysis.type === "transient") {
    const step = spiceNumber(analysis.step);
    const stop = spiceNumber(analysis.stop);
    return step !== null && stop !== null && step > 0 && stop > step;
  }
  if (analysis.type === "dcSweep") {
    const start = spiceNumber(analysis.start);
    const stop = spiceNumber(analysis.stop);
    const step = spiceNumber(analysis.step);
    return (
      identifier(analysis.source) &&
      start !== null &&
      stop !== null &&
      step !== null &&
      step !== 0 &&
      (stop - start) / step > 0
    );
  }
  const start = spiceNumber(analysis.start);
  const stop = spiceNumber(analysis.stop);
  return (
    ["dec", "oct", "lin"].includes(analysis.variation) &&
    analysis.points > 0 &&
    analysis.points <= 10_000 &&
    start !== null &&
    stop !== null &&
    start > 0 &&
    stop > start
  );
};

export function localSimulationCheck(
  project: Project,
  profile: SimulationProfile,
): SimulationCheckReport {
  const sheet = activeSchematicSheet(project);
  const diagnostics = analyzeSchematic(project);
  const issues: SimulationCheckIssue[] = [];
  const add = (
    code: string,
    category: SimulationCheckCategory,
    message: string,
    componentId: string | null = null,
  ) => issues.push({ code, category, message, componentId });

  if (!sheet.components.some((component) => component.kind === "ground"))
    add("missing_ground", "ground", "Schematic requires a ground reference");
  for (const pinId of diagnostics.floatingPinIds) {
    const [componentId, pin] = pinId.split(":");
    add(
      "floating_pin",
      "pins",
      `Pin ${pin} is not electrically connected`,
      componentId,
    );
  }
  for (const componentId of diagnostics.disconnectedLabelIds) {
    const component = sheet.components.find((item) => item.id === componentId);
    const legacy = sheet.netLabels.find((item) => item.id === componentId);
    const name = component?.parameters.value || legacy?.name || "";
    add(
      "floating_label",
      "labels",
      `Network label '${name}' is not attached to a component pin or wire`,
      component?.id ?? null,
    );
  }
  const available = new Set(
    availableProbeOptions(project).map((option) => option.value.toLowerCase()),
  );
  for (const signal of profile.signals)
    if (!available.has(signal.toLowerCase()))
      add(
        "unknown_probe",
        "probes",
        `Probe '${signal}' does not match an available labeled network or source`,
      );
  if (!validAnalysis(profile))
    add("invalid_analysis", "analysis", "Choose valid analysis parameters");

  const categories: SimulationCheckCategory[] = [
    "ground",
    "pins",
    "labels",
    "probes",
    "analysis",
  ];
  return {
    ready: issues.length === 0,
    checks: categories.map((category) => {
      const issueCount = issues.filter(
        (issue) => issue.category === category,
      ).length;
      return { category, passed: issueCount === 0, issueCount };
    }),
    issues,
    netlist: null,
  };
}
