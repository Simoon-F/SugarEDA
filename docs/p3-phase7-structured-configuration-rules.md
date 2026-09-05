# P3 第七阶段：结构化器件配置规则

本阶段增强厂商无关 L5 数据基础，但不解析厂商 SDK。DevicePack 可以显式声明外设功能完整性、功能依赖、互斥选择和必选电压域；JSON 与受限 DTS Adapter 把板级选择转换到同一个配置 IR，最终由 Rust 权威检查器执行。

## 设计原则

- 核心代码不识别或硬编码 UART、SPI、I2C、RK3576 等产品或协议名称。
- 每条规则只引用同一 device 的 `alternateFunctions` 或 `voltageDomains`。
- Adapter 只负责语法转换，不复制语义规则。
- 诊断使用稳定 code、可选 `pinId`/`domainId` 和中英文说明。
- 规则和配置都是纯数据，不包含表达式语言、脚本、路径或命令。

## DevicePack 规则

`devices[].configurationRules` 支持五种固定规则：

| kind                         | 语义                                   |
| ---------------------------- | -------------------------------------- |
| `requiredFunctions`          | 列出的全部功能始终必须分配             |
| `completeFunctionGroup`      | 组内任意功能出现后，其他功能也必须分配 |
| `mutuallyExclusiveFunctions` | 列出的功能最多出现一个                 |
| `functionDependency`         | `whenAny` 触发后要求 `requireAll`      |
| `requiredVoltageDomains`     | 配置必须为列出的电压域明确选择工作电压 |

导入器限制每器件 256 条规则、每个集合 64 个唯一引用。未知函数、未知电压域、重复规则 ID、空集合和超限数据均以 `invalid_configuration_rule` 拒绝。

## 配置 IR

`DeviceConfig` 新增：

```json
"voltageSelections": [
  { "domainId": "vddio", "voltage": 3.3 }
]
```

电压单位固定为 V。结构校验限制为有限的 `0..100000`，语义检查再使用 DevicePack 的 `minVoltage`/`maxVoltage`。同一电压域不能重复选择。

受限 DTS 使用：

```dts
voltage-domains {
  selection@0 { domain = "vddio"; voltage = "3.3"; };
};
```

这只是 SugarEDA 独立 DTS 子集，不引入数值数组、phandle、include 或通用 Device Tree 语义。

## 模块边界

- `device_pack/configuration_rules.rs`：规则 DTO、引用完整性和资源上限。
- `device_config/ir.rs`：统一电压选择 IR。
- `device_config/format.rs`：JSON 结构验证。
- `device_config/checker.rs`：所有函数、电压和规则语义。
- `device_tree_adapter/parser.rs`：只识别 `voltage-domains/selection` 白名单节点。
- `device_tree_adapter/converter.rs`：只转换为共享 IR 并保存源码位置。
- React 类型与能力派生只用于展示，不复刻 Rust 检查算法。

## 测试数据

虚构 STMCU24 测试包声明 UART1、SPI1 和 IO 电压规则；合法 JSON/DTS 配置完整选择 UART1、SPI1、启动状态和 3.3 V。非法夹具覆盖重复信号、缺少启动配置、越界电压、重复电压域和未知电压域。全部数据仍为 SugarEDA 自创 CC0-1.0 测试数据。

## 边界

本阶段不生成寄存器值、C 代码或 Device Tree，不运行 SDK 工具，不求解 IBIS/S 参数，也不模拟固件。未来获授权 Adapter 只能把输入转换到相同 IR，不能绕过 DevicePack 引用验证和 Rust 规则检查。
