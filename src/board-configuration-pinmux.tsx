import { useMemo, useState } from "react";
import { Cable, Search } from "lucide-react";
import type { DeviceConfigurationData, DevicePack } from "./types";

const ROW_HEIGHT = 58;
const VIEWPORT_HEIGHT = 430;
const OVERSCAN = 6;

type PinMuxRow = {
  pinId: string;
  number: string;
  name: string;
  group: string;
  functions: string[];
};

export function BoardConfigurationPinMux({
  device,
  draft,
  issuePinIds,
  language,
  onAssign,
}: {
  device: DevicePack["devices"][number];
  draft: DeviceConfigurationData;
  issuePinIds: Set<string>;
  language: "zh-CN" | "en";
  onAssign: (pinId: string, selectedFunction: string) => void;
}) {
  const zh = language === "zh-CN";
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [scrollTop, setScrollTop] = useState(0);
  const rows = useMemo(() => {
    const pins = new Map(device.pins.map((pin) => [pin.id, pin]));
    return device.alternateFunctions
      .map((alternate): PinMuxRow | null => {
        const pin = pins.get(alternate.pinId);
        return pin
          ? {
              pinId: pin.id,
              number: pin.number,
              name: pin.name,
              group: pin.group,
              functions: alternate.functions,
            }
          : null;
      })
      .filter((row): row is PinMuxRow => Boolean(row))
      .sort(
        (left, right) =>
          left.group.localeCompare(right.group) ||
          left.number.localeCompare(right.number, undefined, {
            numeric: true,
          }),
      );
  }, [device]);
  const groups = useMemo(
    () => [...new Set(rows.map((row) => row.group))],
    [rows],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (group === "all" || row.group === group) &&
        (!needle ||
          `${row.pinId} ${row.number} ${row.name} ${row.group} ${row.functions.join(" ")}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [group, query, rows]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const visible = filtered.slice(start, start + visibleCount);
  const assigned = new Map(
    draft.pinMux.map((assignment) => [assignment.pinId, assignment.function]),
  );

  return (
    <section className="board-editor-pane pinmux-pane">
      <div className="board-editor-pane-heading">
        <div>
          <small>PIN MULTIPLEXING</small>
          <h3>{zh ? "引脚功能分配" : "Pin function assignment"}</h3>
          <p>
            {zh
              ? "选择由器件包声明的合法功能；未配置的引脚保持空白。"
              : "Select only functions declared by the DevicePack; leave unused pins unassigned."}
          </p>
        </div>
        <strong>
          {draft.pinMux.length} / {rows.length}
        </strong>
      </div>
      <div className="pinmux-toolbar">
        <label>
          <Search />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setScrollTop(0);
            }}
            placeholder={
              zh ? "搜索引脚、分组或功能" : "Search pin, group, or function"
            }
          />
        </label>
        <select
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setScrollTop(0);
          }}
          aria-label={zh ? "引脚分组" : "Pin group"}
        >
          <option value="all">{zh ? "全部分组" : "All groups"}</option>
          {groups.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="pinmux-table-head" aria-hidden="true">
        <span>{zh ? "引脚" : "Pin"}</span>
        <span>{zh ? "分组" : "Group"}</span>
        <span>{zh ? "复用功能" : "Mux function"}</span>
        <span>{zh ? "状态" : "State"}</span>
      </div>
      <div
        className="pinmux-virtual-list"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="list"
        aria-label={zh ? "可配置引脚" : "Configurable pins"}
      >
        <div
          className="pinmux-virtual-space"
          style={{ height: filtered.length * ROW_HEIGHT }}
        >
          <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            {visible.map((row) => {
              const selected = assigned.get(row.pinId) ?? "";
              const invalid = issuePinIds.has(row.pinId);
              return (
                <div
                  className={`pinmux-row${invalid ? " invalid" : ""}`}
                  style={{ height: ROW_HEIGHT }}
                  role="listitem"
                  key={row.pinId}
                >
                  <span className="pinmux-pin">
                    <b>{row.name}</b>
                    <code>
                      {row.number} · {row.pinId}
                    </code>
                  </span>
                  <span className="pinmux-group">{row.group}</span>
                  <select
                    value={selected}
                    onChange={(event) =>
                      onAssign(row.pinId, event.target.value)
                    }
                    aria-label={`${row.name} ${zh ? "复用功能" : "mux function"}`}
                  >
                    <option value="">{zh ? "未分配" : "Unassigned"}</option>
                    {row.functions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <span
                    className={selected ? "pinmux-state set" : "pinmux-state"}
                  >
                    <Cable />
                    {selected
                      ? zh
                        ? "已分配"
                        : "Assigned"
                      : zh
                        ? "空闲"
                        : "Free"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {!filtered.length && (
          <div className="pinmux-empty">
            {zh ? "没有匹配的可复用引脚" : "No matching mux-capable pins"}
          </div>
        )}
      </div>
      <p className="pinmux-performance-note">
        {zh
          ? `仅渲染可视区域行；当前筛选 ${filtered.length} 个引脚。`
          : `Only visible rows are rendered; ${filtered.length} pins match the filter.`}
      </p>
    </section>
  );
}
