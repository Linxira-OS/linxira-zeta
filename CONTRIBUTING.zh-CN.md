# 为 Zeta 做贡献

[English](CONTRIBUTING.md) · **简体中文**

Zeta 是 Linxira 维护的下游运行时发行版。欢迎 pull request；请保持聚焦，并准备好
解释和维护你的改动。公开的产品与仓库文档在 [`rep-docs/`](rep-docs/) 与
[`docs/`](docs/)；内部工程记录在 [`document/`](document/)。

## 开始之前

### 报告到哪里

按问题复现的位置路由。完整协议见
[`document/maintenance-ownership.md`](document/maintenance-ownership.md)。

| 领域 | 报告到哪里 |
| --- | --- |
| OMP 运行时、工具、模型或 TUI；上游 bot 更新 | <https://github.com/Linxira-OS/linxira-zeta/issues> |
| 不带 Zeta 分支也能复现的 OMP Studio renderer 或 host-contract 缺陷 | <https://github.com/the-snowpear/omp-studio/issues>（Zeta 独有的缺陷按 [`document/maintenance-ownership.md`](document/maintenance-ownership.md) 的归属路由处理） |
| TermIDE 终端/编辑器/LSP/DAP | <https://github.com/termide/termide/issues> |
| Zeta 自有行为：Z Work Studio、server/Studio host、桌面版、IM、CLI/TUI 产品行为、`zetaide` 差异、`android/`、插件、文档 | 本仓库 issue tracker |
| 安全漏洞 | 通过 [`SECURITY.md`](.github/SECURITY.md) 的私有 advisory，绝不使用公开 issue 或 pull request |

上游 bot 分诊与发布同步是维护者流程：同步按需进行，且只通过点名的官方 release
tag 进入 Zeta，绝不合并上游分支。集成的运行时源码为 OMP `v18.20.0`。OMP Studio
`v0.2.1` 是点名的集成目标；其源码谱系已集成，完整验收与 CI 仍待完成。OMP Web 已
冻结，不是报告或同步面；Pi / Pi Web 是语义移植来源，不是原始合并来源。不应要求
上游接管 Zeta 的产品行为或使用差异。

### 小改动

缺陷修复、文档更新和范围明确的改进可以直接提交 pull request。

### 大改动

新子系统、较大的 UI 改动、新依赖或跨多个包的改动，先开 issue 再写实现。先说明
问题与预期形态。pull request 不能替代这次讨论，先讨论也不保证合并。

不要为同一项工作同时开 issue 和 pull request。只选一条路径：报告问题，或提交
经过评审的改动。

## AI 辅助贡献

AI agent 是工具，不是无人值守的贡献者。提交带 agent 辅助工作的 pull request 前，
你必须：

- 把 agent 限制在约定范围内，并拒绝无关改动；
- 评审每个改动文件并理解最终行为；
- 自己运行相关检查并实际验证改动后的行为；以及
- 在评审之后才提交，不能让 agent 自主发布。

无论代码由谁或什么生成，你都要对它负责。

## Pull request 要求

每个 pull request 正文**必须包含至少一句你自己写的、用你自己的话**解释改了什么
以及为什么。生成的摘要、粘贴的 agent 转录或清单本身不满足这一要求。

你**必须验证改动按预期工作**。相关时应当运行 `bun check` 与自动化测试，但它们
不能证明行为可用。自己运行改动路径，并在 pull request 中报告确切场景与结果：

- 缺陷修复：复现缺陷，并确认同一复现不再失败；
- 功能：启动产品并端到端使用该功能；以及
- UI 改动：实际交互并检查渲染结果。

只写“`bun check` 通过”不足以作为验证。Rust 改动使用 `bun run test:rs`；不要直接
调用 `cargo test`。编码 Agent 的开发命令与仓库结构见
[`packages/coding-agent/DEVELOPMENT.md`](packages/coding-agent/DEVELOPMENT.md) 与
[仓库与开发](rep-docs/development.zh-CN.md)。

每个 pull request 只做一个逻辑改动。避免无关清理、顺手重构、生成噪声或约定范围
之外的功能。不要为了让检查变绿而删除测试、弱化断言或跳过检查。

## CI

GitHub CI 是分层的：pull request 与非 main 的 dispatch 走快路径（不做
Rust/cross/native 编译），main push 运行完整门，release 在源提交变绿后跳过测试
扇出。确切 job 地图见 [`document/ci-tiers.md`](document/ci-tiers.md)。贡献者不必
在本地复现每个环境；但必须运行与改动路径相关的检查。

Gitea 镜像供项目自己的 Linux 主机使用。GitHub Actions 是贡献门。

## 覆盖率

覆盖率是被测量和评审的，不由阈值强制。当前基线、逐包限制与已加载文件注意事项见
[仓库与开发](rep-docs/development.zh-CN.md#覆盖率)。

对运行时行为改动与发布候选，维护者运行 **Coverage** workflow，并把
`coverage-lcov` artifact 附到评审或发布记录。某个包的行覆盖率下降超过 0.5 个
百分点需要解释。不要把 `coding-agent` 核心抽样当成整个包。Coverage workflow 只
出报告；常规 CI 仍是测试门。

## 贡献许可

Zeta 采用按目录划分的许可：`main/` 为 AGPL-3.0，`main/` 之外的全部路径——包括
`packages/`、`crates/`、`sdk/`、`termide/`、`editor/`、`web-app/`、`desktop/`、
`web-ui/`、`docs/`、`document/` 与 `rep-docs/`——为 MIT。提交你有权按适用许可
授权的作品。第三方或 vendored 代码保持其自身许可与归属；不要重新许可。许可文本
不作翻译。

## 评审

维护者评审提交的行为以及贡献者对它的理解，而不是生成代码的数量。你自己回应评审
意见，只应用你检查过的建议。

跳过必要讨论、缺少人工撰写的说明、包含未评审 agent 输出或混杂无关改动的 pull
request 可能被关闭。

安全问题请通过 [`SECURITY.md`](.github/SECURITY.md) 的私有通道报告，不要走公开
issue 或 pull request。advisory 表单：
<https://github.com/Linxira-OS/linxira-zeta/security/advisories/new>。

[English](CONTRIBUTING.md) · **简体中文**
