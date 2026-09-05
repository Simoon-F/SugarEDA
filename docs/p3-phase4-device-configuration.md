# P3 第四阶段：厂商无关器件配置检查

本阶段新增 L5 的受限配置中间格式和 Rust 校验器。它验证 DevicePack 已声明的 PinMux、物理引脚、复用信号冲突和启动绑带覆盖。后续阶段已增加独立的 [受限 Device Tree Adapter](p3-phase5-device-tree-adapter.md)，但仍不解析通用 DTS、厂商 SDK 或任意脚本。

## 文件格式

文件名必须以 `.device-config.json` 结尾，当前 `formatVersion` 为 `1`：

```json
{
  "formatVersion": 1,
  "id": "org.example.board.config",
  "name": "Example board configuration",
  "source": "Board maintainer-authored configuration",
  "license": "CC0-1.0",
  "target": {
    "packId": "org.example.devices",
    "packVersion": "1.0.0",
    "deviceId": "example-mcu",
    "variantId": "industrial"
  },
  "pinMux": [
    { "pinId": "pa0", "function": "UART1_TX" },
    { "pinId": "pa1", "function": "I2C1_SDA" }
  ],
  "bootStraps": [{ "pinId": "boot0", "value": "pullDown" }],
  "voltageSelections": [{ "domainId": "vddio", "voltage": 3.3 }]
}
```

`bootStraps[].value` 只能是 `low`、`high`、`pullDown`、`pullUp` 或 `external`。`voltageSelections` 使用伏特为单位的有限数值。目标绑定器件包 ID、精确版本、器件 ID 和可选变体；检查器不会把针对其他版本的配置静默套用到当前器件。

## 当前检查规则

所有诊断都包含稳定 `code`、可选 `pinId`、严重程度以及中英文消息：

- `device-config.target-pack-mismatch`、`target-version-mismatch`、`target-device-mismatch`：目标不一致。
- `device-config.unknown-variant`：目标变体不存在。
- `device-config.duplicate-pin-assignment`：同一引脚重复配置 PinMux。
- `device-config.unknown-pin`：PinMux 引用了不存在的物理引脚。
- `device-config.unsupported-function`：功能不在该引脚的 `alternateFunctions` 中。
- `device-config.signal-conflict`：同一个不可重复的外设信号被分配到多个引脚。
- `device-config.duplicate-boot-strap`、`unknown-boot-pin`：启动绑带重复或引脚不存在。
- `device-config.boot-pinmux-conflict`：同一引脚同时声明为 PinMux 和启动绑带。
- `device-config.boot-pin-unconfigured`：DevicePack 的 `bootConfiguration` 规则未被覆盖。
- `device-config.duplicate-voltage-selection`、`unknown-voltage-domain`、`voltage-out-of-range`：电压域重复、不存在或工作电压越界。
- `device-config.required-functions-missing`：缺少器件包无条件要求的功能。
- `device-config.incomplete-function-group`：外设功能组只配置了一部分信号。
- `device-config.mutually-exclusive-functions`：同时选择了器件包声明为互斥的功能。
- `device-config.function-dependency-unsatisfied`：启用功能后未满足依赖信号。
- `device-config.required-voltage-domain-missing`：缺少器件包要求的 IO/电源域工作电压选择。

## 安全与工程边界

- 最大文件大小 1 MiB；最多 4,096 个 PinMux 声明、512 个启动绑带和 512 个电压域选择。
- 严格拒绝未知字段、未知枚举、超长字符串、控制字符和非安全标识符。
- 格式没有路径、URL、include、脚本、命令或二进制载荷字段，因此不能引用外部文件或执行代码。
- 校验由 Rust 完成；React 只负责选择文件和展示报告。
- 原始本地路径不会写入 `.sugeda`。通过检查器显式绑定后，规范化配置 IR、来源文件名和 SHA-256 会随 schema v4 工程保存；导入、替换和移除均支持撤销/重做。详见 [P3 第六阶段工程内板级配置](p3-phase6-board-configuration.md)。

仓库提供 `examples/device-configs/test-mcu-valid.device-config.json` 和对应非法夹具。二者均为 SugarEDA 虚构测试数据，以 CC0-1.0 发布。

## 模块边界

- `src-tauri/src/device_config/ir.rs`：JSON 与 Adapter 共用的配置 IR。
- `src-tauri/src/device_config/format.rs`：JSON 反序列化和资源上限。
- `src-tauri/src/device_config/checker.rs`：目标检查和规则编排。
- `src-tauri/src/device_config/pin_rules.rs`：PinMux、启动绑带和信号冲突。
- `src-tauri/src/device_config/voltage_rules.rs`：电压域存在性、唯一性和范围。
- `src-tauri/src/device_config/pack_rules.rs`：DevicePack 声明的功能组、依赖和互斥规则。
- `src-tauri/src/device_config/diagnostic.rs`：稳定诊断 DTO 和 subject 字段。
- `src-tauri/src/device_config/mod.rs`：文件读取与公共检查 API。
- `src/device-configuration.ts`：前端可检查能力派生，不复制后端规则。
- `src/device-config-inspector.tsx`：文件选择和诊断展示。
- `src-tauri/src/board_config/*`：工程绑定、持久化约束与项目级检查。
- `src/board-configuration-panel.tsx`：工程内配置状态、诊断和定位。
- `src/device-pack-manager.tsx`：只计算目标并打开独立检查器。

## 后续接入

受限 Device Tree Adapter 已可把 SugarEDA 独立子集转换为此中间格式。未来获授权的厂商 Adapter 仍必须先转换到同一 IR，再交给 Rust 校验器。每个解析器必须是独立、只读且有资源上限的模块，不能修改本格式校验器来执行厂商工具。

RK3576 不会成为架构特例。若未来有授权数据，它与 MCU、模拟器件一样通过普通 DevicePack 和独立 Adapter 接入；本阶段不下载或捆绑任何厂商 SDK，也不声称配置检查或 ngspice 能执行固件。
