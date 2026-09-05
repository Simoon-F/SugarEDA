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
          <dd>{report?.pinCount ?? pack.devices[0].pins.length}</dd>
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
            ? "此工作台生成 L1/L2/L5 数据基础。SPICE 模型、IBIS/S 参数元数据与 SDK Adapter 清单必须通过自包含 JSON 和相应授权流程加入。"
            : "This workbench authors the L1/L2/L5 foundation. SPICE models, IBIS/S-parameter metadata, and SDK adapter manifests require self-contained JSON and their respective authorization workflow."}
        </span>
      </div>
      <pre>{JSON.stringify(pack, null, 2)}</pre>
    </div>
  );
}
