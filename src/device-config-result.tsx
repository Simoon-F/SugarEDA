import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  FileWarning,
} from "lucide-react";
import {
  locateDeviceConfigIssue,
  type DeviceConfigCanvasInstance,
} from "./device-config-location";
import type { DeviceConfigReport, DeviceTreeAdapterReport } from "./types";

export function DeviceConfigResult({
  report,
  adapterReport,
  instances,
  selectedInstanceId,
  language,
  onLocate,
}: {
  report: DeviceConfigReport | null;
  adapterReport: DeviceTreeAdapterReport | null;
  instances: DeviceConfigCanvasInstance[];
  selectedInstanceId: string;
  language: "zh-CN" | "en";
  onLocate: (componentId: string) => void;
}) {
  const zh = language === "zh-CN";
  const configReport = adapterReport?.configReport ?? report;

  return (
    <>
      {adapterReport && !adapterReport.translated && (
        <div className="device-tree-diagnostics">
          {adapterReport.issues.map((issue, index) => (
            <article key={[issue.code, issue.line, index].join(":")}>
              <FileWarning />
              <div>
                <code>{issue.code}</code>
                <p>{zh ? issue.messageZh : issue.messageEn}</p>
              </div>
              <span>
                {issue.line
                  ? (zh ? "行 " : "Ln ") +
                    issue.line +
                    ":" +
                    (issue.column ?? 1)
                  : "—"}
              </span>
            </article>
          ))}
        </div>
      )}

      {configReport && (
        <div
          className={
            "device-config-result " + (configReport.valid ? "valid" : "invalid")
          }
        >
          {configReport.valid ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <strong>
              {configReport.valid
                ? zh
                  ? "配置通过"
                  : "Configuration passed"
                : zh
                  ? "发现 " + configReport.issues.length + " 项配置问题"
                  : configReport.issues.length + " configuration issues found"}
            </strong>
            <p>
              {configReport.configName} · {configReport.checkedAssignments}{" "}
              {zh ? "项声明已检查" : "declarations checked"}
              {adapterReport?.translated &&
                " · " +
                  (zh ? "已由 DTS 子集转换" : "translated from DTS subset")}
            </p>
          </div>
        </div>
      )}

      {configReport && configReport.issues.length > 0 && (
        <div className="device-config-issues">
          {configReport.issues.map((issue, index) => {
            const componentId = locateDeviceConfigIssue(
              instances,
              selectedInstanceId,
              issue.pinId,
            );
            const subjectId = issue.pinId ?? issue.domainId;
            const sourceLines = adapterReport?.sourceLocations
              .filter(
                (location) =>
                  location.pinId === issue.pinId &&
                  location.domainId === issue.domainId,
              )
              .map((location) => location.line);
            return (
              <article
                key={[issue.code, issue.pinId ?? "global", index].join(":")}
              >
                <div>
                  <code>{issue.code}</code>
                  <span>
                    {subjectId || "—"}
                    {sourceLines?.length
                      ? " · L" + sourceLines.join(", L")
                      : ""}
                  </span>
                </div>
                <p>{zh ? issue.messageZh : issue.messageEn}</p>
                <button
                  disabled={!componentId}
                  title={
                    componentId
                      ? zh
                        ? "定位到承载该引脚的符号单元"
                        : "Locate the symbol unit that exposes this pin"
                      : zh
                        ? "所选逻辑实例尚未放置承载该引脚的单元"
                        : "The selected logical instance has no placed unit exposing this pin"
                  }
                  onClick={() => componentId && onLocate(componentId)}
                >
                  <Crosshair />
                  {componentId
                    ? zh
                      ? "定位单元"
                      : "Locate unit"
                    : zh
                      ? "单元未放置"
                      : "Unit not placed"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
