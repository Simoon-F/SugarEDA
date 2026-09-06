import { Cpu, Plus, Trash2 } from "lucide-react";
import type { DevicePack } from "./types";
import "./device-pack-authoring-collection.css";

export function DevicePackAuthoringDeviceSwitcher({
  pack,
  activeDeviceId,
  language,
  onSelect,
  onAdd,
  onRemove,
}: {
  pack: DevicePack;
  activeDeviceId: string;
  language: "zh-CN" | "en";
  onSelect: (deviceId: string) => void;
  onAdd: () => void;
  onRemove: (deviceId: string) => void;
}) {
  const zh = language === "zh-CN";
  return (
    <div className="pack-device-switcher">
      <span className="pack-device-switcher-label">
        <Cpu /> {zh ? "包内器件" : "Pack devices"}
      </span>
      <div className="pack-device-switcher-items">
        {pack.devices.map((device, index) => (
          <div
            key={device.id}
            className={device.id === activeDeviceId ? "active" : ""}
          >
            <button onClick={() => onSelect(device.id)}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <span>{device.name || device.id}</span>
            </button>
            {device.id === activeDeviceId && pack.devices.length > 1 && (
              <button
                className="remove"
                aria-label={zh ? "删除当前器件" : "Remove current device"}
                onClick={() => onRemove(device.id)}
              >
                <Trash2 />
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="pack-device-add" onClick={onAdd}>
        <Plus /> {zh ? "添加器件" : "Add device"}
      </button>
    </div>
  );
}
