import { useMemo, useState } from "react";
import {
  Box,
  Check,
  Cpu,
  FileUp,
  FolderSearch,
  ScanSearch,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ComponentPlacement, Project } from "./types";
import { useI18n } from "./i18n";
import { deviceCapabilities } from "./device-pack";
import { DeviceUnitActions } from "./device-unit-actions";
import {
  SdkAdapterInspector,
  type SdkInspectionTarget,
} from "./sdk-adapter-inspector";
import {
  DeviceConfigInspector,
  type DeviceConfigTarget,
} from "./device-config-inspector";
import { deviceConfigurationScope } from "./device-configuration";
import { deviceConfigCanvasInstances } from "./device-config-location";

type Props = {
  open: boolean;
  project: Project;
  onClose: () => void;
  onImport: () => void;
  onPlace: (placement: ComponentPlacement) => void;
  onLocate: (componentId: string) => void;
};

export function DevicePackManager({
  open,
  project,
  onClose,
  onImport,
  onPlace,
  onLocate,
}: Props) {
  const packs = project.devicePacks;
  const { language, t } = useI18n();
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [type, setType] = useState("all");
  const [sdkTarget, setSdkTarget] = useState<SdkInspectionTarget | null>(null);
  const [configTarget, setConfigTarget] = useState<DeviceConfigTarget | null>(
    null,
  );
  const entries = useMemo(
    () =>
      packs.flatMap((pack) =>
        pack.pack.devices.map((device) => ({ pack, device })),
      ),
    [packs],
  );
  const vendors = [
    ...new Set(entries.map(({ pack }) => pack.pack.manifest.vendor)),
  ].sort();
  const types = [
    ...new Set(entries.map(({ device }) => device.deviceType)),
  ].sort();
  const filtered = entries.filter(
    ({ pack, device }) =>
      (vendor === "all" || pack.pack.manifest.vendor === vendor) &&
      (type === "all" || device.deviceType === type) &&
      `${device.name} ${device.id} ${pack.pack.manifest.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!open) return null;
  return (
    <div
      className="pack-manager-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="pack-manager"
        role="dialog"
        aria-modal="true"
        aria-label={t("Device pack manager")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="pack-manager-title">
            <span>
              <Cpu />
            </span>
            <div>
              <h2>{t("Device pack manager")}</h2>
              <p>
                {language === "zh-CN"
                  ? "厂商无关的符号、电气规则与模型能力"
                  : "Vendor-neutral symbols, electrical rules, and model capabilities"}
              </p>
            </div>
          </div>
          <div className="pack-manager-actions">
            <button className="pack-import" onClick={onImport}>
              <FileUp />
              {t("Import device pack")}
            </button>
            <button
              className="pack-close"
              onClick={onClose}
              aria-label={t("Close")}
            >
              <X />
            </button>
          </div>
        </header>
        <div className="pack-filters">
          <label>
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search devices")}
            />
          </label>
          <select
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            aria-label={t("Vendor")}
          >
            <option value="all">{t("All vendors")}</option>
            {vendors.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label={t("Device type")}
          >
            <option value="all">{t("All device types")}</option>
            {types.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="pack-summary">
          <strong>{packs.length}</strong> {t("packs embedded")}
          <span /> <strong>{entries.length}</strong> {t("devices available")}
        </div>
        <div className="pack-list">
          {!filtered.length && (
            <div className="pack-empty">
              <Box />
              <strong>{t("No devices found")}</strong>
              <p>
                {packs.length
                  ? t("Try another search or filter")
                  : t("Import a local self-contained DevicePack to begin")}
              </p>
            </div>
          )}
          {filtered.map(({ pack, device }) => {
            const levels = deviceCapabilities(pack, device.id);
            const deviceModels = pack.pack.models.filter((model) =>
              device.modelIds.includes(model.id),
            );
            const l4Label = [
              deviceModels.some((model) => model.kind === "ibis") ? "IBIS" : "",
              deviceModels.some((model) => model.kind === "sParameter")
                ? "S-param"
                : "",
            ]
              .filter(Boolean)
              .join("/");
            const caps = {
              erc: levels.find((item) => item.level === 2)?.available,
              spice: levels.find((item) => item.level === 3)?.available,
              signalIntegrity: levels.find((item) => item.level === 4)
                ?.available,
              configuration: levels.find((item) => item.level === 5)?.available,
            };
            const symbol = pack.pack.symbols.find(
              (item) => item.id === device.symbolId,
            );
            const units = symbol?.units.length
              ? symbol.units
              : [{ id: "", name: "Main", groups: [] }];
            const sdkAdapters = pack.pack.sdkAdapters.filter((adapter) =>
              device.sdkAdapterIds.includes(adapter.id),
            );
            const configurationScope = deviceConfigurationScope(device);
            const l5Label = [
              configurationScope.available ? "Config" : "",
              sdkAdapters.length > 0 ? "SDK meta" : "",
            ]
              .filter(Boolean)
              .join(" / ");
            return (
              <article
                className="pack-card"
                key={`${pack.sha256}:${device.id}`}
              >
                <div className="pack-card-main">
                  <div className="device-avatar">
                    <Cpu />
                  </div>
                  <div>
                    <div className="device-title">
                      <h3>{device.name}</h3>
                      <code>{device.id}</code>
                    </div>
                    <p>
                      {pack.pack.manifest.vendor} · {device.deviceType} ·{" "}
                      {device.pins.length} {t("pins")}
                    </p>
                    <div className="capability-row">
                      <span className="cap yes">
                        <Check />
                        L1 {t("Schematic")}
                      </span>
                      <span className={caps.erc ? "cap yes" : "cap no"}>
                        {caps.erc && <Check />}L2 ERC
                      </span>
                      <span className={caps.spice ? "cap yes" : "cap no"}>
                        {caps.spice && <Check />}L3 SPICE
                      </span>
                      <span
                        className={caps.signalIntegrity ? "cap meta" : "cap no"}
                      >
                        L4 {l4Label || t("IBIS/S-parameter")}
                      </span>
                      <span
                        className={caps.configuration ? "cap meta" : "cap no"}
                      >
                        L5 {l5Label || "Config"}
                      </span>
                      <span className="cap no">L6 Firmware</span>
                    </div>
                  </div>
                </div>
                <div className="pack-card-meta">
                  <dl>
                    <dt>{t("Pack")}</dt>
                    <dd>{pack.pack.manifest.name}</dd>
                    <dt>{t("Version")}</dt>
                    <dd>{pack.pack.manifest.version}</dd>
                    <dt>{t("License")}</dt>
                    <dd>{pack.pack.manifest.license}</dd>
                    <dt>{t("Source")}</dt>
                    <dd title={pack.pack.manifest.source}>
                      {pack.pack.manifest.source}
                    </dd>
                  </dl>
                  <div className="trust-note">
                    <ShieldCheck />
                    {language === "zh-CN"
                      ? "已验证并嵌入工程"
                      : "Validated and embedded in project"}
                  </div>
                  {(configurationScope.available || sdkAdapters.length > 0) && (
                    <div className="pack-tool-actions">
                      {configurationScope.available && (
                        <button
                          className="pack-tool-button config"
                          onClick={() =>
                            setConfigTarget({
                              packSha256: pack.sha256,
                              packName: pack.pack.manifest.name,
                              deviceId: device.id,
                              deviceName: device.name,
                              alternateFunctionCount:
                                configurationScope.alternateFunctionCount,
                              bootPinCount: configurationScope.bootPinCount,
                              instances: deviceConfigCanvasInstances(
                                project,
                                pack.sha256,
                                device.id,
                              ),
                            })
                          }
                        >
                          <ScanSearch />
                          {language === "zh-CN"
                            ? "检查器件配置"
                            : "Check configuration"}
                        </button>
                      )}
                      {sdkAdapters.length > 0 && (
                        <button
                          className="pack-tool-button sdk"
                          onClick={() =>
                            setSdkTarget({
                              packSha256: pack.sha256,
                              packName: pack.pack.manifest.name,
                              deviceName: device.name,
                              adapters: sdkAdapters,
                            })
                          }
                        >
                          <FolderSearch />
                          {language === "zh-CN"
                            ? "匹配本地 SDK"
                            : "Match local SDK"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <DeviceUnitActions
                  project={project}
                  packSha256={pack.sha256}
                  deviceId={device.id}
                  variantId={device.variants[0]?.id ?? null}
                  units={units}
                  language={language}
                  onPlace={(placement) => {
                    onPlace(placement);
                    onClose();
                  }}
                />
              </article>
            );
          })}
        </div>
      </section>
      <SdkAdapterInspector
        target={sdkTarget}
        language={language}
        onClose={() => setSdkTarget(null)}
      />
      <DeviceConfigInspector
        target={configTarget}
        language={language}
        onClose={() => setConfigTarget(null)}
        onLocate={(componentId) => {
          setConfigTarget(null);
          onClose();
          onLocate(componentId);
        }}
      />
    </div>
  );
}
