# P3 第十一阶段：多器件编排与安全模型导入

本阶段继续使用工程 schema v4 和 DevicePack format v1，不设置灰度开关。目标是消除制作工作台中的单器件假设，并补齐本地模型与可信公钥的受限交换流程。

## 多器件与多封装

一个 DevicePack 草稿现在可以创建多个 `DeviceDefinition`。工作台顶部的器件切换器明确选择当前编辑作用域，每个器件分别维护：

- 器件身份和类型；
- 符号与多单元分组；
- 封装 ID、名称、类型和由引脚编号同步生成的 pad 集合；
- 引脚、电压域、PinMux、ERC 规则和差分对；
- SPICE/IBIS/S 参数模型引用与 SPICE 端口映射。

删除器件会删除该器件独占的符号、封装和模型；仍被其他器件引用的资源不会删除。所有草稿变换保持不可变数据语义，最终引用完整性仍由 Rust 校验器裁决。

## 受限 SPICE 文件导入

模型导入命令复用 SugarEDA 的正式 SPICE 解析器。输入必须是普通、非符号链接的 `.lib`、`.cir`、`.mod`、`.model` 或 `.spice` UTF-8 文本，且不超过 2 MiB。

解析器只接受受限的模型与子电路声明，拒绝 `.include`、控制块、外部文件或可执行引用、不支持的指令和畸形端口。后端返回文件名、字节数、内容哈希、可用定义和文本内容，不返回或保存原始路径。

前端向导要求用户选择一个导出定义，并将每个模型端口映射到不同的逻辑引脚。确认后，文本、SHA-256、来源文件名和端口映射一起内嵌到 DevicePack。许可证仍由制作者明确填写，成功解析不代表获得再分发权利。

## 可信公钥交换

签名面板支持导入和导出单个 `*.sugareda-trusted-key.json` 公钥文件。文件格式严格包含：

- `formatVersion: 1`；
- `keyId` 和发布者显示名；
- Base64 编码的 32 字节 Ed25519 公钥；
- 对公钥字节计算的 SHA-256 指纹。

导入限制为普通、非符号链接、64 KiB 以内的文件，并重新计算指纹。导出使用临时文件和原子替换，只交换公钥，不涉及私钥。导入动作代表当前用户显式信任该指纹，但不构成公共 CA 认证，也不提供在线吊销。

## 模块边界

- `device-pack-authoring-scope.ts`：按器件 ID 读取和替换草稿作用域。
- `device-pack-authoring-collection-draft.ts`：器件生命周期与封装引用变换。
- `device-pack-authoring-device-switcher.tsx`：多器件选择编排。
- `device-pack-authoring-package.tsx`：单器件封装字段。
- `device-pack-model-import-dialog.tsx`：文件选择、定义选择和端口映射流程。
- `device_pack_model_import/`：模型文件安全边界、DTO 和 Tauri 命令。
- `device_pack_signature/trust_store.rs`：密钥内容校验与持久化。
- `device_pack_signature/commands.rs`：公钥文件导入导出边界。

器件集合操作、模型文件读取、UI 向导和密钥持久化分别位于独立模块。器件包管理器只做入口编排，并通过动态导入按需加载制作、签名、SDK 检查和配置检查功能。

## 当前边界

- 不导入外部依赖型、加密或脚本化 SPICE 模型；
- 不自动推断不明确的模型端口语义；
- 不生成或保管发布者私钥；
- 不提供证书链、在线吊销或器件市场；
- IBIS/S 参数仍为 L4 元数据，不执行求解；
- SDK Adapter 仍不执行厂商 SDK，Device Tree 仍限于受控子集；
- 不实现固件或操作系统功能仿真。
