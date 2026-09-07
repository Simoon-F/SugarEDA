import { useEffect, useRef, useState } from "react";
import { FilePlus2, Files, FileText, Pencil, X } from "lucide-react";
import type { EditorCommand, Project } from "./types";
import { nextSheetName, validSheetName } from "./schematic-sheet";
import "./schematic-tabs.css";

export function SchematicTabs({
  project,
  language,
  onCommand,
  onBeforeSwitch,
}: {
  project: Project;
  language: "zh-CN" | "en";
  onCommand: (command: EditorCommand) => void;
  onBeforeSwitch: () => void;
}) {
  const zh = language === "zh-CN";
  const activeId = project.uiViewState.activeSheetId;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.select(), [editingId]);
  const beginRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const finishRename = () => {
    if (!editingId) return;
    if (validSheetName(project, editingId, draftName))
      onCommand({ action: "renameSheet", id: editingId, name: draftName });
    setEditingId(null);
  };

  return (
    <div
      className="schematic-tabs"
      aria-label={zh ? "原理图页签" : "Schematic tabs"}
    >
      <div className="schematic-tab-strip">
        {project.sheets.map((sheet, index) => (
          <div
            key={sheet.id}
            className={`schematic-tab ${sheet.id === activeId ? "active" : ""}`}
          >
            {editingId === sheet.id ? (
              <input
                ref={input}
                value={draftName}
                maxLength={96}
                aria-label={zh ? "图纸名称" : "Sheet name"}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={finishRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") finishRename();
                  if (event.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button
                className="schematic-tab-select"
                onClick={() => {
                  if (sheet.id === activeId) return;
                  onBeforeSwitch();
                  onCommand({ action: "selectSheet", id: sheet.id });
                }}
                onDoubleClick={() => beginRename(sheet.id, sheet.name)}
                title={zh ? "双击重命名" : "Double-click to rename"}
              >
                <FileText />
                <small>{String(index + 1).padStart(2, "0")}</small>
                <span>{sheet.name}</span>
              </button>
            )}
            {sheet.id === activeId && editingId !== sheet.id && (
              <button
                className="schematic-tab-rename"
                onClick={() => beginRename(sheet.id, sheet.name)}
                aria-label={zh ? "重命名图纸" : "Rename sheet"}
              >
                <Pencil />
              </button>
            )}
            {project.sheets.length > 1 && editingId !== sheet.id && (
              <button
                className="schematic-tab-close"
                onClick={() => {
                  onBeforeSwitch();
                  onCommand({ action: "deleteSheet", id: sheet.id });
                }}
                aria-label={zh ? "删除图纸" : "Delete sheet"}
                title={
                  zh ? "删除图纸及其中内容" : "Delete sheet and its contents"
                }
              >
                <X />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="schematic-tab-add"
        onClick={() => {
          onBeforeSwitch();
          onCommand({
            action: "addSheet",
            name: nextSheetName(project, language),
          });
        }}
        aria-label={zh ? "新建原理图" : "New schematic sheet"}
      >
        <FilePlus2 />
        <span>{zh ? "新建图纸" : "New sheet"}</span>
      </button>
      <div className="schematic-tab-summary">
        <Files />
        {project.sheets.length} {zh ? "张图纸" : "sheets"}
      </div>
    </div>
  );
}
