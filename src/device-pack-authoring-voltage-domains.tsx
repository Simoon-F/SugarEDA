import { Plus, Trash2 } from "lucide-react";
import {
  addVoltageDomain,
  removeVoltageDomain,
  updateVoltageDomain,
} from "./device-pack-authoring-draft";
import type { DevicePack } from "./types";

type Props = {
  pack: DevicePack;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringVoltageDomains({
  pack,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const domains = pack.devices[0].voltageDomains;

  return (
    <>
      <div className="pack-author-subheading">
        <strong>{zh ? "电压域" : "Voltage domains"}</strong>
        <button onClick={() => onChange(addVoltageDomain(pack))}>
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
                  updateVoltageDomain(pack, domain.id, {
                    id: event.target.value,
                  }),
                )
              }
              aria-label="Domain ID"
            />
            <input
              value={domain.name}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(pack, domain.id, {
                    name: event.target.value,
                  }),
                )
              }
              aria-label="Domain name"
            />
            <input
              type="number"
              value={domain.minVoltage}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(pack, domain.id, {
                    minVoltage: Number(event.target.value),
                  }),
                )
              }
              aria-label="Minimum voltage"
            />
            <input
              type="number"
              value={domain.maxVoltage}
              onChange={(event) =>
                onChange(
                  updateVoltageDomain(pack, domain.id, {
                    maxVoltage: Number(event.target.value),
                  }),
                )
              }
              aria-label="Maximum voltage"
            />
            <button
              onClick={() => onChange(removeVoltageDomain(pack, domain.id))}
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
