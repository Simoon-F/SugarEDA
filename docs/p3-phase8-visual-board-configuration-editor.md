# P3 第八阶段：可视化板级配置编辑器

本阶段把此前的配置导入/检查能力扩展为工程内可视化编辑流程。用户从底部“板级配置”面板选择逻辑器件，按 DevicePack 元数据设置 PinMux、启动绑带和电压域；React 只维护临时草稿，Rust 始终负责格式、目标和语义校验。

## 使用流程

1. 将声明 L5 元数据的 DevicePack 器件放入原理图。
2. 打开“板级配置”，选择“编辑配置”。
3. 选择逻辑器件；多单元符号共享同一个配置目标。
4. 在 PinMux 页按引脚分组搜索、筛选和选择合法复用功能。
5. 在“启动与电压”页设置必需绑带和允许范围内的电压。
6. Rust 实时返回稳定 code 与中英文诊断；配置有效后“应用到工程”。
7. 已应用配置可导出为 `.device-config.json` 或 `.sugareda.dts`。

应用是单个 Workspace 快照事务，因此一次 Undo 会完整恢复应用前的板级配置。工程继续使用 schema v4；没有引入灰度开关或替代 schema。

## 模块边界

### Rust

- `board_config/editor.rs`：逻辑实例目标绑定、草稿校验、规范化和持久化实体构造。
- `board_config/export.rs`：确定性 JSON 与受限 DTS 写入、扩展名检查和原子文件替换。
- `device_config/*`：唯一的格式与语义规则权威来源；编辑器不复制检查算法。
- `application.rs`：继续只管理工程快照、Undo/Redo 与状态，不包含 PinMux 子模块代码。

### React

- `board-configuration-draft.ts`：纯草稿创建、不可变更新、规范化和差异统计。
- `board-configuration-editor.tsx`：对话框状态、异步 Rust 校验、应用和导出编排。
- `board-configuration-pinmux.tsx`：分组筛选和固定行高虚拟列表，大型器件只渲染可视区域。
- `board-configuration-boot-voltage.tsx`：启动绑带与电压域表单。
- `board-configuration-metadata.tsx`：名称、来源、许可证和只读目标身份。
- `board-configuration-validation.tsx`：目标摘要、配置页导航和 Rust 诊断列表。
- `board-configuration-editor-footer.tsx`：草稿差异、应用与导出动作。
- `board-configuration-discard-dialog.tsx`：切换目标或关闭时的未应用草稿拦截。

## 权威校验与持久化

- 220 ms 防抖后把完整草稿送入 Rust；异步序列号会丢弃过期结果。
- Rust 先验证 IR 上限和字符串，再验证逻辑实例、器件包、器件与变体身份，最后执行 PinMux、启动、电压和 DevicePack 结构化规则。
- 可视化编辑器只允许写入语义有效的草稿；文件导入仍可保存语义错误配置，便于检查外部输入。
- 写入前按 `pinId`/`domainId` 排序，使用规范化 JSON 计算 SHA-256；不保存临时路径。
- 替换同一实例的配置时保留原配置 UUID。

## 导出安全

JSON 和 DTS 都从工程中的规范化配置生成，不读取原始导入文件。导出使用同目录临时文件和原子替换，并返回字节数与 SHA-256。DTS Writer 只产生 SugarEDA 白名单子集；输出已在 Rust 测试中由现有独立 Lexer/Parser/Converter 回读。

它不是通用 Device Tree 生成器，不产生 include、phandle、寄存器地址、SDK 调用或厂商属性。导出也不会运行脚本或访问 DevicePack 外部引用。

## 大型器件性能

PinMux 列表使用固定行高窗口化：DOM 仅保留视口行和少量 overscan，搜索和分组筛选基于 DevicePack 的 `alternateFunctions`。前端纯模型测试覆盖 1,000 个虚构可复用引脚；真实大型 SoC 数据仍使用仓库内 CC0 SugarEDA 测试包，不包含受限制厂商数据。

## 本阶段边界

- 不解析或捆绑任何厂商 SDK。
- 不生成厂商寄存器代码或通用 DTS/DTSI。
- 不实现 IBIS/S 参数求解器、固件或操作系统仿真。
- 不硬编码 RK3576、UART、SPI 等器件或协议语义；所有可选项和规则均来自 DevicePack。
