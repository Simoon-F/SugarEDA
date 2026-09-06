# P3 第十阶段：高级 DevicePack 制作与本地发布者信任

本阶段在 DevicePack v1 和工程 schema v4 上继续扩展，不增加灰度开关，也不引入在线市场、厂商 SDK、IBIS/S 参数求解器或脚本执行能力。

## 高级制作能力

器件包制作工作台由三个基础步骤扩展为五个独立步骤：

1. 来源与身份；
2. 器件、引脚和电压域；
3. 多单元符号与差分对；
4. SPICE、IBIS/S 参数元数据与资料来源；
5. Rust 权威校验与规范 JSON 预览。

多单元符号通过引脚 `group` 分配单元。编辑引脚后，草稿层会保留已有单元，并同步新增或删除的分组，不会把大型器件重新压回单单元符号。

差分对明确保存 P/N 极性，并继续由已有通用 ERC 检查缺少一端和极性接反。该数据也是未来 L4 后端的输入，但本阶段不进行信号完整性求解。

SPICE 编辑器生成自包含的 `.subckt` 起始模板和每个逻辑引脚的显式端口映射。引脚重命名会同步端口引用；增加或删除引脚会同步映射表。最终模型名称、完整端口集合和 SPICE 安全性仍由 Rust 的正式模型解析器和 `simulation_binding` 校验。

IBIS 与 S 参数条目只记录格式、用途和许可证元数据，不接受外部路径或模型负载。UI 明确显示它们不是当前可运行的求解能力。

资料来源编辑器要求 HTTP(S) URL，并保留标题、类型、修订和许可证。DevicePack 的 manifest 许可证不自动覆盖模型或资料的许可证，制作者必须分别确认再分发权利。

## 本地可信发布者密钥

签名面板现在提供显式的“信任此发布密钥”操作。只有同时满足以下条件时才能加入本地信任库：

- DevicePack 通过正常导入和格式验证；
- DevicePack 的规范内容哈希与签名声明一致；
- Ed25519 签名验证成功；
- 用户主动点击信任操作。

信任项以公钥 SHA-256 指纹作为稳定身份，记录显示名称、`keyId`、公钥和信任时间。后续签名验证只有在公钥字节和指纹均与本地记录一致时才返回 `device-pack-signature.verified-trusted`。

本地信任库位于应用数据目录的 `trusted-device-pack-keys-v1.json`。它采用严格 JSON、256 KiB/256 个密钥上限、指纹复算、重复拒绝和原子写入。撤销信任只删除本地公钥记录，不删除 DevicePack 或工程数据。

这里的“可信”只表示当前用户明确认可该密钥，不代表 SugarEDA、操作系统或公共 CA 为发布者背书，也不提供密钥吊销网络、证书链或透明日志。

## 模块边界

- `device-pack-authoring-advanced-draft.ts`：高级制作的不可变引用变换。
- `device-pack-authoring-signal-structure.tsx`：多单元和差分对编排。
- `device-pack-authoring-models.tsx`：模型与资料步骤编排。
- `device-pack-authoring-model-card.tsx`：单模型字段和 SPICE 端口映射。
- `device-pack-authoring-documents.tsx`：资料来源编辑。
- `device-pack-authoring-advanced.css`：高级制作步骤样式，不污染基础制作编排样式。
- `device-pack-signature-inspector.css`：签名与本地信任状态样式。
- `device_pack_signature/trust_store.rs`：本地可信密钥持久化和完整性检查。
- `device_pack_signature/verify.rs`：密码学验证和信任状态组合。
- `device_pack_signature/commands.rs`：验证、列出、显式信任和撤销命令。

模型表单、信号结构、资料和信任持久化均保持独立；制作流程编排组件不实现领域规则。

## 仍未实现

- 私钥生成、保存或签名服务；
- 公共 CA、远程吊销列表和密钥透明日志；
- IBIS/S 参数求解与波形展示；
- 厂商 SDK 执行、Device Tree 全语法或固件仿真；
- 多个 DeviceDefinition/Package 的同包可视化编排；
- 通用模型文件导入向导。
