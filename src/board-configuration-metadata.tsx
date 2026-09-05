import { BadgeInfo } from "lucide-react";
import type { DeviceConfigurationData } from "./types";

export function BoardConfigurationMetadata({
  draft,
  language,
  onChange,
}: {
  draft: DeviceConfigurationData;
  language: "zh-CN" | "en";
  onChange: (draft: DeviceConfigurationData) => void;
}) {
  const zh = language === "zh-CN";
  return (
    <section className="board-editor-pane metadata-pane">
      <div className="board-editor-pane-heading">
        <div>
          <small>CONFIGURATION IDENTITY</small>
          <h3>{zh ? "配置元数据" : "Configuration metadata"}</h3>
          <p>
            {zh
              ? "来源与许可证随工程保存并参与确定性导出。"
              : "Source and license metadata are embedded in the project and deterministic exports."}
          </p>
        </div>
        <BadgeInfo />
      </div>
      <div className="board-metadata-form">
        <label>
          <span>{zh ? "配置名称" : "Configuration name"}</span>
          <input
            value={draft.name}
            maxLength={256}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label>
          <span>{zh ? "数据来源" : "Source"}</span>
          <textarea
            value={draft.source}
            maxLength={512}
            rows={3}
            onChange={(event) =>
              onChange({ ...draft, source: event.target.value })
            }
          />
        </label>
        <label>
          <span>{zh ? "许可证标识" : "License identifier"}</span>
          <input
            value={draft.license}
            maxLength={512}
            onChange={(event) =>
              onChange({ ...draft, license: event.target.value })
            }
          />
        </label>
      </div>
      <dl className="board-target-lock">
        <div>
          <dt>{zh ? "器件包" : "DevicePack"}</dt>
          <dd>
            {draft.target.packId} · {draft.target.packVersion}
          </dd>
        </div>
        <div>
          <dt>{zh ? "器件 / 变体" : "Device / variant"}</dt>
          <dd>
            {draft.target.deviceId} · {draft.target.variantId ?? "default"}
          </dd>
        </div>
        <div>
          <dt>{zh ? "格式" : "Format"}</dt>
          <dd>Device Configuration IR v{draft.formatVersion}</dd>
        </div>
      </dl>
      <div className="board-editor-safety-note">
        {zh
          ? "目标身份由所选逻辑器件锁定；编辑器不会执行脚本、SDK 或外部文件引用。"
          : "Target identity is locked to the selected logical device. The editor never executes scripts, SDKs, or external references."}
      </div>
    </section>
  );
}
