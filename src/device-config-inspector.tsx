import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson2,
  ScanSearch,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import type { DeviceConfigReport } from "./types";
import "./device-config-inspector.css";

export type DeviceConfigTarget = {
  packSha256: string;
  packName: string;
  deviceId: string;
  deviceName: string;
  alternateFunctionCount: number;
  bootPinCount: number;
};

export function DeviceConfigInspector({
  target,
  language,
  onClose,
}: {
  target: DeviceConfigTarget | null;
  language: "zh-CN" | "en";
  onClose: () => void;
}) {
  const [report, setReport] = useState<DeviceConfigReport | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const zh = language === "zh-CN";

  useEffect(() => {
    setReport(null);
    setSelectedPath("");
    setError("");
  }, [target]);

  if (!target) return null;

  const chooseAndCheck = async () => {
    if (!isDesktop()) {
      setError(
        zh
          ? "器件配置检查仅在桌面应用中可用"
          : "Device configuration checking is available in the desktop app only",
      );
      return;
    }
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "SugarEDA Device Configuration",
          extensions: ["json"],
        },
      ],
    });
    if (typeof path !== "string") return;
    setSelectedPath(path);
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(
        await api.checkDeviceConfig(target.packSha256, target.deviceId, path),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="device-config-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="device-config-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "器件配置检查" : "Device configuration check"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="device-config-title">
            <span>
              <ScanSearch />
            </span>
            <div>
              <h2>{zh ? "检查器件配置" : "Check device configuration"}</h2>
              <p>
                {target.deviceName} · {target.packName}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
            <X />
          </button>
        </header>

        <div className="device-config-body">
          <div className="device-config-safety">
            <ShieldCheck />
            <div>
              <strong>
                {zh ? "受限的厂商无关 JSON" : "Restricted vendor-neutral JSON"}
              </strong>
              <p>
                {zh
                  ? "只检查 PinMux、引脚和启动配置；不解析 SDK 或 DTS，不执行脚本，也不保存本地路径。"
                  : "Checks PinMux, pins, and boot straps only; no SDK or DTS parsing, script execution, or local-path persistence."}
              </p>
            </div>
          </div>

          <div className="device-config-scope">
            <div>
              <span>PinMux</span>
              <strong>{target.alternateFunctionCount}</strong>
              <small>{zh ? "个可复用引脚" : "mux-capable pins"}</small>
            </div>
            <div>
              <span>BOOT</span>
              <strong>{target.bootPinCount}</strong>
              <small>{zh ? "个必配绑带" : "required straps"}</small>
            </div>
            <div>
              <span>FORMAT</span>
              <strong>v1</strong>
              <small>.device-config.json</small>
            </div>
          </div>

          <button
            className="device-config-choose"
            disabled={busy}
            onClick={() => void chooseAndCheck()}
          >
            <FileJson2 />
            {busy
              ? zh
                ? "正在校验…"
                : "Validating…"
              : zh
                ? "选择并检查配置"
                : "Choose and check configuration"}
          </button>

          {selectedPath && (
            <p className="device-config-path" title={selectedPath}>
              {selectedPath.split(/[\\/]/).pop()}
            </p>
          )}
          {error && (
            <div className="device-config-result invalid">
              <AlertTriangle />
              <span>{error}</span>
            </div>
          )}
          {report && (
            <div
              className={`device-config-result ${report.valid ? "valid" : "invalid"}`}
            >
              {report.valid ? <CheckCircle2 /> : <AlertTriangle />}
              <div>
                <strong>
                  {report.valid
                    ? zh
                      ? "配置通过"
                      : "Configuration passed"
                    : zh
                      ? `发现 ${report.issues.length} 项配置问题`
                      : `${report.issues.length} configuration issues found`}
                </strong>
                <p>
                  {report.configName} · {report.checkedAssignments}{" "}
                  {zh ? "项声明已检查" : "declarations checked"}
                </p>
              </div>
            </div>
          )}

          {report && report.issues.length > 0 && (
            <div className="device-config-issues">
              {report.issues.map((issue, index) => (
                <article
                  key={`${issue.code}:${issue.pinId ?? "global"}:${index}`}
                >
                  <div>
                    <code>{issue.code}</code>
                    {issue.pinId && <span>{issue.pinId}</span>}
                  </div>
                  <p>{zh ? issue.messageZh : issue.messageEn}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
