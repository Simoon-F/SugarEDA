# P3 第九阶段：DevicePack 制作、签名验证与 Adapter 契约

本阶段提供可视化 DevicePack 制作基础、Rust 权威导出、Ed25519 分离签名验证，以及未来授权厂商 Adapter 的无执行契约。schema 继续保持 v4，DevicePack 格式继续保持 v1；没有灰度开关、在线市场或厂商 SDK。

## 器件包制作工作台

从“器件包管理”进入“制作器件包”。工作台当前支持制作一个主器件的 L1/L2/L5 数据基础：

- manifest ID、名称、作者/厂商、版本、来源、许可证和说明；
- 器件 ID、名称和器件类型；
- 引脚 ID、封装焊盘号、名称、分组、电气类型、方向和电压域；
- 电压域范围；
- 每引脚复用功能；
- `required`、`allowFloating` 和 `bootConfiguration` 基础 ERC 标记；
- 自动同步生成的 package pads 与 symbol unit groups；
- Rust 实时格式检查、规范内容哈希和原子 `.devicepack.json` 导出。

React 草稿模型位于 `device-pack-authoring-draft.ts`，不包含 DevicePack 安全规则。`device_pack_authoring/report.rs` 直接调用正式 `device_pack::validate`；导出后的文件再由普通导入器回读测试，避免“编辑器认为合法但应用无法导入”的双重标准。

本阶段工作台不内嵌 SPICE 文本编辑器，不制作 IBIS/S 参数负载，也不生成 SDK Adapter。已有完整 JSON 格式仍可表达这些元数据；后续模型制作页必须继续使用独立安全解析器。

## Ed25519 分离签名

签名文件扩展名固定为 `.devicepack.sig.json`：

```json
{
  "formatVersion": 1,
  "algorithm": "ed25519",
  "keyId": "publisher-key-2026",
  "signer": "Publisher display name",
  "packSha256": "64 lowercase hexadecimal characters",
  "publicKeyBase64": "32-byte Ed25519 public key in Base64",
  "signatureBase64": "64-byte Ed25519 signature in Base64"
}
```

签名对象不是原始 JSON 字节，而是 DevicePack 通过 Rust 反序列化、验证并规范序列化后的内容 SHA-256。签名字节为以下 UTF-8 文本，不带末尾换行：

```text
SugarEDA DevicePack Signature v1
<packSha256>
```

验证器限制签名文件为 64 KiB，严格拒绝未知字段、错误算法、错误长度和哈希不匹配。状态 `device-pack-signature.verified-untrusted` 的含义仅是“该公钥签署了相同内容”。当前没有本地可信根或证书链，因此 `trustedIdentity` 始终为 `false`，UI 不会把自声明 signer 当成可信厂商。

本阶段不生成或保存私钥。发布者必须在自己的受控签名环境中产生分离签名。

## Adapter Contract v1

`adapter_contract` 是公开 Rust DTO 与严格清单验证器，而不是运行时插件加载器。示例见 `examples/adapters/test-sdk-metadata.sugareda-adapter.json`，数据为 SugarEDA 自创 CC0 测试元数据，不包含 SDK。

契约包括：

- ID、发布者、版本、许可证与来源；
- Adapter 类型、输入类型、唯一输出类型和支持的 DevicePack ID；
- `AdapterRequestEnvelope` 与 `AdapterResponseEnvelope`，通过 request ID、目标身份和输入 SHA-256 关联；
- 中英文稳定诊断 DTO；
- 权限声明。

v1 强制：

- `networkAccess = false`；
- `processExecution = false`；
- `projectFilesRead = false`；
- 仅允许声明读取用户明确选择的 SDK 根元数据；
- `executionAvailable = false`，应用不会发现、加载或执行 Adapter。

这为未来经过授权和安全审查的进程隔离 Adapter 保留数据边界，同时保证当前版本不会因为一个清单文件执行代码。未来运行时必须另行设计签名信任、权限授权、超时、资源限制和沙箱，不能绕过统一 Device Configuration IR 与 Rust 规则检查。

## 模块边界

- `device_pack_authoring/commands.rs`：Tauri 命令边界。
- `device_pack_authoring/report.rs`：正式校验器结果适配。
- `device_pack_authoring/export.rs`：限制大小、扩展名与原子导出。
- `device_pack_signature/types.rs`：分离签名和报告 DTO。
- `device_pack_signature/verify.rs`：规范哈希与 Ed25519 验证。
- `adapter_contract/types.rs`：公开、稳定、无路径的契约 DTO。
- `adapter_contract/validation.rs`：字段、数量和权限策略。
- `device-pack-authoring-editor.tsx`：制作流程状态和 Rust 调用编排，不包含具体表单实现。
- `device-pack-authoring-manifest.tsx`：来源、许可证和身份清单表单。
- `device-pack-authoring-device.tsx`：主器件字段及其子编辑器编排。
- `device-pack-authoring-voltage-domains.tsx`：电源域范围与引用编辑。
- `device-pack-authoring-pin-table.tsx`：引脚、复用功能与基础规则表格。
- `device-pack-authoring-review.tsx`：权威校验报告与规范 JSON 预览。
- `device-pack-authoring-draft.ts`：不可变草稿变换和符号/封装引用同步。
- `device-pack-signature-inspector.tsx`：独立分离签名检查 UI。

这些 React 模块不进入 `app.tsx` 或器件包核心校验器；新增字段应落到对应领域模块，避免在编排组件中继续堆叠子模块代码。

## 明确边界

- 不下载、捆绑或解析 RK3576 或任何厂商 SDK。
- 不信任自声明 signer，不提供私钥管理。
- 不执行 Adapter、脚本、动态库或外部命令。
- 不实现 IBIS/S 参数求解器或固件/操作系统仿真。
- 不接入在线器件市场。
