# P3 第五阶段：受限 Device Tree Adapter 与画布定位

本阶段实现一个独立、只读的 Device Tree 子集 Adapter。它只接受 SugarEDA 自定义的独立 `.sugareda.dts` 文件，把声明转换为既有厂商无关配置 IR，再交给同一 Rust 校验器处理。

这不是通用 DTS/DTSI 解析器，不读取厂商 SDK，也不会把普通 Linux Device Tree 描述成已经兼容。

## 受支持格式

```dts
/dts-v1/;

/ {
  sugareda-device-config {
    compatible = "sugareda,device-config-v1";
    config-id = "org.example.board.config";
    config-name = "Example configuration";
    source = "Board maintainer-authored test data";
    license = "CC0-1.0";
    pack-id = "org.example.devices";
    pack-version = "1.0.0";
    device-id = "example-mcu";
    variant-id = "industrial";

    pinmux {
      assignment@0 { pin = "pa0"; function = "UART1_TX"; };
    };

    boot-straps {
      strap@0 { pin = "boot0"; value = "pull-down"; };
    };
  };
};
```

`variant-id`、`pinmux` 和 `boot-straps` 可省略。启动值只支持 `low`、`high`、`pull-down`、`pull-up`、`external`。所有其他根节点、子节点和属性都会被拒绝。

## 安全边界

- 文件必须以 `.sugareda.dts` 结尾，最大 1 MiB、最多 50,000 个 token。
- 最多转换 4,096 个 PinMux 节点和 512 个启动绑带节点。
- 只支持 UTF-8、字符串值、花括号和固定节点词汇。
- 明确拒绝 `/include/`、DTS overlay、phandle、标签引用、宏、数值数组、字节数组、任意属性及尾随内容。
- 允许普通行注释和块注释；字符串只允许 `\"` 和 `\\` 转义。
- Adapter 不解析 SDK、不访问第二个文件、不执行预处理器或外部命令。
- 输入路径、转换结果和报告不写入 `.sugeda`，工程 schema 保持 v4。

词法与结构错误使用 `device-tree.*` 稳定 code，并包含行列位置及中英文说明。转换成功后，PinMux 和启动规则仍使用 `device-config.*` code，因此 JSON 和 DTS 输入不会产生两套相互漂移的电气规则。

## 画布定位

配置检查器会列出当前工程中匹配器件包哈希和器件 ID 的逻辑实例。用户选择实例后，前端定位器按诊断 `pinId` 搜索该实例已放置的 symbol unit：

- 找到引脚时，“定位单元”会关闭器件包管理器、选择组件并让画布居中。
- 大型多单元器件会定位到实际承载该引脚的 POWER、GPIO、DDR、USB 等单元，而不是固定选择第一个单元。
- 若对应单元尚未放置，按钮明确显示“单元未放置”，不会错误定位到其他实例。

## 模块边界

- `device_tree_adapter/lexer.rs`：UTF-8、安全字符、注释、字符串和 token 上限。
- `device_tree_adapter/parser.rs`：固定 DTS 子集语法和节点/属性白名单。
- `device_tree_adapter/converter.rs`：结构数据到通用 DeviceConfig IR 的转换与源码位置。
- `device_tree_adapter/mod.rs`：文件限制、阶段编排和报告。
- `device_config/ir.rs`：JSON 与 DTS Adapter 共用的内部配置结构。
- `device-config-location.ts`：逻辑实例、symbol unit 与引脚的纯函数映射。
- `device-config-result.tsx`：Adapter/配置诊断和画布定位按钮。

仓库中的合法与非法 `.sugareda.dts` 夹具都是 SugarEDA 虚构测试数据，以 CC0-1.0 发布，不包含真实厂商引脚或受限 SDK 内容。

## 后续方向

下一阶段可以为获授权来源实现独立的 Adapter profile，把特定工具的导出结果转换到此 IR。每种输入格式必须保持独立解析器、资源上限和来源记录；不得扩展本解析器去执行 `dtc`、SDK 脚本或厂商二进制。
