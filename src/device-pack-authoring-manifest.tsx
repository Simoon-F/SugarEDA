import type { DevicePack } from "./types";

export function DevicePackAuthoringManifest({
  pack,
  language,
  onChange,
}: {
  pack: DevicePack;
  language: "zh-CN" | "en";
  onChange: (patch: Partial<DevicePack["manifest"]>) => void;
}) {
  const zh = language === "zh-CN";
  return (
    <div className="pack-author-form">
      <div className="pack-author-heading">
        <small>PROVENANCE & IDENTITY</small>
        <h3>{zh ? "器件包清单" : "DevicePack manifest"}</h3>
        <p>
          {zh
            ? "许可证与来源不能为空；它们描述数据权利，不代表密码学身份可信。"
            : "License and source are required. They describe data rights, not cryptographic identity trust."}
        </p>
      </div>
      <div className="pack-author-fields two-column">
        <label>
          <span>Pack ID</span>
          <input
            value={pack.manifest.id}
            onChange={(event) => onChange({ id: event.target.value })}
          />
        </label>
        <label>
          <span>{zh ? "版本" : "Version"}</span>
          <input
            value={pack.manifest.version}
            onChange={(event) => onChange({ version: event.target.value })}
          />
        </label>
        <label>
          <span>{zh ? "名称" : "Name"}</span>
          <input
            value={pack.manifest.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label>
          <span>{zh ? "厂商 / 作者" : "Vendor / author"}</span>
          <input
            value={pack.manifest.vendor}
            onChange={(event) => onChange({ vendor: event.target.value })}
          />
        </label>
        <label>
          <span>{zh ? "许可证" : "License"}</span>
          <input
            value={pack.manifest.license}
            onChange={(event) => onChange({ license: event.target.value })}
          />
        </label>
        <label>
          <span>{zh ? "数据来源" : "Source"}</span>
          <input
            value={pack.manifest.source}
            onChange={(event) => onChange({ source: event.target.value })}
          />
        </label>
        <label className="wide">
          <span>{zh ? "说明" : "Description"}</span>
          <textarea
            rows={4}
            value={pack.manifest.description ?? ""}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
