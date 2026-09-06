import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import { authoredDevice } from "./device-pack-authoring-scope";
import { importDevicePackSpiceModel } from "./device-pack-authoring-advanced-draft";
import type { DevicePack, DevicePackSpiceModelFileReport } from "./types";
import "./device-pack-model-import-dialog.css";

export function DevicePackModelImportDialog({
  pack,
  deviceId,
  language,
  onChange,
  onClose,
}: {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
  onClose: () => void;
}) {
  const zh = language === "zh-CN";
  const device = authoredDevice(pack, deviceId);
  const [report, setReport] = useState<DevicePackSpiceModelFileReport | null>(
    null,
  );
  const [definitionName, setDefinitionName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const definition = report?.definitions.find(
    (item) => item.name === definitionName,
  );

  useEffect(() => {
    if (!definition) return;
    setMapping(
      Object.fromEntries(
        definition.pins.map((port, index) => [
          port,
          device.pins[index]?.id ?? "",
        ]),
      ),
    );
  }, [definition, device.pins]);

  const selectFile = async () => {
    const path = await open({
      multiple: false,
      filters: [
        {
          name: "Self-contained SPICE",
          extensions: ["lib", "cir", "mod", "model", "spice"],
        },
      ],
    });
    if (typeof path !== "string") return;
    setLoading(true);
    setError("");
    try {
      const next = await api.inspectDevicePackSpiceModelFile(path);
      setReport(next);
      setDefinitionName(next.definitions[0]?.name ?? "");
    } catch (reason) {
      setReport(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };
  const pinIds = definition?.pins.map((port) => mapping[port] ?? "") ?? [];
  const mappingValid =
    Boolean(definition) &&
    pinIds.every(Boolean) &&
    new Set(pinIds).size === pinIds.length;
  const apply = () => {
    if (!report || !definition || !mappingValid) return;
    onChange(
      importDevicePackSpiceModel(
        pack,
        deviceId,
        report,
        definition.name,
        definition.pins.map((modelPort) => ({
          modelPort,
          pinId: mapping[modelPort],
        })),
      ),
    );
    onClose();
  };

  return (
    <div className="pack-model-import-backdrop">
      <section className="pack-model-import" role="dialog" aria-modal="true">
        <header>
          <div>
            <FileUp />
            <span>
              <small>RESTRICTED L3 IMPORT</small>
              <h3>{zh ? "导入 SPICE 模型" : "Import SPICE model"}</h3>
            </span>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <main>
          <p>
            {zh
              ? "仅接受 2 MiB 内的自包含文本。Rust 会拒绝 .include、外部文件、脚本和不受支持的指令；原始路径不会写入器件包。"
              : "Only self-contained text up to 2 MiB is accepted. Rust rejects .include, external files, scripts, and unsupported directives; the source path is never stored."}
          </p>
          <button
            className="model-import-file"
            disabled={!isDesktop() || loading}
            onClick={() => void selectFile()}
          >
            {loading ? <LoaderCircle className="spin" /> : <FileUp />}
            {report?.sourceFileName ??
              (zh ? "选择模型文件" : "Choose model file")}
          </button>
          {error && (
            <div className="model-import-error">
              <AlertTriangle />
              {error}
            </div>
          )}
          {report && (
            <>
              <div className="model-import-proof">
                <CheckCircle2 />
                <span>
                  <b>{report.sourceFileName}</b>
                  <small>
                    {report.bytes} BYTES · SHA-256 {report.sha256.slice(0, 16)}…
                  </small>
                </span>
              </div>
              <label className="model-import-definition">
                <span>{zh ? "导出定义" : "Exported definition"}</span>
                <select
                  value={definitionName}
                  onChange={(event) => setDefinitionName(event.target.value)}
                >
                  {report.definitions.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} · {item.kind} · {item.pins.length} pins
                    </option>
                  ))}
                </select>
              </label>
              <div className="model-import-map">
                <small>
                  {zh
                    ? "模型端口 → 当前器件引脚"
                    : "Model port → current device pin"}
                </small>
                {definition?.pins.map((port) => (
                  <label key={port}>
                    <code>{port}</code>
                    <select
                      value={mapping[port] ?? ""}
                      onChange={(event) =>
                        setMapping({ ...mapping, [port]: event.target.value })
                      }
                    >
                      <option value="">—</option>
                      {device.pins.map((pin) => (
                        <option key={pin.id} value={pin.id}>
                          {pin.number} · {pin.name} ({pin.id})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {!mappingValid && (
                <small className="model-import-warning">
                  {zh
                    ? "每个模型端口必须映射到不同的逻辑引脚。"
                    : "Every model port must map to a distinct logical pin."}
                </small>
              )}
            </>
          )}
        </main>
        <footer>
          <button className="secondary" onClick={onClose}>
            {zh ? "取消" : "Cancel"}
          </button>
          <button disabled={!mappingValid} onClick={apply}>
            {zh ? "内嵌并绑定" : "Embed & bind"}
          </button>
        </footer>
      </section>
    </div>
  );
}
