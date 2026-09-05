import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileJson2,
  Gauge,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import type { BoardConfigurationTarget } from "./board-configuration-draft";
import type { DeviceConfigReport, DeviceConfigurationData } from "./types";

export type BoardEditorSection = "pinMux" | "electrical" | "metadata";

export function BoardConfigurationValidation({
  target,
  draft,
  section,
  report,
  validating,
  language,
  onSection,
  onLocate,
}: {
  target: BoardConfigurationTarget;
  draft: DeviceConfigurationData;
  section: BoardEditorSection;
  report: DeviceConfigReport | null;
  validating: boolean;
  language: "zh-CN" | "en";
  onSection: (section: BoardEditorSection) => void;
  onLocate: (logicalInstanceId: string, pinId?: string | null) => void;
}) {
  const zh = language === "zh-CN";
  return (
    <aside className="board-editor-rail">
      <div className="board-editor-device-card">
        <small>{target.embeddedPack.pack.manifest.vendor}</small>
        <strong>{target.instance.reference}</strong>
        <span>{target.device.name}</span>
        <code>{target.instance.variantId ?? "default"}</code>
      </div>
      <nav aria-label={zh ? "配置部分" : "Configuration sections"}>
        <button
          className={section === "pinMux" ? "active" : ""}
          onClick={() => onSection("pinMux")}
        >
          <SlidersHorizontal />
          <span>
            <b>PinMux</b>
            <small>
              {zh
                ? `${draft.pinMux.length} 项已分配`
                : `${draft.pinMux.length} assigned`}
            </small>
          </span>
          <ChevronRight />
        </button>
        <button
          className={section === "electrical" ? "active" : ""}
          onClick={() => onSection("electrical")}
        >
          <Gauge />
          <span>
            <b>{zh ? "启动与电压" : "Boot & voltage"}</b>
            <small>
              {zh
                ? `${draft.bootStraps.length + draft.voltageSelections.length} 项已配置`
                : `${draft.bootStraps.length + draft.voltageSelections.length} configured`}
            </small>
          </span>
          <ChevronRight />
        </button>
        <button
          className={section === "metadata" ? "active" : ""}
          onClick={() => onSection("metadata")}
        >
          <FileJson2 />
          <span>
            <b>{zh ? "元数据" : "Metadata"}</b>
            <small>{zh ? "来源 · 许可证" : "source · license"}</small>
          </span>
          <ChevronRight />
        </button>
      </nav>
      <div className="board-editor-validation-card">
        <div>
          {validating ? (
            <LoaderCircle className="spin" />
          ) : report?.valid ? (
            <CheckCircle2 />
          ) : (
            <AlertTriangle />
          )}
          <span>
            <strong>
              {validating
                ? zh
                  ? "Rust 校验中"
                  : "Validating in Rust"
                : report?.valid
                  ? zh
                    ? "配置有效"
                    : "Configuration valid"
                  : zh
                    ? "需要处理问题"
                    : "Issues require attention"}
            </strong>
            <small>
              {report
                ? `${report.checkedAssignments} assignments · ${report.issues.length} issues`
                : zh
                  ? "Rust 权威后端"
                  : "authoritative Rust backend"}
            </small>
          </span>
        </div>
        {report?.issues.slice(0, 8).map((issue, index) => (
          <button
            key={`${issue.code}:${issue.pinId ?? issue.domainId ?? index}`}
            onClick={() => {
              if (issue.domainId) onSection("electrical");
              else if (issue.pinId) onSection("pinMux");
              if (issue.pinId) onLocate(target.instance.id, issue.pinId);
            }}
          >
            <code>{issue.code}</code>
            <span>{zh ? issue.messageZh : issue.messageEn}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
