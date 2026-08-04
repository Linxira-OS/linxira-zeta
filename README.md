# Zeta

Zeta 是一个开箱即用的编码代理（coding-agent）发行版，基于
[Oh My Pi](https://github.com/can1357/oh-my-pi)（OMP）运行时构建。它保留 OMP
的终端界面、工具系统、会话管理、MCP 协议、浏览器自动化、子代理（subagent）和
Bun 工作流作为产品基线，而非以扩展方式重新实现。

[Pi](https://github.com/earendil-works/pi) 是上游功能来源，而非第二个运行时。
Zeta 在 Pi 的改进能提升基于 OMP 的产品体验、且不破坏 OMP 架构设计的前提下，
选择性地移植 Pi 的变更。

## 仓库结构

```text
zeta/
├── packages/       TypeScript 包与 coding-agent CLI（核心工作区）
├── crates/         Rust 原生 crate（文本搜索、grep 性能关键路径）
├── python/         RPC 与 Robomp 服务
├── docs/           项目文档与上游同步策略
├── web-ui/         独立浏览器界面（自有 npm 依赖与锁文件）
└── temp/           本地参考克隆（不纳入版本控制）
```

`web-ui/` 刻意置于根 Bun 工作区之外。它拥有独立的 npm 依赖、锁文件与开发规则，
详见 `web-ui/AGENTS.md`。

内部包名采用 `@zeta/*` 作用域，版本号保持 `1.0.0`。CLI 入口为 `zeta` 命令。

## 当前上游基线

| 上游项目 | 基线版本 | 角色 |
| --- | --- | --- |
| [OMP](https://github.com/can1357/oh-my-pi) | `v17.2.8` (`5039b33a`) | 直接运行时父项目 |
| [Pi](https://github.com/earendil-works/pi) | `977ec83` | 语义化功能移植来源 |
| [OMP Web](https://github.com/17380936778/omp-web) | `c71edcb` | `web-ui/` 源码快照来源 |
| [Pi Web](https://github.com/agegr/pi-web) | `248aaf4` | Web 功能移植来源 |

详见 [docs/upstream-sync.md](docs/upstream-sync.md) 了解分支模型、基线定义与具体集成流程。

## 开发

根应用使用 Bun。源码检出需要安装工作区依赖和本地原生插件后 CLI 才能运行。

```sh
bun setup
bun dev
bun check
```

Web UI 独立开发：

```sh
cd web-ui
npm install
npm run dev
```

不要在 `web-ui/` 内运行根工作区命令，也不要在其开发服务器运行时执行 Next.js
生产构建。

## 上游同步策略

- 通过 `sync/omp/<release>` 分支同步 OMP 发布版本。
- 通过聚焦的 `port/pi/<scope>` 分支移植 Pi 变更。绝不将 `pi-upstream/main`
  原始合并到 Zeta。
- 从 OMP Web 以源码快照方式更新 `web-ui/`；通过 `port/pi-web/<scope>` 分支
  移植 Pi Web 变更。
- `temp/` 保持本地且不纳入版本控制，仅作为参考材料，绝非提交依赖。

## 许可证与致谢

Zeta 派生自 OMP，OMP 派生自 Pi。本项目深表感谢以下上游项目及其维护者：

- **[Pi](https://github.com/earendil-works/pi)** — 编码代理架构的奠基项目，由 [@mariozechner](https://github.com/mariozechner) 创建
- **[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)** — Zeta 的直接运行时父项目，由 [@can1357](https://github.com/can1357) 维护
- **[Pi Web](https://github.com/agegr/pi-web)** — 浏览器界面架构的原始实现，由 [@agegr](https://github.com/agegr) 创建
- **[OMP Web](https://github.com/17380936778/omp-web)** — Web UI 的直接上游快照，由 [@17380936778](https://github.com/17380936778) 维护

移植代码时请保留上游声明与许可证。本项目以 [LICENSE](LICENSE) 中的 MIT 许可分发。
