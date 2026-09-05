# P3 第二阶段模块边界

本阶段增加“逻辑器件实例”，用于让 MCU/SoC 的 POWER、GPIO、DDR 等符号单元代表同一颗物理器件，同时保持阶段一 DevicePack 格式不变。

共享多单元是 schema v4 的固定能力，不设置运行时或构建时灰度开关。旧工程只在读取时迁移，后续统一写回 v4。

## Rust 权威边界

- `domain.rs`：只定义持久化实体和 schema 版本，不包含放置流程。
- `device_pack.rs`：只负责器件包格式、导入、防御性验证、能力计算和由包数据生成符号几何。
- `device_instance.rs`：独占逻辑实例的创建、复用、迁移、身份更新、孤儿清理和跨实体一致性验证。
- `application.rs`：只编排编辑命令和撤销事务，不复制器件规则。
- `project.rs`：只编排工程读写、版本迁移和各领域验证器。

所有共享 unit 的状态变更都和画布 Component 在同一个 `Project` 快照中提交，因此现有快照式撤销/重做无需另建历史系统。复制/粘贴先在候选 Project 上校验，通过后才整体替换，失败不会留下半个实例。

## React 边界

- `device-unit-factory.ts`：浏览器演示模式的动态 unit 工厂；桌面模式仍以 Rust 为权威。
- `device-instance.ts`：无 UI 的实例查询和孤儿清理。
- `device-unit-actions.tsx`：只负责新实例/已有实例和 unit 可用性的交互。
- `component-library.ts`：只派生侧栏库视图。
- `selection-clipboard.ts`：只负责选择集及共享实例的事务式克隆。
  `app.tsx` 仍是工作区组合根，但不再包含 DevicePack unit 生成、共享实例查询、器件库派生或复制克隆算法。后续功能应继续按上述领域入口扩展，禁止把 SDK Adapter、IBIS 或 Device Tree 的实现塞回组合根。

## 当前边界

共享多单元身份和 L1/L2 数据已贯通。带 SPICE 的单 unit 测试模拟器件保持 L3 行为；跨多个 symbol unit 聚合为一个 SPICE 子电路实例仍需要明确的模型端口到 unit/pin 映射，当前不会把 MCU/SoC 元数据宣称为可固件或完整芯片仿真。
