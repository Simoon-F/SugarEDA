import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileKey2,
  KeyRound,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { api, isDesktop } from "./bridge";
import type { DevicePackSignatureReport, TrustedDevicePackKey } from "./types";
import "./device-pack-signature-inspector.css";

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
  const [trustedKeys, setTrustedKeys] = useState<TrustedDevicePackKey[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible || !isDesktop()) return;
    api
      .listTrustedDevicePackKeys()
      .then(setTrustedKeys)
      .catch((reason) => setError(String(reason)));
  }, [visible]);

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
  const trustCurrentKey = async () => {
    try {
      setError("");
      setTrustedKeys(
        await api.trustDevicePackSignatureKey(packPath, signaturePath),
      );
      setReport(await api.inspectDevicePackSignature(packPath, signaturePath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const removeTrustedKey = async (fingerprint: string) => {
    try {
      setError("");
      setTrustedKeys(await api.removeTrustedDevicePackKey(fingerprint));
      if (packPath && signaturePath) {
        setReport(
          await api.inspectDevicePackSignature(packPath, signaturePath),
        );
      }
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
                report.trustedIdentity
                  ? "signature-result valid"
                  : report.verified
                    ? "signature-result verified"
                    : "signature-result invalid"
              }
            >
              {report.trustedIdentity ? (
                <CheckCircle2 />
              ) : report.verified ? (
                <ShieldQuestion />
              ) : (
                <AlertTriangle />
              )}
              <span>
                <code>{report.code}</code>
                <b>{report.signer}</b>
                <p>{zh ? report.messageZh : report.messageEn}</p>
                <small>
                  {report.keyId} · {report.publicKeyFingerprint}
                </small>
                {report.verified && !report.trustedIdentity && (
                  <button
                    className="signature-trust-action"
                    onClick={() => void trustCurrentKey()}
                  >
                    <KeyRound />
                    {zh ? "信任此发布密钥" : "Trust this publisher key"}
                  </button>
                )}
              </span>
            </div>
          )}
          <section className="trusted-key-list">
            <div className="trusted-key-list-title">
              <span>
                <KeyRound />
                {zh ? "本地可信密钥" : "Locally trusted keys"}
              </span>
              <small>{trustedKeys.length}</small>
            </div>
            {trustedKeys.length === 0 ? (
              <p>
                {zh
                  ? "尚未信任任何发布密钥。"
                  : "No publisher key is trusted yet."}
              </p>
            ) : (
              trustedKeys.map((key) => (
                <div key={key.fingerprint}>
                  <span>
                    <b>{key.signer}</b>
                    <code>
                      {key.keyId} · {key.fingerprint.slice(0, 16)}…
                    </code>
                  </span>
                  <button
                    onClick={() => void removeTrustedKey(key.fingerprint)}
                    aria-label={zh ? "撤销信任" : "Remove trust"}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))
            )}
          </section>
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
