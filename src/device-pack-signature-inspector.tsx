import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileKey2,
  ShieldQuestion,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import type { DevicePackSignatureReport } from "./types";

export function DevicePackSignatureInspector({
  open: visible,
  language,
  onClose,
}: {
  open: boolean;
  language: "zh-CN" | "en";
  onClose: () => void;
}) {
  const zh = language === "zh-CN";
  const [packPath, setPackPath] = useState("");
  const [signaturePath, setSignaturePath] = useState("");
  const [report, setReport] = useState<DevicePackSignatureReport | null>(null);
  const [error, setError] = useState("");
  if (!visible) return null;
  const choose = async (kind: "pack" | "signature") => {
    if (!isDesktop()) return;
    const path = await open({
      multiple: false,
      filters: [
        {
          name:
            kind === "pack"
              ? "SugarEDA DevicePack"
              : "Detached DevicePack signature",
          extensions: ["json"],
        },
      ],
    });
    if (typeof path !== "string") return;
    if (kind === "pack") setPackPath(path);
    else setSignaturePath(path);
    setReport(null);
    setError("");
  };
  const inspect = async () => {
    try {
      setError("");
      setReport(await api.inspectDevicePackSignature(packPath, signaturePath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <div
      className="pack-signature-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section
        className="pack-signature-dialog"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <ShieldQuestion />
            <span>
              <small>DETACHED ED25519</small>
              <h2>{zh ? "验证器件包签名" : "Verify DevicePack signature"}</h2>
            </span>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <main>
          <p>
            {zh
              ? "签名验证只证明所选公钥签署了相同内容；未知公钥不会被标记为可信厂商。"
              : "Verification proves that the selected key signed the same content. An unknown key is never labeled as a trusted vendor."}
          </p>
          <button onClick={() => void choose("pack")}>
            <FileKey2 />
            {packPath.split(/[\\/]/).pop() ||
              (zh ? "选择器件包" : "Choose DevicePack")}
          </button>
          <button onClick={() => void choose("signature")}>
            <FileKey2 />
            {signaturePath.split(/[\\/]/).pop() ||
              (zh
                ? "选择 .devicepack.sig.json"
                : "Choose .devicepack.sig.json")}
          </button>
          {error && (
            <div className="signature-result invalid">
              <AlertTriangle />
              {error}
            </div>
          )}
          {report && (
            <div
              className={
                report.verified
                  ? "signature-result valid"
                  : "signature-result invalid"
              }
            >
              {report.verified ? <CheckCircle2 /> : <AlertTriangle />}
              <span>
                <code>{report.code}</code>
                <b>{report.signer}</b>
                <p>{zh ? report.messageZh : report.messageEn}</p>
                <small>
                  {report.keyId} · {report.packSha256}
                </small>
              </span>
            </div>
          )}
        </main>
        <footer>
          <button className="secondary" onClick={onClose}>
            {zh ? "关闭" : "Close"}
          </button>
          <button
            disabled={!packPath || !signaturePath}
            onClick={() => void inspect()}
          >
            {zh ? "验证签名" : "Verify signature"}
          </button>
        </footer>
      </section>
    </div>
  );
}
