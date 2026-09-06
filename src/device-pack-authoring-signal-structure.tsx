import { Plus, Trash2 } from "lucide-react";
import {
  addDifferentialPair,
  addSymbolUnit,
  removeDifferentialPair,
  removeSymbolUnit,
  updateDifferentialPair,
  updateSymbolUnit,
} from "./device-pack-authoring-advanced-draft";
import type { DevicePack } from "./types";
import { authoredDevice, authoredSymbol } from "./device-pack-authoring-scope";
import "./device-pack-authoring-advanced.css";

type Props = {
  pack: DevicePack;
  deviceId: string;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringSignalStructure({
  pack,
  deviceId,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  const device = authoredDevice(pack, deviceId);
  const symbol = authoredSymbol(pack, deviceId);

  return (
    <div className="pack-author-advanced">
      <div className="pack-author-heading">
        <small>SYMBOL UNITS & SIGNAL INTEGRITY METADATA</small>
        <h3>
          {zh ? "符号单元与差分对" : "Symbol units and differential pairs"}
        </h3>
        <p>
          {zh
            ? "单元按引脚分组显示；差分对只提供 L2 ERC 与未来 L4 后端所需的极性元数据。"
            : "Units display selected pin groups. Differential pairs provide polarity metadata for L2 ERC and future L4 backends."}
        </p>
      </div>

      <div className="pack-author-subheading">
        <strong>{zh ? "多单元符号" : "Multi-unit symbol"}</strong>
        <button onClick={() => onChange(addSymbolUnit(pack, deviceId))}>
          <Plus />
          {zh ? "添加单元" : "Add unit"}
        </button>
      </div>
      <div className="pack-author-advanced-list unit-list">
        {symbol.units.map((unit) => (
          <div key={unit.id}>
            <input
              value={unit.id}
              onChange={(event) =>
                onChange(
                  updateSymbolUnit(
                    pack,
                    unit.id,
                    { id: event.target.value },
                    deviceId,
                  ),
                )
              }
              aria-label="Unit ID"
            />
            <input
              value={unit.name}
              onChange={(event) =>
                onChange(
                  updateSymbolUnit(
                    pack,
                    unit.id,
                    { name: event.target.value },
                    deviceId,
                  ),
                )
              }
              aria-label="Unit name"
            />
            <input
              value={unit.groups.join(", ")}
              onChange={(event) =>
                onChange(
                  updateSymbolUnit(
                    pack,
                    unit.id,
                    {
                      groups: splitList(event.target.value),
                    },
                    deviceId,
                  ),
                )
              }
              placeholder={zh ? "POWER, GPIO" : "POWER, GPIO"}
              aria-label="Pin groups"
            />
            <button
              disabled={symbol.units.length <= 1}
              onClick={() =>
                onChange(removeSymbolUnit(pack, unit.id, deviceId))
              }
              aria-label={zh ? "删除符号单元" : "Remove symbol unit"}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>

      <div className="pack-author-subheading">
        <strong>
          {zh ? "差分对与极性" : "Differential pairs and polarity"}
        </strong>
        <button
          disabled={device.pins.length < 2}
          onClick={() => onChange(addDifferentialPair(pack, deviceId))}
        >
          <Plus />
          {zh ? "添加差分对" : "Add pair"}
        </button>
      </div>
      <div className="pack-author-advanced-list differential-list">
        {device.differentialPairs.length === 0 && (
          <p>{zh ? "尚未定义差分对。" : "No differential pair defined."}</p>
        )}
        {device.differentialPairs.map((pair) => (
          <div key={pair.id}>
            <input
              value={pair.id}
              onChange={(event) =>
                onChange(
                  updateDifferentialPair(
                    pack,
                    pair.id,
                    {
                      id: event.target.value,
                    },
                    deviceId,
                  ),
                )
              }
              aria-label="Differential pair ID"
            />
            <label>
              <span>P+</span>
              <select
                value={pair.positivePinId}
                onChange={(event) =>
                  onChange(
                    updateDifferentialPair(
                      pack,
                      pair.id,
                      {
                        positivePinId: event.target.value,
                      },
                      deviceId,
                    ),
                  )
                }
              >
                {device.pins.map((pin) => (
                  <option key={pin.id} value={pin.id}>
                    {pin.number} · {pin.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>N−</span>
              <select
                value={pair.negativePinId}
                onChange={(event) =>
                  onChange(
                    updateDifferentialPair(
                      pack,
                      pair.id,
                      {
                        negativePinId: event.target.value,
                      },
                      deviceId,
                    ),
                  )
                }
              >
                {device.pins.map((pin) => (
                  <option key={pin.id} value={pin.id}>
                    {pin.number} · {pin.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                onChange(removeDifferentialPair(pack, pair.id, deviceId))
              }
              aria-label={zh ? "删除差分对" : "Remove differential pair"}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
