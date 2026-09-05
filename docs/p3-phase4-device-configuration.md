# P3 第四阶段：厂商无关器件配置检查

本阶段新增 L5 的受限配置中间格式和 Rust 校验器。它验证 DevicePack 已声明的 PinMux、物理引脚、复用信号冲突和启动绑带覆盖，不解析厂商 SDK、Device Tree 或任意脚本。

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
  "bootStraps": [{ "pinId": "boot0", "value": "pullDown" }]
}
```

`bootStraps[].value` 只能是 `low`、`high`、`pullDown`、`pullUp` 或 `external`。目标绑定器件包 ID、精确版本、器件 ID 和可选变体；检查器不会把针对其他版本的配置静默套用到当前器件。

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

## 安全与工程边界

- 最大文件大小 1 MiB；最多 4,096 个 PinMux 声明和 512 个启动绑带。
- 严格拒绝未知字段、未知枚举、超长字符串、控制字符和非安全标识符。
- 格式没有路径、URL、include、脚本、命令或二进制载荷字段，因此不能引用外部文件或执行代码。
- 校验由 Rust 完成；React 只负责选择文件和展示报告。
- 本地文件路径和配置内容不会写入 `.sugeda`，因此 schema 保持 v4，撤销/重做状态不受影响。

仓库提供 `examples/device-configs/test-mcu-valid.device-config.json` 和对应非法夹具。二者均为 SugarEDA 虚构测试数据，以 CC0-1.0 发布。

## 模块边界

- `src-tauri/src/device_config/format.rs`：格式、反序列化和资源上限。
- `src-tauri/src/device_config/checker.rs`：DevicePack 语义检查和双语诊断。
- `src-tauri/src/device_config/mod.rs`：文件读取与公共检查 API。
- `src/device-configuration.ts`：前端可检查能力派生，不复制后端规则。
- `src/device-config-inspector.tsx`：文件选择和诊断展示。
- `src/device-pack-manager.tsx`：只计算目标并打开独立检查器。

## 后续接入

未来获授权的厂商 Adapter 可以把用户本地 SDK、PinMux 工具导出或 Device Tree 转换为此中间格式，再交给同一 Rust 校验器。解析器必须是独立、只读且有资源上限的模块，不能修改本格式校验器来执行厂商工具。

RK3576 不会成为架构特例。若未来有授权数据，它与 MCU、模拟器件一样通过普通 DevicePack 和独立 Adapter 接入；本阶段不下载或捆绑任何厂商 SDK，也不声称配置检查或 ngspice 能执行固件。
