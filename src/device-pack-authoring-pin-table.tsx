import { Plus, Trash2 } from "lucide-react";
import {
  addDevicePackPin,
  removeDevicePackPin,
  setPinAlternateFunctions,
  setPinRule,
  updateDevicePackPin,
} from "./device-pack-authoring-draft";
import type { DevicePack, PinElectricalType } from "./types";
import { authoredDevice } from "./device-pack-authoring-scope";

const electricalTypes: PinElectricalType[] = [
  "passive",
  "input",
  "output",
  "bidirectional",
  "openDrain",
  "openCollector",
  "powerInput",
  "powerOutput",
  "noConnect",
];
const directions = [
  "input",
  "output",
  "bidirectional",
  "passive",
  "power",
  "notConnected",
];

type Props = {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringPinTable({
  pack,
  deviceId,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const device = authoredDevice(pack, deviceId);

  return (
    <>
      <div className="pack-author-subheading">
        <strong>
          {zh ? `引脚 ${device.pins.length}` : `${device.pins.length} pins`}
        </strong>
        <button onClick={() => onChange(addDevicePackPin(pack, deviceId))}>
          <Plus />
          {zh ? "添加引脚" : "Add pin"}
        </button>
      </div>
      <div className="pack-author-pin-head">
        <span>ID / PAD</span>
        <span>{zh ? "名称 / 分组" : "Name / group"}</span>
        <span>{zh ? "电气 / 方向" : "Electrical / direction"}</span>
        <span>{zh ? "电压域 / 复用功能" : "Domain / alternate functions"}</span>
        <span>ERC</span>
        <span />
      </div>
      <div className="pack-author-pins">
        {device.pins.map((pin) => {
          const alternate =
            device.alternateFunctions
              .find((item) => item.pinId === pin.id)
              ?.functions.join(", ") ?? "";
          const hasRule = (kind: string) =>
            device.rules.some(
              (rule) => rule.kind === kind && rule.pinIds.includes(pin.id),
            );

          return (
            <div className="pack-author-pin-row" key={pin.id}>
              <span>
                <input
                  value={pin.id}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          id: event.target.value,
                        },
                        deviceId,
                      ),
                    )
                  }
                />
                <input
                  value={pin.number}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          number: event.target.value,
                        },
                        deviceId,
                      ),
                    )
                  }
                />
              </span>
              <span>
                <input
                  value={pin.name}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          name: event.target.value,
                        },
                        deviceId,
                      ),
                    )
                  }
                />
                <input
                  value={pin.group}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          group: event.target.value,
                        },
                        deviceId,
                      ),
                    )
                  }
                />
              </span>
              <span>
                <select
                  value={pin.electricalType}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          electricalType: event.target
                            .value as PinElectricalType,
                        },
                        deviceId,
                      ),
                    )
                  }
                >
                  {electricalTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <select
                  value={pin.direction}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(
                        pack,
                        pin.id,
                        {
                          direction: event.target.value,
                        },
                        deviceId,
                      ),
                    )
                  }
                >
                  {directions.map((direction) => (
                    <option key={direction}>{direction}</option>
                  ))}
                </select>
              </span>
              <span>
                <select
                  value={pin.voltageDomainId ?? ""}
                  onChange={(event) =>
                    onChange(
                      updateDevicePackPin(pack, pin.id, {
                        voltageDomainId: event.target.value || null,
                      }),
                    )
                  }
                >
                  <option value="">—</option>
                  {device.voltageDomains.map((domain) => (
                    <option key={domain.id}>{domain.id}</option>
                  ))}
                </select>
                <input
                  value={alternate}
                  placeholder="GPIO, UART_TX"
                  onChange={(event) =>
                    onChange(
                      setPinAlternateFunctions(
                        pack,
                        pin.id,
                        event.target.value.split(","),
                        deviceId,
                      ),
                    )
                  }
                />
              </span>
              <span className="pin-rule-checks">
                {(
                  ["required", "allowFloating", "bootConfiguration"] as const
                ).map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={hasRule(kind)}
                      onChange={(event) =>
                        onChange(
                          setPinRule(
                            pack,
                            pin.id,
                            kind,
                            event.target.checked,
                            deviceId,
                          ),
                        )
                      }
                    />
                    {kind === "required"
                      ? "REQ"
                      : kind === "allowFloating"
                        ? "FLOAT"
                        : "BOOT"}
                  </label>
                ))}
              </span>
              <button
                onClick={() =>
                  onChange(removeDevicePackPin(pack, pin.id, deviceId))
                }
                disabled={device.pins.length <= 1}
                aria-label={zh ? "删除引脚" : "Remove pin"}
              >
                <Trash2 />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
