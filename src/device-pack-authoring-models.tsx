import { useState } from "react";
import { Activity, FileUp, Plus } from "lucide-react";
import { addDeviceModel } from "./device-pack-authoring-advanced-draft";
import { DevicePackAuthoringDocuments } from "./device-pack-authoring-documents";
import { DevicePackAuthoringModelCard } from "./device-pack-authoring-model-card";
import type { DevicePack } from "./types";
import { authoredDevice } from "./device-pack-authoring-scope";
import { DevicePackModelImportDialog } from "./device-pack-model-import-dialog";
import { isDesktop } from "./bridge";
import "./device-pack-authoring-advanced.css";

type Props = {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringModels({
  pack,
  deviceId,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const device = authoredDevice(pack, deviceId);
  const models = pack.models.filter((model) =>
    device.modelIds.includes(model.id),
  );
  const [importOpen, setImportOpen] = useState(false);
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
        <button disabled={!isDesktop()} onClick={() => setImportOpen(true)}>
          <FileUp /> {zh ? "导入 SPICE 文件" : "Import SPICE file"}
        </button>
        <button
          onClick={() => onChange(addDeviceModel(pack, "spice", deviceId))}
        >
          <Plus /> SPICE · L3
        </button>
        <button
          onClick={() => onChange(addDeviceModel(pack, "ibis", deviceId))}
        >
          <Plus /> IBIS · L4 META
        </button>
        <button
          onClick={() => onChange(addDeviceModel(pack, "sParameter", deviceId))}
        >
          <Plus /> S-PARAM · L4 META
        </button>
        <span>
          <Activity />
          {models.length} {zh ? "个当前器件模型" : "models for this device"}
        </span>
      </div>
      <div className="pack-author-model-list">
        {models.map((model) => (
          <DevicePackAuthoringModelCard
            key={model.id}
            pack={pack}
            deviceId={deviceId}
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
      {importOpen && (
        <DevicePackModelImportDialog
          pack={pack}
          deviceId={deviceId}
          language={language}
          onChange={onChange}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
