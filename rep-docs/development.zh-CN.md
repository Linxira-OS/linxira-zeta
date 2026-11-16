# 仓库与开发

[English](development.md) · **简体中文**

本页说明仓库布局、文档树、开发命令与实测覆盖率基线。产品行为与受支持平台见
[产品与平台](product.zh-CN.md)；维护与上游政策见[维护与归属](ownership.zh-CN.md)。

## 分层

产品分四层，只有一条规则：**运行时依赖它上面的任何东西，前端之间互不依赖。**
HTTP 网关是适配器，不是中枢——它存在是为了让浏览器能和运行时对话，而不是别的
东西需要它。完整契约见 `document/architecture-layers.md`；这里是方向性说明。

| 层 | 位置 | 做什么 |
| --- | --- | --- |
| 核心运行时 | `packages/coding-agent/src/`（以及 `packages/agent`、`packages/ai`、`packages/tui`、`packages/channels`、`packages/stats`） | 会话、工具、扩展/插件、记忆、技能、IRC/mesh。进程内运行；无 HTTP、无 UI。 |
| Host | `packages/coding-agent/src/server/`（`zeta-server.ts`）、`packages/coding-agent/src/channels/` | 把会话接到工作区、IM 频道、路由器、配置与默认工作区。这里不服务 HTTP。 |
| 前端 | `web-app/`（Z Work Studio，浏览器）、`packages/coding-agent/src/commands/`（CLI/TUI）、`termide/`（`zetaide`） | 每个都是 Host 的客户端。IM bot 也是前端。 |
| HTTP 适配器 | `packages/coding-agent/src/server/web-gateway/` | Host 之上的 REST/SSE/WS。`zetacode serve` 启动它；浏览器 UI 与远程客户端消费它。 |

## 仓库地图

| 路径 | 内容 |
| --- | --- |
| `packages/` | 已发布的运行时包（`@linxiraos/*`）：coding-agent、ai、agent、tui、catalog、stats、channels、wire、mnemopi、natives、utils、omptype、browser-relay。 |
| `main/` | 暂停的 Rust 线，独立 Cargo workspace：TUI（`crates/zeta-main`）、egui GUI（`crates/zetawork-gui`）、`crates/sysmon`。不是产品面；release 不构建它。 |
| `termide/` | vendored TermIDE 面板库——两个工作台都嵌入的面板——加上 `zetaide` 入口（`@linxiraos/ide`）。对快照的偏离登记在 `termide/VENDOR.md`。 |
| `editor/` | 内置编辑器面板的 npm 面。载荷是 `termide-editor` 二进制；包不声明命令。 |
| `crates/` | 以原生 addon 编译的 Rust 运行时 crate（`pi-natives`、`pi-ast`、`pi-diff`、`pi-builtins` 等），由 Bazel 构建。 |
| `web-app/` | **Z Work Studio**：产品渲染器（Vite + React），独立 npm 工程。随 `@linxiraos/zeta` 出货到 `dist/web-app`。 |
| `web-ui/` | 冻结的 OMP Web 快照（2026-11-05）：不构建、不发布、不加功能。不是当前渲染器。 |
| `desktop/` | Electron 与浏览器版的桌面打包和外壳。见 `docs/desktop-app.md`。 |
| `plugins/` | `official/` 第一方插件（源码在树内，`INDEX.md` 登记）与 `community/` 指针文件。 |
| `docs/` | 随产品打包的运行时文档（`zeta://docs`）。 |
| `document/` | 内部工程文档：架构契约、合并手册、发布机制、路线图。永不打包。 |
| `rep-docs/` | 面向前仓库读者的公开文档：产品、开发、维护与归属；中文 README 也在这里。不打包。 |
| `scripts/` | 构建、发布、打包与 CI 运行的机械守卫。 |
| `sdk/` | 用于嵌入运行时的协议 SDK（`rust/`、`python/`、`go/`）。 |
| `python/robomp/` | 容器化 Agent 运行器。 |
| `infra/`、`bazel/`、`nix/`、`patches/`、`lsp/`、`skills/`、`assets/`、`types/` | 构建基础设施、工具链文件、补丁集、LSP 服务器表、内置技能、图像资产、环境类型 shim。 |

## 插件层

插件是 TypeScript，但它*显示*在哪一层是选择出来的。按界面需要选择，而不是按
插件用什么语言写：

| 层 | 面 | 用来做什么 |
| --- | --- | --- |
| 行为 | 任意前端（工具、命令、钩子、消息） | agent 执行的工作。没有谁渲染它；每个客户端表现一致。 |
| 面板 | 尚无宿主 | Z Work Studio 今天不渲染插件面板（`web-app/` 里没有声明式面板或 HTML 页宿主）。需要界面的插件通过 agent 自己的工具触达。 |

`zetaide` 带有 TermIDE 自己从 0.49 vendor bump 来的上游插件层，与 Zeta 的插件面
分离。

## 文档树

| 树 | 读者 | 是否打包 | 放什么 |
| --- | --- | --- | --- |
| `docs/` | 用户、运维、扩展作者 | **是**——通过 `zeta://docs` 提供 | 子命令、标志、工具、配置键、内部 URL 面、扩展 API |
| `document/` | 维护者与贡献者 | **否** | 架构、ADR、路线图、合并/发布流程、维护协议 |
| `rep-docs/` | 公开仓库读者 | **否** | 产品概览、仓库/开发指南、维护与归属 |

在树之间移动内容要清理所有交叉引用。已发布 CHANGELOG 条目不可变。权威路径规则见
`document/maintenance-ownership.md` §1。

## 开发

```sh
# TypeScript 与 Rust 的静态检查
bun check

# 仅编码 Agent 检查
bun --cwd=packages/coding-agent run check

# 聚焦测试
bun --cwd=packages/coding-agent test test/<file>.test.ts
```

从源码检出运行时，先安装依赖并构建原生 addon：

```sh
bun install
bun run build:native
bun run dev
```

Rust 改动使用 `bun run test:rs`；不要直接调用 `cargo test`。主应用位于
`packages/coding-agent/`。共享运行时包包括 `packages/ai/`、`packages/catalog/`、
`packages/agent/`、`packages/tui/` 与 `packages/natives/`。浏览器渲染器在
`web-app/`（独立 npm 工程）；暂停的 Rust 工作台在 `main/`，vendored TermIDE 树在
`termide/`。

贡献要求（包括端到端验证与人工撰写的 PR 说明）见
[`CONTRIBUTING.md`](../CONTRIBUTING.md)（[简体中文](../CONTRIBUTING.zh-CN.md)）。

## 覆盖率

覆盖率是被测量和评审的，不由阈值强制。首次实测基线（2026-11-03，本地 Windows，
一次性 LCOV 运行）为：

| 包 | 行覆盖率 | 函数覆盖率 | 触及的源文件 |
| --- | ---: | ---: | ---: |
| `packages/agent` | 88.0% | 83.5% | 100% |
| `packages/ai` | 89.9% | 92.3% | 98.3% |
| `packages/catalog` | 93.8% | 63.4% | 94.9% |
| `packages/tui` | 73.3% | 77.5% | 90.3% |
| `packages/utils` | 78.7% | 75.1% | 97.0% |
| `coding-agent` core | 29.7% | 23.2% | 66.7% |

五个支撑包合计 **81.2% 行 / 79.7% 函数**。`coding-agent` 只是**核心抽样**
（`test/session`、`test/session-manager`、`test/config`、`test/core`；1,003 个
测试）：完整 2,113 文件套件在覆盖率插桩下 40 分钟内没有跑完。不要把 29.7% 读成
整个包的数字。

Bun 的 LCOV 只包含测试实际加载过的源文件，因此这些数字是**已加载文件覆盖率**，
不是全仓库覆盖率。从未被导入的文件不在分母里；“触及的源文件”列是对重。Linux CI
的数字与这个 Windows 基线略有差异。

本地生成同样的报告：

```sh
cd packages/ai
bun test --coverage --coverage-reporter=lcov --coverage-dir=../../coverage/ai
```

维护者与贡献者必须在发布或覆盖率敏感合并前运行 **Coverage** GitHub Actions
workflow，并把 LCOV artifact 附到评审/发布记录。**Coverage** workflow 只出报告：
绿色只表示报告跑过，不表示所有测试通过；常规 CI 仍是测试门。某个包的行覆盖率
下降超过 0.5 个百分点需要解释。策略、当前缺口与 ratchet 规则见
[`.github/MAINTAINERS.md`](../.github/MAINTAINERS.md)。覆盖率是证据，不能替代
实际运行改动后的行为。

[English](development.md) · **简体中文**
