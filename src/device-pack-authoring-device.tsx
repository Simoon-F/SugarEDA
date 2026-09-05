import { updatePrimaryDevice } from "./device-pack-authoring-draft";
import { DevicePackAuthoringPinTable } from "./device-pack-authoring-pin-table";
import { DevicePackAuthoringVoltageDomains } from "./device-pack-authoring-voltage-domains";
import type { DevicePack } from "./types";

type Props = {
  pack: DevicePack;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringDevice({ pack, language, onChange }: Props) {
  const zh = language === "zh-CN";
  const device = pack.devices[0];

  return (
    <div className="pack-author-device">
      <div className="pack-author-heading">
        <small>PRIMARY DEVICE · L1/L2/L5 FOUNDATION</small>
        <h3>
          {zh ? "器件、引脚与电源域" : "Device, pins, and voltage domains"}
        </h3>
      </div>
      <div className="pack-author-fields three-column compact">
        <label>
          <span>Device ID</span>
          <input
            value={device.id}
            onChange={(event) =>
              onChange(updatePrimaryDevice(pack, { id: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{zh ? "器件名称" : "Device name"}</span>
          <input
            value={device.name}
            onChange={(event) =>
              onChange(updatePrimaryDevice(pack, { name: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{zh ? "器件类型" : "Device type"}</span>
          <input
            value={device.deviceType}
            onChange={(event) =>
              onChange(
                updatePrimaryDevice(pack, { deviceType: event.target.value }),
              )
            }
          />
        </label>
      </div>
      <DevicePackAuthoringVoltageDomains
        pack={pack}
        language={language}
        onChange={onChange}
      />
      <DevicePackAuthoringPinTable
        pack={pack}
        language={language}
        onChange={onChange}
      />
    </div>
  );
}
