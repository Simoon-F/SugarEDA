# SugarEDA DevicePack v1

DevicePack 是 SugarEDA 的厂商无关、纯数据器件包。文件名使用 `*.devicepack.json` 或 `*.sugeda-pack.json`。Rust 导入器是格式与安全验证的权威；验证后的包按 SHA-256 内容哈希去重，并完整嵌入 `.sugeda`，工程不再依赖原始路径。

## 能力等级

| 等级 | 含义                          | P3 第一阶段                   |
| ---- | ----------------------------- | ----------------------------- |
| L1   | 符号、引脚、变体和封装映射    | 已实现                        |
| L2   | 电气元数据和 ERC              | 已实现                        |
| L3   | SPICE 模型和端口绑定          | 已实现安全内嵌文本模型        |
| L4   | IBIS/S 参数信号完整性         | 仅接口元数据，无求解器        |
| L5   | SDK、PinMux、Device Tree 检查 | 仅 Adapter 元数据，不解析 SDK |
| L6   | 固件或操作系统功能仿真        | 未实现                        |

能力按器件独立计算。只有符号的器件只显示“可画原理图”，不能描述为可完整仿真。SDK 元数据不代表存在电气仿真模型。

## 顶层格式

```json
{
  "manifest": {
    "formatVersion": 1,
    "id": "org.example.parts",
    "name": "Example Parts",
    "vendor": "Example Vendor",
    "version": "1.0.0",
    "source": "Maintainer-created data",
    "license": "CC0-1.0",
    "description": "Optional description"
  },
  "devices": [],
  "symbols": [],
  "packages": [],
  "models": [],
  "sdkAdapters": [],
  "documents": []
}
```

未知字段会被拒绝。ID 只允许 ASCII 字母、数字、`-`、`_`、`.`、`:`、`+`；所有引用必须在同一包内解析。

### `devices[]`

每个器件包含 `id`、`name`、`deviceType`、`symbolId`、`packageId`、`variants`、`pins`、`voltageDomains`、`alternateFunctions`、`differentialPairs`、`rules`、`modelIds` 和 `sdkAdapterIds`。

- 引脚包含稳定 `id`、物理 `number`、可见 `name`、`group`、`electricalType`、`direction` 和可选 `voltageDomainId`。
- `electricalType`：`passive`、`input`、`output`、`bidirectional`、`openDrain`、`openCollector`、`powerInput`、`powerOutput`、`noConnect`。
- `direction`：`input`、`output`、`bidirectional`、`passive`、`power`、`notConnected`。
- 电压域包含 `id`、`name`、`minVoltage`、`maxVoltage`。
- 复用功能把一个 `pinId` 映射到 GPIO、UART、SPI、I2C 等名称；本阶段只存储，不解析 SDK。
- 差分对包含 `id`、`positivePinId`、`negativePinId`。
- 规则包含 `id`、`kind`、`pinIds` 和可选 `message`。`kind` 为 `required`、`allowFloating`、`powerInput`、`powerOutput`、`bootConfiguration`。

### `symbols[]` 与大型器件

符号包含一个或多个 unit，每个 unit 选择若干引脚 `groups`。BGA 可拆为 POWER、GPIO、DDR、USB 等可独立放置的单元，避免一个不可读的大矩形。模型端口顺序仍按包内引脚顺序保持稳定，画布布局由方向和分组动态生成。

从工程 schema v4 开始，多 unit 符号通过独立的 `deviceInstances[]` 共享同一个物理器件身份、位号、变体和模型绑定；画布上的每个 `Component.device.logicalInstanceId` 指回该身份。同一个 unit 不能在同一逻辑实例中重复放置。删除最后一个 unit 会同步清理逻辑实例，复制多个 unit 只克隆一个新逻辑实例，保证撤销、重做和保存重开后关系不漂移。

应用只写入当前 schema v4，不保留并行 schema 或功能分支。schema v1～v3 仅作为读取兼容入口，打开后直接转换为 v4；v3 的每个旧动态元件会迁移为独立实例，因此不会意外合并原有元件。

### `packages[]`

封装包含 `id`、`name`、`kind` 和完整 `pads`。每个器件引脚编号必须匹配一个 pad。格式同时支持两引脚器件和数千焊球 BGA；当前上限为每器件 4,096 引脚。

### `models[]`

`kind` 为 `spice`、`ibis` 或 `sParameter`，并包含 `id`、`format`、可选 `modelName`、可选 `sha256` 与字符串 `metadata`。

- SPICE 必须提供 `embeddedContent`。SugarEDA 使用独立模型导入同一套白名单检查，拒绝 `.include`、`.control`、外部文件、脚本和不支持的指令；`modelName` 必须由内容导出。
- IBIS/S 参数在本阶段仅允许元数据，不接受模型载荷，直至存在专用安全导入器和求解边界。
- 模型不能引用外部路径，删除原始包后工程仍须可移植。

### `sdkAdapters[]` 与 `documents[]`

SDK Adapter 包含 `id`、`sdkType`、`versionRequirement`、安全的相对 `localPathPatterns` 和字符串 `metadata`。禁止绝对路径、`..`、命令替换、脚本或可执行代码，本阶段不会打开或执行这些路径。

文档仅保存 `kind`、`title`、HTTP(S) `sourceUrl`、`revision` 和 `license` 来源元数据，导入时不下载 URL。

## 限制与冲突策略

- 包文件 8 MiB；工程文件 64 MiB。
- 最多 4,096 个器件、每器件 4,096 引脚、总计 50,000 引脚、256 个模型。
- 普通字符串 512 UTF-8 字节，文档 URL 2,048 字节。
- 重复 ID/引脚/焊盘、缺失引用、非法电压、模型哈希不符、外部模型引用和路径穿越均被拒绝。
- 相同内容哈希重复导入为无操作；相同包 ID + 版本但哈希不同会拒绝；不同版本可以共存。
- 实例绑定精确的包哈希、ID 与版本；器件包没有脚本或生命周期钩子。

## 制作器件包

1. 从 [`examples/devicepacks`](../examples/devicepacks) 中最接近的自包含测试包开始。
2. 选择稳定包 ID 和版本，记录真实来源及允许再分发的许可证。
3. 完整列出物理 pad/pin，再增加电压域、复用功能、差分对和显式规则。
4. 把大型符号拆成有意义的功能 unit。
5. 只嵌入获准再分发的 SPICE 文本；IBIS/S 参数暂记录为元数据。
6. 在器件包管理器导入。错误会带 `invalid_pin`、`missing_reference`、`external_model_reference` 等稳定类别。

## 为什么 SDK 不等于 SPICE

SDK 描述寄存器、驱动、板级配置、PinMux 和构建产物；SPICE 描述模拟/电气传递函数与模型端口。ngspice 不能执行固件、启动操作系统、解释 Device Tree，也不能从 SDK 推断芯片电气行为，因此 L3 和 L5 必须独立展示。

## 未来厂商接入

未来如从获授权来源制作 RK3576 包，它也只是普通 DevicePack，架构中不会硬编码 RK3576。L1/L2 数据继续嵌入和版本化；SDK Adapter 可在未来只读匹配用户本地安装的 SDK，并输出 PinMux/Device Tree 诊断，但不捆绑 SDK；专用 IBIS 后端可通过稳定 L4 接口消费获授权模型。任何路径都不能声称 ngspice 可运行 RK3576 固件。

## 来源、许可证与再分发

作者必须确认复制、转换和再分发符号、引脚表、模型与文档的权限。公开 datasheet URL 只是来源证明，不自动授予再分发权。尽量使用 SPDX 标识并保留署名；禁止嵌入厂商 SDK 或受限模型。仓库三个夹具均为 SugarEDA 虚构测试器件，以 CC0-1.0 发布，不含真实厂商引脚表或受限制数据。
