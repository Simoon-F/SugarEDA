import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  FileCog,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { BoardConfigurationCheckReport, Project } from "./types";
import "./board-configuration-panel.css";

type Props = {
  project: Project;
  report: BoardConfigurationCheckReport | null;
  checking: boolean;
  language: "zh-CN" | "en";
  onCheck: () => void;
  onLocate: (logicalInstanceId: string, pinId?: string | null) => void;
  onRemove: (configurationId: string) => void;
  onOpenManager: () => void;
};

export function BoardConfigurationPanel({
  project,
  report,
  checking,
  language,
  onCheck,
  onLocate,
  onRemove,
  onOpenManager,
}: Props) {
  const zh = language === "zh-CN";
  const configured =
    report?.entries.length ?? project.boardConfigurations.length;
  const issueCount =
    (report?.unconfigured.length ?? 0) +
    (report?.entries.reduce(
      (sum, entry) => sum + entry.report.issues.length,
      0,
    ) ?? 0);

  return (
    <div className="board-config-panel">
      <div className="board-config-summary">
        <div
          className={
            report?.passed ? "board-config-state passed" : "board-config-state"
          }
        >
          {report?.passed ? <CheckCircle2 /> : <FileCog />}
          <div>
            <strong>
              {report
                ? report.passed
                  ? zh
                    ? "板级配置检查通过"
                    : "Board configuration passed"
                  : zh
                    ? `${issueCount} 个配置问题`
                    : `${issueCount} configuration issues`
                : zh
                  ? "板级 PinMux 与启动配置"
                  : "Board PinMux and boot configuration"}
            </strong>
            <small>
              {report
                ? zh
                  ? `${configured}/${report.eligibleInstances} 个可配置器件已绑定`
                  : `${configured}/${report.eligibleInstances} configurable devices bound`
                : zh
                  ? `${configured} 个配置已随工程保存`
                  : `${configured} configurations embedded in project`}
            </small>
          </div>
        </div>
        <div className="board-config-actions">
          <button className="secondary" onClick={onOpenManager}>
            <FileCog />
            {zh ? "管理配置" : "Manage"}
          </button>
          <button onClick={onCheck} disabled={checking}>
            <RefreshCw className={checking ? "spin" : ""} />
            {checking
              ? zh
                ? "检查中…"
                : "Checking…"
              : zh
                ? "运行配置检查"
                : "Run check"}
          </button>
        </div>
      </div>

      <div className="board-config-results">
        {!report && project.boardConfigurations.length === 0 && (
          <div className="board-config-empty">
            <FileCog />
            <span>
              {zh
                ? "尚未绑定配置。先将 DevicePack 器件放入画布，再从器件包管理器导入 JSON 或受限 DTS 子集。"
                : "No configuration is bound. Place a DevicePack device, then import JSON or the restricted DTS subset from the device pack manager."}
            </span>
          </div>
        )}

        {!report &&
          project.boardConfigurations.map((configuration) => {
            const instance = project.deviceInstances.find(
              (item) => item.id === configuration.logicalInstanceId,
            );
            return (
              <ConfigurationRow
                key={configuration.id}
                id={configuration.id}
                reference={instance?.reference ?? "—"}
                sourceName={configuration.sourceName}
                sourceFormat={configuration.sourceFormat}
                hash={configuration.sourceSha256}
                valid={null}
                language={language}
                onLocate={() => onLocate(configuration.logicalInstanceId)}
                onRemove={() => onRemove(configuration.id)}
              />
            );
          })}

        {report?.unconfigured.map((item) => (
          <button
            className="board-config-missing"
            key={item.logicalInstanceId}
            onClick={() => onLocate(item.logicalInstanceId)}
          >
            <AlertTriangle />
            <code>{item.code}</code>
            <span>{zh ? item.messageZh : item.messageEn}</span>
            <Crosshair />
          </button>
        ))}

        {report?.entries.map((entry) => {
          const persisted = project.boardConfigurations.find(
            (item) => item.id === entry.boardConfigurationId,
          );
          return (
            <div
              className="board-config-entry"
              key={entry.boardConfigurationId}
            >
              <ConfigurationRow
                id={entry.boardConfigurationId}
                reference={entry.reference}
                sourceName={entry.sourceName}
                sourceFormat={entry.sourceFormat}
                hash={persisted?.sourceSha256 ?? ""}
                valid={entry.report.valid}
                language={language}
                onLocate={() => onLocate(entry.logicalInstanceId)}
                onRemove={() => onRemove(entry.boardConfigurationId)}
              />
              {entry.report.issues.map((issue, index) => (
                <button
                  className="board-config-issue"
                  key={`${issue.code}:${issue.pinId ?? ""}:${index}`}
                  onClick={() => onLocate(entry.logicalInstanceId, issue.pinId)}
                >
                  <code>{issue.code}</code>
                  <span>{zh ? issue.messageZh : issue.messageEn}</span>
                  <em>{issue.pinId ?? issue.domainId ?? "—"}</em>
                  <Crosshair />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfigurationRow({
  reference,
  sourceName,
  sourceFormat,
  hash,
  valid,
  language,
  onLocate,
  onRemove,
}: {
  id: string;
  reference: string;
  sourceName: string;
  sourceFormat: string;
  hash: string;
  valid: boolean | null;
  language: "zh-CN" | "en";
  onLocate: () => void;
  onRemove: () => void;
}) {
  const zh = language === "zh-CN";
  return (
    <div className="board-config-row">
      <span
        className={
          valid === false ? "config-indicator invalid" : "config-indicator"
        }
      >
        {valid === false ? <AlertTriangle /> : <CheckCircle2 />}
      </span>
      <strong>{reference}</strong>
      <span title={sourceName}>{sourceName}</span>
      <code>{sourceFormat === "json" ? "JSON" : "DTS subset"}</code>
      <code title={hash}>{hash ? hash.slice(0, 10) : "—"}</code>
      <button onClick={onLocate} title={zh ? "定位器件" : "Locate device"}>
        <Crosshair />
      </button>
      <button
        className="remove"
        onClick={onRemove}
        title={zh ? "移除配置" : "Remove configuration"}
      >
        <Trash2 />
      </button>
    </div>
  );
}
