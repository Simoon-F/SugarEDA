import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FileJson2,
  Save,
  ScanSearch,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import type { DeviceConfigCanvasInstance } from "./device-config-location";
import { DeviceConfigResult } from "./device-config-result";
import type {
  BoardConfigurationSourceFormat,
  DeviceConfigReport,
  DeviceTreeAdapterReport,
  Snapshot,
} from "./types";
import "./device-config-inspector.css";

export type DeviceConfigTarget = {
  packSha256: string;
  packName: string;
  deviceId: string;
  deviceName: string;
  alternateFunctionCount: number;
  bootPinCount: number;
  instances: DeviceConfigCanvasInstance[];
};

export function DeviceConfigInspector({
  target,
  language,
  onClose,
  onLocate,
  onImported,
}: {
  target: DeviceConfigTarget | null;
  language: "zh-CN" | "en";
  onClose: () => void;
  onLocate: (componentId: string) => void;
  onImported: (snapshot: Snapshot) => void;
}) {
  const [report, setReport] = useState<DeviceConfigReport | null>(null);
  const [adapterReport, setAdapterReport] =
    useState<DeviceTreeAdapterReport | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [selectedFormat, setSelectedFormat] =
    useState<BoardConfigurationSourceFormat | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const zh = language === "zh-CN";

  useEffect(() => {
    setReport(null);
    setAdapterReport(null);
    setSelectedPath("");
    setSelectedInstanceId(target?.instances[0]?.id ?? "");
    setSelectedFormat(null);
    setError("");
    setSaved(false);
  }, [target]);

  if (!target) return null;

  const chooseAndCheck = async (kind: "json" | "deviceTree") => {
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
          name:
            kind === "json"
              ? "SugarEDA Device Configuration"
              : "SugarEDA Device Tree Subset",
          extensions: [kind === "json" ? "json" : "dts"],
        },
      ],
    });
    if (typeof path !== "string") return;
    setSelectedPath(path);
    setSelectedFormat(kind === "json" ? "json" : "deviceTreeSubset");
    setBusy(true);
    setSaved(false);
    setError("");
    setReport(null);
    setAdapterReport(null);
    try {
      if (kind === "json") {
        setReport(
          await api.checkDeviceConfig(target.packSha256, target.deviceId, path),
        );
      } else {
        setAdapterReport(
          await api.checkDeviceTreeConfig(
            target.packSha256,
            target.deviceId,
            path,
          ),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveToProject = async () => {
    if (!selectedPath || !selectedFormat || !selectedInstanceId) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const snapshot = await api.importBoardConfiguration(
        selectedInstanceId,
        selectedPath,
        selectedFormat,
      );
      onImported(snapshot);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const canPersist = Boolean(
    selectedPath &&
    selectedFormat &&
    selectedInstanceId &&
    (report || adapterReport?.translated),
  );

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
                {zh
                  ? "受限配置 IR 与 Device Tree 子集"
                  : "Restricted configuration IR and Device Tree subset"}
              </strong>
              <p>
                {zh
                  ? "DTS Adapter 只接受 SugarEDA 独立子集；拒绝 include、引用和任意属性，不执行脚本，也不保存本地路径。"
                  : "The DTS adapter accepts only the standalone SugarEDA subset; includes, references, and arbitrary properties are rejected, with no script execution or path persistence."}
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
              <span>CONFIG IR</span>
              <strong>v1</strong>
              <small>JSON · DTS subset</small>
            </div>
          </div>

          {target.instances.length > 0 && (
            <label className="device-config-instance">
              <span>{zh ? "画布定位实例" : "Canvas target instance"}</span>
              <select
                value={selectedInstanceId}
                onChange={(event) => setSelectedInstanceId(event.target.value)}
              >
                {target.instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.reference} · {instance.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="device-config-import-actions">
            <button
              className="device-config-choose"
              disabled={busy}
              onClick={() => void chooseAndCheck("json")}
            >
              <FileJson2 />
              {busy
                ? zh
                  ? "正在校验…"
                  : "Validating…"
                : zh
                  ? "检查配置 JSON"
                  : "Check configuration JSON"}
            </button>
            <button
              className="device-config-choose device-tree"
              disabled={busy}
              onClick={() => void chooseAndCheck("deviceTree")}
            >
              <FileCode2 />
              {zh ? "检查 DTS 子集" : "Check DTS subset"}
            </button>
          </div>

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
          <DeviceConfigResult
            report={report}
            adapterReport={adapterReport}
            instances={target.instances}
            selectedInstanceId={selectedInstanceId}
            language={language}
            onLocate={onLocate}
          />
          {(report || adapterReport?.translated) && (
            <div className="device-config-persist">
              <div>
                <strong>
                  {zh
                    ? "保存为工程板级配置"
                    : "Save as project board configuration"}
                </strong>
                <p>
                  {zh
                    ? "工程仅保存规范化配置、文件名和内容哈希，不保存原始本地路径。再次导入会替换该逻辑器件的旧配置，并支持撤销。"
                    : "The project stores normalized configuration, filename, and content hash—not the original path. Reimport replaces this logical device's previous configuration and remains undoable."}
                </p>
              </div>
              <button
                className="device-config-save"
                disabled={!canPersist || busy}
                onClick={() => void saveToProject()}
              >
                {saved ? <CheckCircle2 /> : <Save />}
                {saved
                  ? zh
                    ? "已保存到工程"
                    : "Saved to project"
                  : zh
                    ? "绑定到所选实例"
                    : "Bind to selected instance"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
