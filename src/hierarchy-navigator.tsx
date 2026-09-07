import { Boxes, CircuitBoard, Crosshair, Network } from "lucide-react";
import type { Project } from "./types";
import { connectorName } from "./hierarchy";
import "./hierarchy-navigator.css";

export function HierarchyNavigator({
  project,
  language,
  onLocate,
}: {
  project: Project;
  language: "zh-CN" | "en";
  onLocate: (componentId: string) => void;
}) {
  const zh = language === "zh-CN";
  const labels = project.sheets.flatMap((sheet) =>
    sheet.components
      .filter((component) => component.kind === "globalLabel")
      .map((component) => ({ sheet, component })),
  );
  const ports = project.sheets.flatMap((sheet) =>
    sheet.components
      .filter((component) => component.kind === "hierarchicalPort")
      .map((component) => ({ sheet, component })),
  );
  const instances = project.sheets.flatMap((sheet) =>
    sheet.components
      .filter((component) => component.kind === "sheetInstance")
      .map((component) => ({ sheet, component })),
  );
  const sections = [
    {
      id: "global",
      title: zh ? "全局网络" : "GLOBAL NETS",
      icon: Network,
      rows: labels.map(({ sheet, component }) => ({
        id: component.id,
        primary: connectorName(component),
        secondary: sheet.name,
        meta: zh ? "工程级" : "project",
      })),
    },
    {
      id: "ports",
      title: zh ? "层次端口" : "HIERARCHICAL PORTS",
      icon: CircuitBoard,
      rows: ports.map(({ sheet, component }) => ({
        id: component.id,
        primary: connectorName(component),
        secondary: sheet.name,
        meta: component.parameters.direction || "bidirectional",
      })),
    },
    {
      id: "instances",
      title: zh ? "图纸实例" : "SHEET INSTANCES",
      icon: Boxes,
      rows: instances.map(({ sheet, component }) => ({
        id: component.id,
        primary: component.displayName,
        secondary: sheet.name,
        meta: `${component.pins.length} ${zh ? "端口" : "ports"}`,
      })),
    },
  ];
  return (
    <div className="hierarchy-navigator">
      <div className="hierarchy-overview">
        <strong>{zh ? "跨页连接导航" : "Cross-sheet connectivity"}</strong>
        <span>
          {labels.length} {zh ? "个全局标签" : "global labels"} · {ports.length}{" "}
          {zh ? "个端口" : "ports"} · {instances.length}{" "}
          {zh ? "个图纸实例" : "sheet instances"}
        </span>
      </div>
      <div className="hierarchy-columns">
        {sections.map((section) => (
          <section key={section.id}>
            <h3>
              <section.icon /> {section.title}
              <span>{section.rows.length}</span>
            </h3>
            <div className="hierarchy-rows">
              {section.rows.map((row) => (
                <button key={row.id} onClick={() => onLocate(row.id)}>
                  <Crosshair />
                  <span>
                    <b>{row.primary}</b>
                    <small>{row.secondary}</small>
                  </span>
                  <code>{row.meta}</code>
                </button>
              ))}
              {!section.rows.length && (
                <p>{zh ? "暂无对象" : "No objects yet"}</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
