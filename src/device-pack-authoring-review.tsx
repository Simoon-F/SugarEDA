import { AlertTriangle, Box, CheckCircle2 } from "lucide-react";
import type { DevicePack, DevicePackAuthoringReport } from "./types";

export function DevicePackAuthoringReview({
  pack,
  report,
  language,
}: {
  pack: DevicePack;
  report: DevicePackAuthoringReport | null;
  language: "zh-CN" | "en";
}) {
  const zh = language === "zh-CN";
  return (
    <div className="pack-author-review">
      <div
        className={
          report?.valid ? "pack-author-report valid" : "pack-author-report"
        }
      >
        {report?.valid ? <CheckCircle2 /> : <AlertTriangle />}
        <div>
          <h3>
            {report?.valid
              ? zh
                ? "可以导出"
                : "Ready to export"
              : zh
                ? "需要修正草稿"
                : "Draft needs correction"}
          </h3>
          <p>
            {report?.issues[0]?.message ??
              (zh
                ? "Rust 已完成引用、安全上限与数据一致性检查。"
                : "Rust validated references, defensive limits, and data consistency.")}
          </p>
        </div>
      </div>
      <dl>
        <div>
          <dt>{zh ? "器件" : "Devices"}</dt>
          <dd>{report?.deviceCount ?? pack.devices.length}</dd>
        </div>
        <div>
          <dt>{zh ? "引脚" : "Pins"}</dt>
          <dd>
            {report?.pinCount ??
              pack.devices.reduce(
                (total, device) => total + device.pins.length,
                0,
              )}
          </dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>{report?.packSha256 ?? "—"}</dd>
        </div>
      </dl>
      <div className="pack-author-boundary">
        <Box />
        <span>
          {zh
            ? "此工作台生成 L1/L2/L3 数据及 L4/L5 元数据基础。SPICE 必须自包含；IBIS/S 参数仅代表元数据，SDK Adapter 仍须通过独立授权契约加入。"
            : "This workbench authors L1/L2/L3 data and the L4/L5 metadata foundation. SPICE must be self-contained; IBIS/S-parameter entries remain metadata, and SDK adapters still require a separate authorized contract."}
        </span>
      </div>
      <pre>{JSON.stringify(pack, null, 2)}</pre>
    </div>
  );
}
