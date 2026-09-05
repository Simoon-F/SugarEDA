import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, SlidersHorizontal, X } from "lucide-react";
import { api, isDesktop } from "./bridge";
import {
  assignBootStrap,
  assignPinFunction,
  assignVoltage,
  boardConfigurationTargets,
  canonicalDraft,
  countDraftChanges,
  createBoardConfigurationDraft,
  draftSignature,
} from "./board-configuration-draft";
import { BoardConfigurationBootVoltage } from "./board-configuration-boot-voltage";
import { BoardConfigurationDiscardDialog } from "./board-configuration-discard-dialog";
import { BoardConfigurationEditorFooter } from "./board-configuration-editor-footer";
import { BoardConfigurationMetadata } from "./board-configuration-metadata";
import { BoardConfigurationPinMux } from "./board-configuration-pinmux";
import {
  BoardConfigurationValidation,
  type BoardEditorSection,
} from "./board-configuration-validation";
import type {
  BoardConfigurationExportFormat,
  DeviceConfigReport,
  DeviceConfigurationData,
  Project,
  Snapshot,
} from "./types";
import "./board-configuration-editor.css";

export function BoardConfigurationEditor({
  open,
  project,
  initialInstanceId,
  language,
  onClose,
  onApplied,
  onLocate,
}: {
  open: boolean;
  project: Project;
  initialInstanceId: string | null;
  language: "zh-CN" | "en";
  onClose: () => void;
  onApplied: (snapshot: Snapshot) => void;
  onLocate: (logicalInstanceId: string, pinId?: string | null) => void;
}) {
  const zh = language === "zh-CN";
  const targets = useMemo(() => boardConfigurationTargets(project), [project]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [draft, setDraft] = useState<DeviceConfigurationData | null>(null);
  const [baseline, setBaseline] = useState<DeviceConfigurationData | null>(
    null,
  );
  const [section, setSection] = useState<BoardEditorSection>("pinMux");
  const [report, setReport] = useState<DeviceConfigReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [persistedId, setPersistedId] = useState<string | null>(null);
  const validationSequence = useRef(0);

  useEffect(() => {
    if (!open) return;
    const preferred = targets.some(
      (target) => target.instance.id === initialInstanceId,
    )
      ? initialInstanceId
      : targets[0]?.instance.id;
    setSelectedInstanceId(preferred ?? "");
  }, [initialInstanceId, open, targets]);

  useEffect(() => {
    if (!open || !selectedInstanceId) return;
    const target = targets.find(
      (candidate) => candidate.instance.id === selectedInstanceId,
    );
    if (!target) return;
    const next = createBoardConfigurationDraft(target);
    setDraft(next);
    setBaseline(structuredClone(next));
    setPersistedId(target.configuration?.id ?? null);
    setReport(null);
    setError("");
    setNotice("");
    setSection("pinMux");
  }, [open, selectedInstanceId, targets]);

  const target = targets.find(
    (candidate) => candidate.instance.id === selectedInstanceId,
  );
  const signature = draft ? draftSignature(draft) : "";
  const baselineSignature = baseline ? draftSignature(baseline) : "";
  const dirty = Boolean(draft && baseline && signature !== baselineSignature);
  const changeCount =
    draft && baseline ? countDraftChanges(baseline, draft) : 0;

  useEffect(() => {
    if (!open || !target || !draft) return;
    const sequence = ++validationSequence.current;
    setValidating(true);
    setReport(null);
    setError("");
    const timer = window.setTimeout(() => {
      if (!isDesktop()) {
        if (sequence === validationSequence.current) {
          setValidating(false);
          setError(
            zh
              ? "实时校验与保存仅在 Tauri 桌面应用中可用"
              : "Live validation and persistence are available in the Tauri desktop app only",
          );
        }
        return;
      }
      void api
        .validateBoardConfigurationDraft(
          target.instance.id,
          canonicalDraft(draft),
        )
        .then((nextReport) => {
          if (sequence === validationSequence.current) setReport(nextReport);
        })
        .catch((reason) => {
          if (sequence === validationSequence.current)
            setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (sequence === validationSequence.current) setValidating(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft, open, signature, target, zh]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (dirty) {
        setPendingTargetId(null);
        setDiscardRequested(true);
      } else onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dirty, onClose, open]);

  if (!open) return null;

  const issuePinIds = new Set(
    report?.issues.flatMap((issue) => (issue.pinId ? [issue.pinId] : [])) ?? [],
  );
  const issueDomainIds = new Set(
    report?.issues.flatMap((issue) =>
      issue.domainId ? [issue.domainId] : [],
    ) ?? [],
  );
  const requestClose = () => {
    if (dirty) {
      setPendingTargetId(null);
      setDiscardRequested(true);
    } else onClose();
  };
  const requestTarget = (nextId: string) => {
    if (nextId === selectedInstanceId) return;
    if (dirty) setPendingTargetId(nextId);
    else setSelectedInstanceId(nextId);
  };
  const discardDraft = () => {
    if (pendingTargetId) {
      setSelectedInstanceId(pendingTargetId);
      setPendingTargetId(null);
      return;
    }
    setDiscardRequested(false);
    onClose();
  };
  const applyDraft = async () => {
    if (!target || !draft || !report?.valid || !isDesktop()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await api.applyBoardConfigurationDraft(
        target.instance.id,
        canonicalDraft(draft),
      );
      const stored = next.project.boardConfigurations.find(
        (configuration) =>
          configuration.logicalInstanceId === target.instance.id,
      );
      setPersistedId(stored?.id ?? null);
      setBaseline(structuredClone(draft));
      onApplied(next);
      setNotice(
        zh
          ? "配置已作为一个可撤销事务写入工程"
          : "Configuration applied as one undoable project transaction",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const exportConfiguration = async (
    format: BoardConfigurationExportFormat,
  ) => {
    if (!target || !persistedId || !isDesktop()) return;
    const extension = format === "json" ? "device-config.json" : "sugareda.dts";
    const path = await save({
      defaultPath: `${target.instance.reference.toLowerCase()}.${extension}`,
      filters: [
        {
          name:
            format === "json"
              ? "SugarEDA Device Configuration"
              : "SugarEDA Device Tree Subset",
          extensions: [format === "json" ? "json" : "dts"],
        },
      ],
    });
    if (!path) return;
    const requiredSuffix = `.${extension}`;
    const resolved = path.endsWith(requiredSuffix)
      ? path
      : `${path}${requiredSuffix}`;
    setBusy(true);
    setError("");
    try {
      const receipt = await api.exportBoardConfiguration(
        persistedId,
        resolved,
        format,
      );
      setNotice(
        zh
          ? `已导出 ${receipt.bytesWritten} 字节 · SHA-256 ${receipt.sha256.slice(0, 10)}…`
          : `Exported ${receipt.bytesWritten} bytes · SHA-256 ${receipt.sha256.slice(0, 10)}…`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="board-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className="board-configuration-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="board-editor-header">
          <div className="board-editor-title">
            <span>
              <SlidersHorizontal />
            </span>
            <div>
              <small>DEVICE CONFIGURATION IR · v1</small>
              <h2 id="board-editor-title">
                {zh ? "板级配置编辑器" : "Board configuration editor"}
              </h2>
            </div>
          </div>
          <label className="board-editor-target-select">
            <span>{zh ? "逻辑器件" : "Logical device"}</span>
            <select
              value={selectedInstanceId}
              onChange={(event) => requestTarget(event.target.value)}
            >
              {targets.map((candidate) => (
                <option
                  key={candidate.instance.id}
                  value={candidate.instance.id}
                >
                  {candidate.instance.reference} · {candidate.device.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="board-editor-close"
            onClick={requestClose}
            aria-label={zh ? "关闭" : "Close"}
          >
            <X />
          </button>
        </header>

        {!target || !draft ? (
          <div className="board-editor-no-target">
            <AlertTriangle />
            <h3>{zh ? "没有可配置器件" : "No configurable devices"}</h3>
            <p>
              {zh
                ? "先从器件包放置声明了 PinMux、启动绑带或配置规则的器件。"
                : "Place a DevicePack part that declares PinMux, boot strap, or configuration rules first."}
            </p>
          </div>
        ) : (
          <div className="board-editor-layout">
            <BoardConfigurationValidation
              target={target}
              draft={draft}
              section={section}
              report={report}
              validating={validating}
              language={language}
              onSection={setSection}
              onLocate={onLocate}
            />
            <main className="board-editor-main">
              {section === "pinMux" && (
                <BoardConfigurationPinMux
                  device={target.device}
                  draft={draft}
                  issuePinIds={issuePinIds}
                  language={language}
                  onAssign={(pinId, selectedFunction) =>
                    setDraft(assignPinFunction(draft, pinId, selectedFunction))
                  }
                />
              )}
              {section === "electrical" && (
                <BoardConfigurationBootVoltage
                  device={target.device}
                  draft={draft}
                  issuePinIds={issuePinIds}
                  issueDomainIds={issueDomainIds}
                  language={language}
                  onBootStrap={(pinId, value) =>
                    setDraft(assignBootStrap(draft, pinId, value))
                  }
                  onVoltage={(domainId, voltage) =>
                    setDraft(assignVoltage(draft, domainId, voltage))
                  }
                />
              )}
              {section === "metadata" && (
                <BoardConfigurationMetadata
                  draft={draft}
                  language={language}
                  onChange={setDraft}
                />
              )}
            </main>
          </div>
        )}

        <BoardConfigurationEditorFooter
          error={error}
          notice={notice}
          dirty={dirty}
          changeCount={changeCount}
          persisted={Boolean(persistedId)}
          busy={busy}
          validating={validating}
          valid={Boolean(report?.valid)}
          language={language}
          onExport={(format) => void exportConfiguration(format)}
          onClose={requestClose}
          onApply={() => void applyDraft()}
        />
        <BoardConfigurationDiscardDialog
          open={discardRequested || Boolean(pendingTargetId)}
          language={language}
          onCancel={() => {
            setDiscardRequested(false);
            setPendingTargetId(null);
          }}
          onDiscard={discardDraft}
        />
      </section>
    </div>
  );
}
