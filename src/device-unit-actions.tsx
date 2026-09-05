import { useMemo, useState } from "react";
import { compatibleDeviceInstances, placedUnitIds } from "./device-instance";
import type { ComponentPlacement, DevicePack, Project } from "./types";

type Unit = DevicePack["symbols"][number]["units"][number];

export function DeviceUnitActions({
  project,
  packSha256,
  deviceId,
  variantId,
  units,
  language,
  onPlace,
}: {
  project: Project;
  packSha256: string;
  deviceId: string;
  variantId: string | null;
  units: Unit[];
  language: string;
  onPlace: (placement: ComponentPlacement) => void;
}) {
  const instances = useMemo(
    () => compatibleDeviceInstances(project, packSha256, deviceId, variantId),
    [project, packSha256, deviceId, variantId],
  );
  const [target, setTarget] = useState("new");
  const effectiveTarget =
    target === "new" || instances.some((instance) => instance.id === target)
      ? target
      : "new";
  const placed =
    effectiveTarget === "new"
      ? new Set<string>()
      : placedUnitIds(project, effectiveTarget);

  return (
    <div className="unit-actions">
      {units.length > 1 && (
        <label className="unit-target">
          <span>{language === "zh-CN" ? "逻辑器件" : "Logical device"}</span>
          <select
            value={effectiveTarget}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="new">
              {language === "zh-CN" ? "新建实例" : "New instance"}
            </option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.reference} · {instance.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {units.map((unit) => {
        const unitKey = unit.id || "";
        const alreadyPlaced = placed.has(unitKey);
        return (
          <button
            key={unit.id || "main"}
            disabled={alreadyPlaced}
            title={
              alreadyPlaced
                ? language === "zh-CN"
                  ? "该单元已放置"
                  : "This unit is already placed"
                : undefined
            }
            onClick={() =>
              onPlace({
                kind: "device",
                device: {
                  packSha256,
                  deviceId,
                  variantId,
                  unitId: unit.id || null,
                  logicalInstanceId:
                    effectiveTarget === "new" ? null : effectiveTarget,
                },
              })
            }
          >
            <span>
              {alreadyPlaced
                ? language === "zh-CN"
                  ? `${unit.name} · 已放置`
                  : `${unit.name} · Placed`
                : units.length > 1
                  ? unit.name
                  : language === "zh-CN"
                    ? "放置器件"
                    : "Place device"}
            </span>
            {unit.groups.length > 0 && <small>{unit.groups.join(" · ")}</small>}
          </button>
        );
      })}
    </div>
  );
}
