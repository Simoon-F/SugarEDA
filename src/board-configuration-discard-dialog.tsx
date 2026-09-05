import { AlertTriangle } from "lucide-react";

export function BoardConfigurationDiscardDialog({
  open,
  language,
  onCancel,
  onDiscard,
}: {
  open: boolean;
  language: "zh-CN" | "en";
  onCancel: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;
  const zh = language === "zh-CN";
  return (
    <div className="board-editor-confirm-backdrop">
      <div
        className="board-editor-confirm"
        role="alertdialog"
        aria-modal="true"
      >
        <AlertTriangle />
        <div>
          <h3>{zh ? "放弃未应用更改？" : "Discard unapplied changes?"}</h3>
          <p>
            {zh
              ? "当前草稿尚未写入工程，离开后无法恢复。"
              : "The current draft has not been applied to the project and cannot be recovered after leaving."}
          </p>
        </div>
        <button onClick={onCancel}>{zh ? "继续编辑" : "Keep editing"}</button>
        <button className="danger" onClick={onDiscard}>
          {zh ? "放弃草稿" : "Discard draft"}
        </button>
      </div>
    </div>
  );
}
