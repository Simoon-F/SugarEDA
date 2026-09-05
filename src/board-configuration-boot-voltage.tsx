import { Gauge, Power, ToggleLeft } from "lucide-react";
import type { DeviceConfigurationData, DevicePack } from "./types";

const strapValues: DeviceConfigurationData["bootStraps"][number]["value"][] = [
  "low",
  "high",
  "pullDown",
  "pullUp",
  "external",
];

export function BoardConfigurationBootVoltage({
  device,
  draft,
  issuePinIds,
  issueDomainIds,
  language,
  onBootStrap,
  onVoltage,
}: {
  device: DevicePack["devices"][number];
  draft: DeviceConfigurationData;
  issuePinIds: Set<string>;
  issueDomainIds: Set<string>;
  language: "zh-CN" | "en";
  onBootStrap: (
    pinId: string,
    value: DeviceConfigurationData["bootStraps"][number]["value"] | "",
  ) => void;
  onVoltage: (domainId: string, voltage: number | null) => void;
}) {
  const zh = language === "zh-CN";
  const pins = new Map(device.pins.map((pin) => [pin.id, pin]));
  const bootPins = [
    ...new Set(
      device.rules
        .filter((rule) => rule.kind === "bootConfiguration")
        .flatMap((rule) => rule.pinIds),
    ),
  ];
  const straps = new Map(
    draft.bootStraps.map((strap) => [strap.pinId, strap.value]),
  );
  const voltages = new Map(
    draft.voltageSelections.map((selection) => [
      selection.domainId,
      selection.voltage,
    ]),
  );

  return (
    <section className="board-editor-pane electrical-pane">
      <div className="board-editor-pane-heading">
        <div>
          <small>BOOT & POWER DOMAINS</small>
          <h3>{zh ? "启动绑带与电压域" : "Boot straps and voltage domains"}</h3>
          <p>
            {zh
              ? "配置必需的启动状态，并在器件包允许范围内选择电源域电压。"
              : "Set required boot states and select voltages within DevicePack ranges."}
          </p>
        </div>
        <Gauge />
      </div>
      <div className="electrical-section-title">
        <ToggleLeft />
        <div>
          <strong>{zh ? "启动绑带" : "Boot straps"}</strong>
          <small>{bootPins.length}</small>
        </div>
      </div>
      <div className="strap-grid">
        {bootPins.map((pinId) => {
          const pin = pins.get(pinId);
          return (
            <label
              className={
                issuePinIds.has(pinId) ? "strap-card invalid" : "strap-card"
              }
              key={pinId}
            >
              <span>
                <b>{pin?.name ?? pinId}</b>
                <code>
                  {pin?.number ?? "—"} · {pinId}
                </code>
              </span>
              <select
                value={straps.get(pinId) ?? ""}
                onChange={(event) =>
                  onBootStrap(
                    pinId,
                    event.target.value as
                      | DeviceConfigurationData["bootStraps"][number]["value"]
                      | "",
                  )
                }
              >
                <option value="">{zh ? "未定义" : "Undefined"}</option>
                {strapValues.map((value) => (
                  <option value={value} key={value}>
                    {strapLabel(value, zh)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {!bootPins.length && (
          <p className="electrical-empty">
            {zh
              ? "器件包未声明启动绑带"
              : "No boot straps declared by this pack"}
          </p>
        )}
      </div>
      <div className="electrical-section-title voltage-title">
        <Power />
        <div>
          <strong>{zh ? "电压域" : "Voltage domains"}</strong>
          <small>{device.voltageDomains.length}</small>
        </div>
      </div>
      <div className="voltage-grid">
        {device.voltageDomains.map((domain) => {
          const value = voltages.get(domain.id);
          const nominal = Number(
            ((domain.minVoltage + domain.maxVoltage) / 2).toFixed(3),
          );
          return (
            <div
              className={
                issueDomainIds.has(domain.id)
                  ? "voltage-card invalid"
                  : "voltage-card"
              }
              key={domain.id}
            >
              <div>
                <span>
                  <b>{domain.name}</b>
                  <code>{domain.id}</code>
                </span>
                <em>
                  {domain.minVoltage}–{domain.maxVoltage} V
                </em>
              </div>
              <label>
                <input
                  type="number"
                  min={domain.minVoltage}
                  max={domain.maxVoltage}
                  step="0.01"
                  value={value ?? ""}
                  placeholder={String(nominal)}
                  onChange={(event) =>
                    onVoltage(
                      domain.id,
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
                <span>V</span>
              </label>
              <div className="voltage-presets">
                {[domain.minVoltage, nominal, domain.maxVoltage].map(
                  (preset) => (
                    <button
                      key={preset}
                      className={value === preset ? "active" : ""}
                      onClick={() => onVoltage(domain.id, preset)}
                    >
                      {preset} V
                    </button>
                  ),
                )}
                <button onClick={() => onVoltage(domain.id, null)}>
                  {zh ? "清除" : "Clear"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function strapLabel(
  value: DeviceConfigurationData["bootStraps"][number]["value"],
  zh: boolean,
) {
  const labels = {
    low: zh ? "低电平" : "Low",
    high: zh ? "高电平" : "High",
    pullDown: zh ? "下拉" : "Pull-down",
    pullUp: zh ? "上拉" : "Pull-up",
    external: zh ? "外部定义" : "External",
  };
  return labels[value];
}
