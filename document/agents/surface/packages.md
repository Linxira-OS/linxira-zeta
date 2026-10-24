<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。包清单与插件目录约定。 -->

# 包清单与插件目录

### Package Structure

| Package                 | Description                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `packages/ai`           | Multi-provider LLM client with streaming support                                        |
| `packages/catalog`      | Model catalog: bundled models.json, provider descriptors, model identity/classification |
| `packages/agent`        | Agent runtime with tool calling and state management                                    |
| `packages/coding-agent` | Main CLI application (primary focus)                                                    |
| `packages/tui`          | Terminal UI library with differential rendering                                         |
| `packages/natives`      | Bindings for native text/image/grep operations                                          |
| `packages/stats`        | Local observability dashboard (`stats` 子命令；`zeta-c` 连字符 bin 已删除)              |
| `packages/omptype`      | ArkType-compatible schema validation with a lazy JIT runtime                            |
| `packages/utils`        | Shared utilities (logger, streams, temp files)                                          |
| `crates/pi-natives`     | Rust crate for performance-critical text/grep ops                                       |
| `packages/channels`     | IM channel adapters (WeChat/Feishu/Telegram) + ChannelHost coordinator, embedded in `zeta serve` |
| `packages/wire`         | RPC/event wire protocol between clients (sdk) and the agent runtime                    |
| `packages/mnemopi`      | Memory/recall subsystem consumed by the agent runtime                                   |
| `packages/metaharness`  | Eval harness plumbing (internal; rides the version line, rarely user-visible)          |
| `packages/browser-relay`| Browser relay companion package for the web extension                                   |
| `packages/collab-web`   | Collaboration web surface assets                                                        |
| `packages/typescript-edit-benchmark` | Internal TS edit-path benchmark (dev only)                                   |

---

### `plugins/` — 插件目录（两层）

插件代码/登记一律放 `plugins/`，不放 `packages/`（`packages/` 是随产品一起
构建发布的运行时包；插件是可独立安装的扩展单元）。完整体系见
`document/plugin-system.md`。

- **`plugins/official/<plugin-id>/`** — 第一方插件：Zeta 移植/维护的开源插件
  或自研插件，源码入库。依赖一律改写为 `@linxiraos/*`（上游
  `@earendil-works/*` 的改写映射见 `plugins/official/README.md`）。先例：
  `pi-messenger`（源自 nicobailon/pi-messenger，peer/源码已改写并迁入）。
- **`plugins/community/`** — 社区插件层：只放机器可读的指针文件
  （`<plugin-id>.json`/`.toml`：source/publish/install/compat/category），
  不放代码。
- **惯例**：每个 official 插件目录自带 `plugin.json`（清单）、`README.md`、
  `tests/`；层级文档固定两份——`plugins/official/README.md` 是官方插件标准
  模板与依赖改写规范，`plugins/official/INDEX.md` 是官方插件登记表（随构建期
  快照打包分发，新增/变更插件必须同步登记）；`plugins/community/INDEX.md` 是
  社区指针登记表。收录新插件：先登记 `INDEX.md`，再落目录/指针文件。

