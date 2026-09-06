import { Trash2 } from "lucide-react";
import {
  removeDeviceModel,
  updateDeviceModel,
  updateDeviceModelMetadata,
  updateSpicePort,
} from "./device-pack-authoring-advanced-draft";
import type { DevicePack } from "./types";

type Props = {
  pack: DevicePack;
  model: DevicePack["models"][number];
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringModelCard({
  pack,
  model,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const device = pack.devices[0];
  const binding = (device.spiceBindings ?? []).find(
    (item) => item.modelId === model.id,
  );

  return (
    <article className="pack-author-model-card">
      <header>
        <span className={`model-kind ${model.kind}`}>{model.kind}</span>
        <strong>{model.id}</strong>
        <button
          onClick={() => onChange(removeDeviceModel(pack, model.id))}
          aria-label={zh ? "删除模型" : "Remove model"}
        >
          <Trash2 />
        </button>
      </header>
      <div className="pack-author-model-fields">
        <label>
          <span>Model ID</span>
          <input
            value={model.id}
            onChange={(event) =>
              onChange(
                updateDeviceModel(pack, model.id, { id: event.target.value }),
              )
            }
          />
        </label>
        <label>
          <span>Format</span>
          <input
            value={model.format}
            onChange={(event) =>
              onChange(
                updateDeviceModel(pack, model.id, {
                  format: event.target.value,
                }),
              )
            }
          />
        </label>
        <label>
          <span>{zh ? "用途" : "Purpose"}</span>
          <input
            value={model.metadata.purpose ?? ""}
            onChange={(event) =>
              onChange(
                updateDeviceModelMetadata(
                  pack,
                  model.id,
                  "purpose",
                  event.target.value,
                ),
              )
            }
          />
        </label>
        <label>
          <span>{zh ? "模型许可证" : "Model license"}</span>
          <input
            value={model.metadata.license ?? ""}
            onChange={(event) =>
              onChange(
                updateDeviceModelMetadata(
                  pack,
                  model.id,
                  "license",
                  event.target.value,
                ),
              )
            }
          />
        </label>
      </div>

      {model.kind === "spice" ? (
        <div className="pack-author-spice-editor">
          <label>
            <span>Exported model name</span>
            <input
              value={model.modelName ?? ""}
              onChange={(event) =>
                onChange(
                  updateDeviceModel(pack, model.id, {
                    modelName: event.target.value,
                  }),
                )
              }
            />
          </label>
          <label>
            <span>{zh ? "内嵌 SPICE 文本" : "Embedded SPICE source"}</span>
            <textarea
              rows={8}
              spellCheck={false}
              value={model.embeddedContent ?? ""}
              onChange={(event) =>
                onChange(
                  updateDeviceModel(pack, model.id, {
                    embeddedContent: event.target.value,
                    sha256: null,
                  }),
                )
              }
            />
          </label>
          <div className="spice-port-map">
            <small>{zh ? "端口 → 逻辑引脚" : "Port → logical pin"}</small>
            {binding?.ports.map((port) => {
              const pin = device.pins.find((item) => item.id === port.pinId);
              return (
                <label key={port.pinId}>
                  <input
                    value={port.modelPort}
                    onChange={(event) =>
                      onChange(
                        updateSpicePort(
                          pack,
                          model.id,
                          port.pinId,
                          event.target.value,
                        ),
                      )
                    }
                  />
                  <span>
                    {pin?.number} · {pin?.name} ({port.pinId})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="model-metadata-boundary">
          {zh
            ? "本阶段仅记录模型格式、能力和授权元数据；不会保存外部路径，也不会运行 IBIS/S 参数求解器。"
            : "This release stores format, capability, and licensing metadata only. It stores no external path and runs no IBIS/S-parameter solver."}
        </p>
      )}
    </article>
  );
}
