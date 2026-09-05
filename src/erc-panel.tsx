import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  RefreshCw,
} from "lucide-react";
import type { ErcReport } from "./types";
import { useI18n } from "./i18n";

export function ErcPanel({
  report,
  checking,
  onCheck,
  onLocate,
}: {
  report: ErcReport | null;
  checking: boolean;
  onCheck: () => void;
  onLocate: (deviceId: string) => void;
}) {
  const { language, t } = useI18n();
  return (
    <div className="erc-panel">
      <div className="erc-summary">
        <div className={report?.passed ? "erc-state passed" : "erc-state"}>
          {report?.passed ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <strong>
              {report
                ? report.passed
                  ? t("ERC passed")
                  : `${report.issues.length} ${t("ERC issues")}`
                : t("Electrical rules check")}
            </strong>
            <small>
              {report
                ? `${report.checkedDevices} ${t("devices")} · ${report.checkedPins} ${t("pins")}`
                : t("Check DevicePack pin rules and connected nets")}
            </small>
          </div>
        </div>
        <button onClick={onCheck} disabled={checking}>
          <RefreshCw className={checking ? "spin" : ""} />
          {checking ? t("Checking…") : t("Run ERC")}
        </button>
      </div>
      <div className="erc-issues">
        {report?.issues.map((issue, index) => (
          <button
            key={`${issue.code}:${issue.deviceId}:${issue.pinId}:${index}`}
            onClick={() => onLocate(issue.deviceId)}
          >
            <span className="erc-code">{issue.code}</span>
            <span>
              {language === "zh-CN" ? issue.messageZh : issue.messageEn}
            </span>
            <code>{issue.pinId || "—"}</code>
            <Crosshair />
          </button>
        ))}
        {report?.passed && (
          <div className="erc-clean">
            <CheckCircle2 />
            {t("No electrical-rule violations found")}
          </div>
        )}
      </div>
    </div>
  );
}
