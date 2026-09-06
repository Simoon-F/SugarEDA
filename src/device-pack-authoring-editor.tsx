import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Activity,
  FileDown,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Network,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import { createDevicePackDraft } from "./device-pack-authoring-draft";
import { DevicePackAuthoringDevice } from "./device-pack-authoring-device";
import { DevicePackAuthoringManifest } from "./device-pack-authoring-manifest";
import { DevicePackAuthoringModels } from "./device-pack-authoring-models";
import { DevicePackAuthoringReview } from "./device-pack-authoring-review";
import { DevicePackAuthoringSignalStructure } from "./device-pack-authoring-signal-structure";
import type { DevicePack, DevicePackAuthoringReport } from "./types";
import "./device-pack-authoring-editor.css";

type Section = "manifest" | "pins" | "signals" | "models" | "review";

export function DevicePackAuthoringEditor({
  open,
  language,
  onClose,
}: {
  open: boolean;
  language: "zh-CN" | "en";
  onClose: () => void;
}) {
  const zh = language === "zh-CN";
  const desktopAvailable = isDesktop();
  const [pack, setPack] = useState<DevicePack>(() => createDevicePackDraft());
  const [section, setSection] = useState<Section>("manifest");
  const [report, setReport] = useState<DevicePackAuthoringReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [exported, setExported] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPack(createDevicePackDraft());
    setSection("manifest");
    setReport(null);
    setMessage("");
    setExported(false);
    setConfirmClose(false);
  }, [open]);

  useEffect(() => {
    if (!open || !desktopAvailable) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setValidating(true);
      api
        .validateDevicePackDraft(pack)
        .then((nextReport) => {
          if (current) setReport(nextReport);
        })
        .catch((error) => {
          if (current) {
            setReport({
              valid: false,
              deviceCount: pack.devices.length,
              pinCount: pack.devices.reduce(
                (total, device) => total + device.pins.length,
                0,
              ),
              issues: [
                {
                  code: "device-pack-authoring.validation-failed",
                  message: String(error),
                },
              ],
            });
          }
        })
        .finally(() => {
          if (current) setValidating(false);
        });
    }, 280);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [desktopAvailable, open, pack]);

  if (!open) return null;

  const changePack = (nextPack: DevicePack) => {
    setPack(nextPack);
    setExported(false);
    setMessage("");
  };

  const requestClose = () => {
    if (exported) onClose();
    else setConfirmClose(true);
  };

  const exportPack = async () => {
    if (!report?.valid || exporting || !desktopAvailable) return;
    const defaultName = `${pack.manifest.id || "device-pack"}-${
      pack.manifest.version || "1.0.0"
    }.devicepack.json`;
    const path = await save({
      title: zh ? "导出器件包" : "Export DevicePack",
      defaultPath: defaultName,
      filters: [
        {
          name: "SugarEDA DevicePack",
          extensions: ["devicepack.json", "sugeda-pack.json", "json"],
        },
      ],
    });
    if (!path) return;

    setExporting(true);
    setMessage("");
    try {
      const receipt = await api.exportDevicePackDraft(pack, path);
      setExported(true);
      setMessage(
        zh
          ? `已安全导出，SHA-256 ${receipt.packSha256.slice(0, 12)}…`
          : `Exported safely, SHA-256 ${receipt.packSha256.slice(0, 12)}…`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="pack-author-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section
        className="pack-author"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "制作器件包" : "Author DevicePack"}
      >
        <header>
          <div className="pack-author-title">
            <span>
              <Cpu />
            </span>
            <div>
              <small>DEVICEPACK AUTHORING WORKBENCH</small>
              <h2>{zh ? "制作器件包" : "Author DevicePack"}</h2>
            </div>
          </div>
          <div className="pack-author-validation">
            {validating ? (
              <LoaderCircle className="spin" />
            ) : report?.valid ? (
              <CheckCircle2 />
            ) : (
              <AlertTriangle />
            )}
            <span>
              <b>
                {!desktopAvailable
                  ? zh
                    ? "桌面后端待连接"
                    : "Desktop backend required"
                  : validating
                    ? zh
                      ? "校验中"
                      : "Validating"
                    : report?.valid
                      ? zh
                        ? "Rust 校验通过"
                        : "Rust validation passed"
                      : zh
                        ? "草稿待修正"
                        : "Draft needs attention"}
              </b>
              <small>
                {report?.packSha256?.slice(0, 12) ?? "AUTHORITATIVE BACKEND"}
              </small>
            </span>
          </div>
          <button onClick={requestClose} aria-label={zh ? "关闭" : "Close"}>
            <X />
          </button>
        </header>

        <nav
          className="pack-author-tabs"
          aria-label={zh ? "编辑步骤" : "Editing steps"}
        >
          <button
            className={section === "manifest" ? "active" : ""}
            onClick={() => setSection("manifest")}
          >
            <ShieldCheck />
            <span>01</span>
            {zh ? "来源与身份" : "Identity"}
          </button>
          <button
            className={section === "pins" ? "active" : ""}
            onClick={() => setSection("pins")}
          >
            <Cpu />
            <span>02</span>
            {zh ? "器件与引脚" : "Device & pins"}
          </button>
          <button
            className={section === "signals" ? "active" : ""}
            onClick={() => setSection("signals")}
          >
            <Network />
            <span>03</span>
            {zh ? "单元与差分" : "Units & pairs"}
          </button>
          <button
            className={section === "models" ? "active" : ""}
            onClick={() => setSection("models")}
          >
            <Activity />
            <span>04</span>
            {zh ? "模型与资料" : "Models & docs"}
          </button>
          <button
            className={section === "review" ? "active" : ""}
            onClick={() => setSection("review")}
          >
            <FileText />
            <span>05</span>
            {zh ? "校验与预览" : "Review"}
          </button>
        </nav>

        <main>
          {section === "manifest" && (
            <DevicePackAuthoringManifest
              pack={pack}
              language={language}
              onChange={(patch) =>
                changePack({
                  ...pack,
                  manifest: { ...pack.manifest, ...patch },
                })
              }
            />
          )}
          {section === "pins" && (
            <DevicePackAuthoringDevice
              pack={pack}
              language={language}
              onChange={changePack}
            />
          )}
          {section === "signals" && (
            <DevicePackAuthoringSignalStructure
              pack={pack}
              language={language}
              onChange={changePack}
            />
          )}
          {section === "models" && (
            <DevicePackAuthoringModels
              pack={pack}
              language={language}
              onChange={changePack}
            />
          )}
          {section === "review" && (
            <DevicePackAuthoringReview
              pack={pack}
              report={report}
              language={language}
            />
          )}
        </main>

        <footer>
          <span className={report?.valid ? "valid" : ""}>
            {message ||
              report?.issues[0]?.message ||
              `${report?.deviceCount ?? pack.devices.length} DEV · ${
                report?.pinCount ??
                pack.devices.reduce(
                  (total, current) => total + current.pins.length,
                  0,
                )
              } PIN`}
          </span>
          <button className="secondary" onClick={() => setSection("review")}>
            <FileText />
            {zh ? "查看校验" : "Review validation"}
          </button>
          <button
            onClick={exportPack}
            disabled={!report?.valid || exporting || !desktopAvailable}
          >
            {exporting ? <LoaderCircle className="spin" /> : <FileDown />}
            {zh ? "校验并导出" : "Validate & export"}
          </button>
        </footer>

        {confirmClose && (
          <div className="pack-author-confirm">
            <div>
              <AlertTriangle />
              <div>
                <h3>
                  {zh ? "放弃未导出的草稿？" : "Discard unexported draft?"}
                </h3>
                <p>
                  {zh
                    ? "草稿尚未写入磁盘，关闭后无法恢复。"
                    : "The draft has not been written to disk and cannot be recovered after closing."}
                </p>
              </div>
              <button onClick={() => setConfirmClose(false)}>
                {zh ? "继续编辑" : "Keep editing"}
              </button>
              <button className="danger" onClick={onClose}>
                {zh ? "放弃草稿" : "Discard draft"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
