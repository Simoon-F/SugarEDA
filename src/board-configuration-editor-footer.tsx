import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  GitCompareArrows,
  LoaderCircle,
  Save,
} from "lucide-react";
import type { BoardConfigurationExportFormat } from "./types";

export function BoardConfigurationEditorFooter({
  error,
  notice,
  dirty,
  changeCount,
  persisted,
  busy,
  validating,
  valid,
  language,
  onExport,
  onClose,
  onApply,
}: {
  error: string;
  notice: string;
  dirty: boolean;
  changeCount: number;
  persisted: boolean;
  busy: boolean;
  validating: boolean;
  valid: boolean;
  language: "zh-CN" | "en";
  onExport: (format: BoardConfigurationExportFormat) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const zh = language === "zh-CN";
  return (
    <footer className="board-editor-footer">
      <div className="board-editor-feedback" aria-live="polite">
        {error ? (
          <span className="error">
            <AlertTriangle /> {error}
          </span>
        ) : notice ? (
          <span className="success">
            <CheckCircle2 /> {notice}
          </span>
        ) : dirty ? (
          <span>
            <GitCompareArrows />
            {zh
              ? `${changeCount} 项未应用更改`
              : `${changeCount} unapplied changes`}
          </span>
        ) : (
          <span>
            <ClipboardCheck />
            {persisted
              ? zh
                ? "工程配置与草稿一致"
                : "Project configuration matches the draft"
              : zh
                ? "新配置尚未写入工程"
                : "New configuration has not been applied"}
          </span>
        )}
      </div>
      <div className="board-editor-export">
        <button
          disabled={!persisted || busy || dirty}
          onClick={() => onExport("json")}
          title={
            zh
              ? "先应用当前草稿后导出"
              : "Apply the current draft before export"
          }
        >
          <FileDown /> JSON
        </button>
        <button
          disabled={!persisted || busy || dirty}
          onClick={() => onExport("deviceTreeSubset")}
        >
          <FileDown /> DTS subset
        </button>
      </div>
      <button className="board-editor-cancel" onClick={onClose}>
        {zh ? "关闭" : "Close"}
      </button>
      <button
        className="board-editor-apply"
        disabled={!dirty || !valid || validating || busy}
        onClick={onApply}
      >
        {busy ? <LoaderCircle className="spin" /> : <Save />}
        {busy
          ? zh
            ? "写入中…"
            : "Applying…"
          : zh
            ? "应用到工程"
            : "Apply to project"}
      </button>
    </footer>
  );
}
