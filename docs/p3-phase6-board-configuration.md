# P3 第六阶段：工程内板级配置与项目级检查

本阶段把已经通过结构校验的厂商无关配置 IR 绑定到逻辑器件实例，并随 `.sugeda` schema v4 工程保存。它补齐了此前只读检查流程中“关闭窗口后配置丢失、无法做项目级完整性检查”的缺口。

这仍然不是通用 Device Tree、SDK 或寄存器配置生成器。工程只保存 SugarEDA 的规范化 IR，不执行脚本，不保存原始绝对路径，也不捆绑厂商 SDK。

## schema v4 数据

`Project.boardConfigurations` 是可选读取、统一写回的数组。旧 v4 工程缺少该字段时按空数组读取，不增加 schemaVersion：

```json
{
  "id": "b8bdbe06-9362-4b9b-8b80-a9b202c6f807",
  "logicalInstanceId": "9a577b43-c02f-4018-ac7c-9df84a46423c",
  "sourceFormat": "deviceTreeSubset",
  "sourceName": "test-mcu-valid.sugareda.dts",
  "sourceSha256": "64 lowercase hexadecimal characters",
  "config": {
    "formatVersion": 1,
    "id": "org.sugareda.test.board.valid",
    "name": "SugarEDA Test Board",
    "source": "SugarEDA self-contained test data",
    "license": "CC0-1.0",
    "target": {
      "packId": "org.sugareda.test.mcu",
      "packVersion": "1.0.0",
      "deviceId": "stmcu24",
      "variantId": "industrial"
    },
    "pinMux": [],
    "bootStraps": []
  }
}
```

每个逻辑器件实例最多绑定一个配置。重新导入会保留配置实体 ID 并替换内容，因而 UI 选择和撤销历史稳定。目标器件包 ID、精确版本、器件、变体必须与实例一致；结构或目标绑定错误不会进入工程。PinMux 等语义错误允许保存，以便项目检查面板持续显示并定位问题。

## 安全与生命周期

- JSON 和受限 DTS 输入最大 1 MiB；继续使用各自独立的严格解析器和资源上限。
- 仅持久化文件名、SHA-256 和规范化 IR；不持久化原始路径、include、URL 引用或脚本。
- 最多保存 4,096 个板级配置，配置 UUID、逻辑实例和来源哈希均验证。
- 复制完整逻辑器件时配置会生成新 UUID 并绑定到新实例；删除最后一个 symbol unit 时孤儿配置随逻辑实例清理。
- 导入、替换、移除配置和移除未使用器件包均进入同一个 Project 快照式撤销/重做栈。
- 器件包仍被任何逻辑实例使用时拒绝移除。移除包不会自动删除 SPICE 库，因为库可能被普通模型元件或其他包共享。

## 项目级检查

底部“板级配置 / Board Config”面板调用 Rust 权威检查器：

- 对所有已保存配置重新执行相同的 `device-config.*` 规则；
- 对具有 PinMux 或 `bootConfiguration` 元数据、但尚未绑定配置的实例报告稳定 code `board-config.missing`；
- 显示绑定进度、来源格式、文件名和内容哈希摘要；
- 点击问题按逻辑实例和 `pinId` 定位到实际承载引脚的 symbol unit；
- 可移除绑定并通过 Undo 恢复。

## 模块边界

- `board_config/types.rs`：持久化实体和项目级报告 DTO。
- `board_config/source.rs`：受限文件读取、格式路由、文件名和哈希。
- `board_config/validation.rs`：工程引用、唯一性、目标绑定和上限。
- `board_config/checker.rs`：项目级检查编排，不复制配置语义规则。
- `device_config/*`：共享 IR 的结构与语义权威来源。
- `device_tree_adapter/*`：只负责把严格 DTS 子集转换为共享 IR。
- `board-configuration-panel.tsx`：项目级报告展示与用户动作。
- `device-config-location.ts`：逻辑实例、单元与引脚的纯定位函数。
- `app.tsx`：只持有面板状态并编排命令，不实现解析或规则。

## 明确边界

本阶段没有实现 IBIS/S 参数求解、通用 DTS/DTSI、厂商 SDK 解析、Device Tree 生成、寄存器代码生成或固件/操作系统仿真。获授权的未来 Adapter 必须作为独立模块把输入翻译为同一 IR；RK3576 不会成为核心代码特例。
