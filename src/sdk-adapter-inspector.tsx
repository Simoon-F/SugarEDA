import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  FolderSearch,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import type { DevicePack, SdkAdapterReport } from "./types";
import "./sdk-adapter-inspector.css";

export type SdkInspectionTarget = {
  packSha256: string;
  packName: string;
  deviceName: string;
  adapters: DevicePack["sdkAdapters"];
};

export function SdkAdapterInspector({
  target,
  language,
  onClose,
}: {
  target: SdkInspectionTarget | null;
  language: "zh-CN" | "en";
  onClose: () => void;
}) {
  const [adapterId, setAdapterId] = useState("");
  const [report, setReport] = useState<SdkAdapterReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAdapterId(target?.adapters[0]?.id ?? "");
    setReport(null);
    setError("");
  }, [target]);

  if (!target) return null;
  const selected =
    target.adapters.find((adapter) => adapter.id === adapterId) ??
    target.adapters[0];
  const zh = language === "zh-CN";

  const inspect = async () => {
    if (!selected) return;
    if (!isDesktop()) {
      setError(
        zh
          ? "SDK 目录检查仅在桌面应用中可用"
          : "SDK inspection is available in the desktop app only",
      );
      return;
    }
    const root = await open({ directory: true, multiple: false });
    if (typeof root !== "string") return;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(
        await api.inspectSdkAdapter(target.packSha256, selected.id, root),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sdk-inspector-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="sdk-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "SDK Adapter 检查" : "SDK Adapter inspection"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="sdk-inspector-title">
            <span>
              <FolderSearch />
            </span>
            <div>
              <h2>{zh ? "匹配本地 SDK" : "Match local SDK"}</h2>
              <p>
                {target.deviceName} · {target.packName}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
            <X />
          </button>
        </header>

        <div className="sdk-inspector-body">
          <div className="sdk-safety-note">
            <ShieldCheck />
            <div>
              <strong>
                {zh ? "只读目录结构检查" : "Read-only structure check"}
              </strong>
              <p>
                {zh
                  ? "不会读取源码、运行脚本、推断版本或修改所选目录。"
                  : "No source files are read, no scripts run, no version is inferred, and the selected directory is not modified."}
              </p>
            </div>
          </div>

          <label className="sdk-adapter-select">
            <span>SDK Adapter</span>
            <select
              value={selected?.id ?? ""}
              onChange={(event) => {
                setAdapterId(event.target.value);
                setReport(null);
                setError("");
              }}
            >
              {target.adapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.sdkType} · {adapter.versionRequirement}
                </option>
              ))}
            </select>
          </label>

          <div className="sdk-adapter-meta">
            <span>{zh ? "版本要求" : "Version requirement"}</span>
            <code>{selected?.versionRequirement}</code>
            <span>{zh ? "匹配模式" : "Path patterns"}</span>
            <code>{selected?.localPathPatterns.join(" · ")}</code>
          </div>

          <button
            className="sdk-choose-root"
            disabled={busy}
            onClick={() => void inspect()}
          >
            <FolderOpen />
            {busy
              ? zh
                ? "正在检查…"
                : "Inspecting…"
              : zh
                ? "选择 SDK 根目录"
                : "Choose SDK root"}
          </button>

          {error && (
            <div className="sdk-result error">
              <AlertTriangle />
              <span>{error}</span>
            </div>
          )}
          {report && (
            <div
              className={
                report.matched ? "sdk-result matched" : "sdk-result error"
              }
            >
              {report.matched ? <CheckCircle2 /> : <AlertTriangle />}
              <div>
                <strong>
                  {report.matched
                    ? zh
                      ? "目录结构匹配"
                      : "Directory structure matched"
                    : zh
                      ? "未找到匹配结构"
                      : "No matching structure found"}
                </strong>
                <p title={report.selectedRoot}>{report.selectedRoot}</p>
                <em>
                  {zh
                    ? "这不代表 SDK 版本兼容或配置正确"
                    : "This does not verify SDK version compatibility or configuration"}
                </em>
              </div>
            </div>
          )}

          {report && (
            <div className="sdk-pattern-results">
              {report.patterns.map((pattern) => (
                <div key={pattern.pattern}>
                  <code>{pattern.pattern}</code>
                  <span>
                    {pattern.matches.length
                      ? pattern.matches.join(", ")
                      : zh
                        ? "无匹配"
                        : "No match"}
                  </span>
                </div>
              ))}
              {report.issues.map((issue) => (
                <p key={issue.code} className={`sdk-issue ${issue.severity}`}>
                  {zh ? issue.messageZh : issue.messageEn}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
