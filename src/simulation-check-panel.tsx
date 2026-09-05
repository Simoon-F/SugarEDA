import {
  AlertTriangle,
  CheckCircle2,
  LocateFixed,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./i18n";
import type { SimulationCheckIssue, SimulationCheckReport } from "./types";

const labels = {
  ground: "Ground reference",
  pins: "Components and pins",
  labels: "Network labels",
  probes: "Probes",
  analysis: "Analysis parameters",
} as const;

export function SimulationCheckPanel({
  report,
  checking,
  onCheck,
  onLocate,
  formatIssue,
}: {
  report: SimulationCheckReport | null;
  checking: boolean;
  onCheck: () => void;
  onLocate: (componentId: string) => void;
  formatIssue: (issue: SimulationCheckIssue) => string;
}) {
  const { t } = useI18n();
  return (
    <div className="simulation-check-panel">
      <div className="check-summary">
        <div
          className={`check-verdict ${report?.ready ? "ready" : report ? "blocked" : ""}`}
        >
          {report?.ready ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <strong>
              {report
                ? report.ready
                  ? t("Ready to simulate")
                  : t("Resolve checks before simulation")
                : t("Run simulation check")}
            </strong>
            <span>
              {report
                ? report.ready
                  ? t("Netlist generation succeeded")
                  : `${report.issues.length} ${t("issues found")}`
                : t("Validate the schematic before invoking ngspice")}
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={onCheck} disabled={checking}>
          <RefreshCw className={checking ? "spinning" : ""} />
          {checking ? t("Checking…") : t("Check again")}
        </Button>
      </div>
      <div className="check-categories" aria-label={t("Simulation check")}>
        {(report?.checks ?? []).map((check) => (
          <div
            key={check.category}
            className={check.passed ? "passed" : "failed"}
          >
            <span>{check.passed ? "✓" : "!"}</span>
            <strong>{t(labels[check.category])}</strong>
            <small>
              {check.passed
                ? t("Passed")
                : `${check.issueCount} ${t("issues")}`}
            </small>
          </div>
        ))}
      </div>
      {report?.issues.length ? (
        <div className="check-issues">
          {report.issues.map((issue, index) => (
            <button
              key={`${issue.code}-${issue.componentId}-${index}`}
              disabled={!issue.componentId}
              onClick={() => issue.componentId && onLocate(issue.componentId)}
              title={
                issue.componentId ? t("Locate component on canvas") : undefined
              }
            >
              <AlertTriangle />
              <span>{formatIssue(issue)}</span>
              {issue.componentId && <LocateFixed />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
