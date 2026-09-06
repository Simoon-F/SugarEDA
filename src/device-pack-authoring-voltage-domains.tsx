import { Plus, Trash2 } from "lucide-react";
import {
  addVoltageDomain,
  removeVoltageDomain,
  updateVoltageDomain,
} from "./device-pack-authoring-draft";
import type { DevicePack } from "./types";
import { authoredDevice } from "./device-pack-authoring-scope";

type Props = {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringVoltageDomains({
  pack,
  deviceId,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const domains = authoredDevice(pack, deviceId).voltageDomains;

  return (
    <>
      <div className="pack-author-subheading">
        <strong>{zh ? "电压域" : "Voltage domains"}</strong>
        <button onClick={() => onChange(addVoltageDomain(pack, deviceId))}>
          <Plus />
          {zh ? "添加电压域" : "Add domain"}
        </button>
      </div>
      <div className="pack-author-domains">
        {domains.map((domain) => (
          <div key={domain.id}>
            <input
              value={domain.id}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(
                    pack,
                    domain.id,
                    {
                      id: event.target.value,
                    },
                    deviceId,
                  ),
                )
              }
              aria-label="Domain ID"
            />
            <input
              value={domain.name}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(
                    pack,
                    domain.id,
                    {
                      name: event.target.value,
                    },
                    deviceId,
                  ),
                )
              }
              aria-label="Domain name"
            />
            <input
              type="number"
              value={domain.minVoltage}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(
                    pack,
                    domain.id,
                    {
                      minVoltage: Number(event.target.value),
                    },
                    deviceId,
                  ),
                )
              }
              aria-label="Minimum voltage"
            />
            <input
              type="number"
              value={domain.maxVoltage}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(
                    pack,
                    domain.id,
                    {
                      maxVoltage: Number(event.target.value),
                    },
                    deviceId,
                  ),
                )
              }
              aria-label="Maximum voltage"
            />
            <button
              onClick={() =>
                onChange(removeVoltageDomain(pack, domain.id, deviceId))
              }
              aria-label={zh ? "删除电压域" : "Remove voltage domain"}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
