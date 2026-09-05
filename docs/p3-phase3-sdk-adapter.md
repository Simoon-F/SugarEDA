# P3 第三阶段：SDK Adapter 安全发现

本阶段提供 L5 的本地 SDK 目录发现基础，但不解析 SDK、PinMux 或 Device Tree，不执行任何厂商工具，也不下载或捆绑 SDK。

## 能力边界

器件包管理器只对具有 `sdkAdapterIds` 的器件显示“匹配本地 SDK”。用户必须显式选择一个目录；Rust 随后使用 DevicePack 内经过验证的 `localPathPatterns` 做只读结构匹配。

匹配成功仅表示至少一个路径模式存在，报告固定标记为 `pathMetadataOnly`。`versionRequirement` 只用于展示，当前不会读取版本文件或推断兼容性，因此 UI 必须同时显示“这不代表 SDK 版本兼容或配置正确”。

## 安全约束

- 模式只能是相对路径。
- 支持完整路径段 `*` 和文件后缀 `*.ext`；拒绝 `**`、`foo*`、绝对路径、`..`、反斜杠、命令替换字符和盘符。
- 每次最多访问 10,000 个目录项，每个模式最多返回 128 个匹配。
- 每一级扫描前都规范化路径并验证仍位于用户所选根目录下；逃逸符号链接被忽略。
- 不读取匹配文件内容，不执行二进制或脚本，不修改所选目录。
- 本地绝对路径只存在于即时报告，不写入 `.sugeda`。

## 模块边界

- `sdk_adapter.rs`：路径模式验证、受限扫描和中英文结构化报告。
- `lib.rs`：只暴露只读 Tauri 命令 `inspect_sdk_adapter`。
- `sdk-adapter-inspector.tsx`：目录选择和结果展示，不实现匹配算法。
- `device-pack-manager.tsx`：只负责打开检查器并传递所选器件的 adapter 元数据。

PinMux/启动配置检查现已通过独立的受限 JSON IR 实现，见 [P3 第四阶段器件配置检查](p3-phase4-device-configuration.md)。未来 Device Tree 或厂商 SDK 解析器只能把输入转换为该 IR，不得把解析逻辑加入本模块，也不得把路径匹配结果提升为“SDK 已兼容”。
