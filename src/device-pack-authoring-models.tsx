import { Activity, Plus } from "lucide-react";
import { addDeviceModel } from "./device-pack-authoring-advanced-draft";
import { DevicePackAuthoringDocuments } from "./device-pack-authoring-documents";
import { DevicePackAuthoringModelCard } from "./device-pack-authoring-model-card";
import type { DevicePack } from "./types";
import "./device-pack-authoring-advanced.css";

type Props = {
  pack: DevicePack;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringModels({ pack, language, onChange }: Props) {
  const zh = language === "zh-CN";
  return (
    <div className="pack-author-models">
      <div className="pack-author-heading">
        <small>L3 MODEL BINDING · L4 METADATA</small>
        <h3>{zh ? "模型能力与来源资料" : "Model capabilities and sources"}</h3>
        <p>
          {zh
            ? "SPICE 内容必须自包含并通过安全解析；IBIS/S 参数仅登记元数据。"
            : "SPICE content must be self-contained and pass safe parsing. IBIS/S-parameter entries are metadata only."}
        </p>
      </div>
      <div className="pack-model-additions">
        <button onClick={() => onChange(addDeviceModel(pack, "spice"))}>
          <Plus /> SPICE · L3
        </button>
        <button onClick={() => onChange(addDeviceModel(pack, "ibis"))}>
          <Plus /> IBIS · L4 META
        </button>
        <button onClick={() => onChange(addDeviceModel(pack, "sParameter"))}>
          <Plus /> S-PARAM · L4 META
        </button>
        <span>
          <Activity />
          {pack.models.length} {zh ? "个模型条目" : "model entries"}
        </span>
      </div>
      <div className="pack-author-model-list">
        {pack.models.map((model) => (
          <DevicePackAuthoringModelCard
            key={model.id}
            pack={pack}
            model={model}
            language={language}
            onChange={onChange}
          />
        ))}
      </div>
      <DevicePackAuthoringDocuments
        pack={pack}
        language={language}
        onChange={onChange}
      />
    </div>
  );
}
