import { Box } from "lucide-react";
import { updateAuthoredPackage } from "./device-pack-authoring-collection-draft";
import { authoredDevice } from "./device-pack-authoring-scope";
import type { DevicePack } from "./types";

export function DevicePackAuthoringPackage({
  pack,
  deviceId,
  language,
  onChange,
}: {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
}) {
  const zh = language === "zh-CN";
  const device = authoredDevice(pack, deviceId);
  const footprint = pack.packages.find((item) => item.id === device.packageId);
  if (!footprint) return null;
  return (
    <section className="pack-author-package">
      <div>
        <Box />
        <span>
          <b>{zh ? "封装映射" : "Package mapping"}</b>
          <small>
            {footprint.pads.length} PADS · {device.packageId}
          </small>
        </span>
      </div>
      <label>
        <span>Package ID</span>
        <input
          value={footprint.id}
          onChange={(event) =>
            onChange(
              updateAuthoredPackage(pack, deviceId, { id: event.target.value }),
            )
          }
        />
      </label>
      <label>
        <span>{zh ? "封装名称" : "Package name"}</span>
        <input
          value={footprint.name}
          onChange={(event) =>
            onChange(
              updateAuthoredPackage(pack, deviceId, {
                name: event.target.value,
              }),
            )
          }
        />
      </label>
      <label>
        <span>{zh ? "封装类型" : "Package kind"}</span>
        <input
          value={footprint.kind}
          onChange={(event) =>
            onChange(
              updateAuthoredPackage(pack, deviceId, {
                kind: event.target.value,
              }),
            )
          }
        />
      </label>
    </section>
  );
}
