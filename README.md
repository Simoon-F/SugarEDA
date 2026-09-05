<div align="center">
  <img src="src-tauri/icons/128x128.png" width="88" alt="SugarEDA icon" />
  <h1>SugarEDA</h1>
  <p><strong>专注于原理图编辑与 SPICE 仿真的跨平台桌面工作台。</strong></p>
  <p>Rust 负责工程模型与仿真边界，React + Canvas 提供紧凑、顺滑的工程界面。</p>
</div>

> 当前版本：`0.2.0 Alpha`。项目文件可读、可迁移，但仍建议为重要设计保留版本控制或外部备份。

## 已实现

### 原理图编辑

- 电阻、电容、电感、电压源、电流源、接地与网络标签。
- 网格吸附、缩放、平移、框选、旋转、删除和正交布线。
- 导线交点与 T 型连接节点、拐点增删、端点重接和线段整形。
- 元件移动时自动拉伸已连接导线。
- 元件与导线复制、粘贴、快速复制及方向键微调。
- 悬空引脚、断线、未连接标签直接在画布标红。
- 导入并随项目嵌入二极管、BJT、MOSFET 和子电路 SPICE 模型。

### 仿真与测量

- Operating Point、Transient、DC Sweep 与 AC Sweep。
- 运行前检查接地、引脚、网络标签、探针和分析参数。
- 检查错误可点击，并自动定位到画布中的对应元件。
- 从已有网络选择电压/电流探针，无需手写表达式。
- 多套仿真配置可新增、切换、重命名和删除。
- 明确区分网表生成成功与 ngspice 计算成功。
- 波形双游标、差值、频率、最大值/最小值、相位和 CSV 导出。

### 工程可靠性

- 编辑后防抖自动保存恢复副本；异常退出后启动时可恢复或放弃。
- 新建、打开和关闭时统一处理未保存修改：保存并继续、放弃或取消。
- 最近项目列表会标记已移动/删除的文件，并可直接清理失效记录。
- `.sugeda` 使用带版本号的可读 JSON；正式保存和恢复数据均采用临时文件原子替换。
- 3,000 元件大型原理图性能回归测试与视口空间索引。
- 基于 `tauri-driver` 的真实桌面自动化，覆盖启动、编辑、Rust 自动保存和未保存拦截。

## 快速开始

### 环境要求

- Node.js 22+
- Rust stable
- [Tauri 2 平台依赖](https://v2.tauri.app/start/prerequisites/)
- 从源码构建 ngspice 时还需要 C/C++ 编译器、`bash`、`make`、`curl` 和 `tar`

```bash
npm install
npm run tauri dev
```

只查看界面可以运行：

```bash
npm run dev
```

浏览器预览使用内存项目，不提供文件读写与真实 ngspice 仿真；桌面应用始终以 Rust 工作区为数据源。

### 打包内置 ngspice

macOS/Linux 可以从校验过的 ngspice 47 源码构建无界面版本：

```bash
npm run build:ngspice
npm run tauri build
```

Windows 构建使用受信任的自包含 payload：

```bash
npm run prepare:ngspice -- /absolute/path/to/ngspice-payload
npm run tauri build
```

开发时也可以指定本地引擎：

```bash
export SUGAREDA_NGSPICE_PATH="/absolute/path/to/ngspice"
npm run tauri dev
```

解析顺序为：界面指定路径 → `SUGAREDA_NGSPICE_PATH` → 应用内置引擎 → 系统 `PATH`。

## 常用操作

| 操作                   | 快捷键                            |
| ---------------------- | --------------------------------- |
| 新建 / 打开 / 保存     | `Cmd/Ctrl+N` / `O` / `S`          |
| 撤销 / 重做            | `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` |
| 复制 / 粘贴 / 快速复制 | `Cmd/Ctrl+C` / `V` / `D`          |
| 微调选择               | `方向键`；按住 `Shift` 按网格移动 |
| 删除选择或选中拐点     | `Delete` / `Backspace`            |
| 导线切换 L 型方向      | 绘制或选中导线时按 `Tab`          |
| 增加导线拐点           | 双击导线                          |
| 仿真检查               | `Shift+F4`                        |
| 运行 / 停止仿真        | `F5` / `Shift+F5`                 |

## 数据安全模型

正式项目保存到用户选择的 `.sugeda` 文件。编辑过程中，桌面端在最后一次变更约 900 ms 后写入独立恢复副本；成功正式保存、新建或打开其他项目后会清除旧恢复副本。若进程异常中止，下一次启动会显示恢复内容、来源路径、保存时间和元件/导线数量。

恢复副本和最近项目索引位于操作系统为 `com.simonf.sugareda` 分配的应用数据目录，不会覆盖正式项目文件。

## 验证

日常完整检查：

```bash
npm run format
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

单独运行大型原理图性能门槛：

```bash
npm run test:performance
```

真实桌面自动化使用编译后的 Tauri 应用和系统 WebView：

```bash
cargo install tauri-driver --locked
npm run test:desktop
```

原生 `tauri-driver` 支持 Linux/Windows；仓库中的 `Quality` 工作流在 Linux + Xvfb 下实际执行。macOS 本地运行会明确跳过该脚本，因为系统 WKWebView 没有可供原生驱动使用的 WebDriver。

## 代码结构

```text
src/                         React 工作台、Canvas 原理图和波形界面
src-tauri/src/application.rs Rust 编辑命令、Undo/Redo 与工作区状态
src-tauri/src/project.rs     项目校验和原子保存
src-tauri/src/reliability.rs 自动恢复与最近项目
src-tauri/src/netlist.rs     电气检查和确定性 SPICE 网表
src-tauri/src/simulation.rs  ngspice 进程、取消和结果解析
test/                        单元、几何、波形与大型图性能测试
scripts/desktop-smoke.mjs    真实桌面 WebDriver 冒烟测试
```

## 当前边界

- 当前一次编辑一张原理图。
- 波形数据仍通过 Tauri JSON 命令边界传输；后续可替换为通道或二进制结果文件。
- Windows/macOS 已配置桌面打包；Linux 主要用于自动化测试，发布包仍需单独验证。
- 外部 `.include`、任意引脚映射、IBIS、加密厂商模型和自动下载尚未实现。

---

**English summary:** SugarEDA is an open-source Tauri 2 schematic capture and SPICE simulation workbench. It includes structured electrical preflight checks, network-based probes, dual-cursor waveform measurements, atomic project files, crash recovery, recent projects, large-sheet performance coverage, and real desktop WebDriver smoke tests.
