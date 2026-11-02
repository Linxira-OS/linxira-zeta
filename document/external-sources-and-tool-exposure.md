# 外部来源与工具暴露：标准、边界与门禁

> 状态：设计稿（2026-11-02）。未实现；条目登记在
> [`roadmap.md`](./roadmap.md) 的 P1「外部来源同意与工具暴露档位」。
> 本文回答三件事：哪些东西是 Zeta 的原生标准、外部 agent 的配置从哪一层
> 进来、默认给模型看多少工具。

## 0. 结论

1. **原生**：`.zeta/**`、`AGENTS.md`（含祖先目录与 `@import`）、内置 system
   prompt、内置工具/技能。这些是 Zeta 的标准，不是外来物。
2. **外来**：`.claude/**`、`CLAUDE.md`、`.codex/**`、`.gemini/**`、
   `.cursor/**`、`.windsurf/**`、`.cline/**`、`.opencode/**`、
   `.github/instructions`、`.vscode/mcp.json` 等。外来项目级来源**默认不加载**，
   必须有显式用户同意；用户级外来目录继续 opt-in。
3. **工具默认只暴露核心面**：引导页四档，默认高亮标准档；未启用工具不注册、
   不列目录；agent 只能请求开启，不能静默改自己的工具集。

## 1. 标准归属

判断标准是**路径归属**，不是文件名。同一个 `SYSTEM.md`，在 `.zeta/` 下是原生，
在 `.claude/` 下是外来。

| 路径 / 内容 | 归属 | 默认 | 说明 |
|---|---|---|---|
| `.zeta/config.yml`、`.zeta/settings.json` | 原生 | 加载 | 项目层原生配置 |
| `.zeta/SYSTEM.md`、`.zeta/SYSTEM_TEMPLATE.md`、`.zeta/APPEND_SYSTEM.md` | 原生 | 加载 | 只有原生路径可以替换/追加基础提示 |
| `AGENTS.md`（cwd 及祖先到仓库/home 边界） | 原生标准 | 加载 | 跨 agent 的仓库说明；不是“外来配置” |
| 内置 `prompts/system/system-prompt.md` | 原生 | 加载 | OMP 自己的提示词，见 §2 |
| 内置工具、内置 skills、`memory://` 等 | 原生 | 按设置 | — |
| `CLAUDE.md`、`.claude/CLAUDE.md` | 外来 | **不加载** | Claude Code 的说明文件 |
| `.claude/SYSTEM.md`、`.claude/SYSTEM_TEMPLATE.md` | 外来高危 | **永不自动** | 不允许活加载替换基础提示 |
| `.claude/settings.json`、`.codex` 设置 | 外来 | **不合并** | 不得进入 S0 项目层 |
| `.claude/{skills,commands,rules}` | 外来 | 不加载 | 同意后加载 |
| `.claude/{hooks,tools,extensions}` | 外来可执行 | 不加载 | 需逐项同意 + 内容哈希重确认 |
| `.claude/mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` | 外来 | 不连接 | 按服务器逐项同意 |
| `.codex/{skills,commands,prompts,extensions,settings}` | 外来 | 不加载 | 项目级同样默认关 |
| `.gemini/**`、`GEMINI.md`、`.cursor/**`、`.windsurf/**`、`.cline/**`、`.opencode/**`、`.github/instructions` | 外来 | 不加载 | 统一走来源开关 |
| `~/.zeta/**` | 原生 | 加载 | 用户级原生配置 |
| `~/.claude/**`、`~/.codex/**`、`~/.cursor/**`、`~/.gemini/**` | 外来用户级 | opt-in | 现状已如此；`CLAUDE_CONFIG_DIR` 例外，需启动提示 |

## 2. system prompt 的来源

| 内容 | 来源 | 证据 |
|---|---|---|
| 主 system prompt | **OMP 自己**，不是 Claude Code / Codex 的标准 | 最早在 `core/system-prompt.ts`（can1357，2026-01）；2026-01-11 迁移为 Handlebars 模板 `prompts/system/system-prompt.md`（`7faa151de0e`、`a82aa65ee6d`） |
| Codex 兼容指令 | `packages/ai/src/providers/openai-codex/prompts/codex-instructions.md` | 只用于 OpenAI Codex 接口兼容，不作为 agent system prompt |
| 仓库说明 | `AGENTS.md` | 作为项目上下文注入，与 system prompt 是两条路；算原生标准 |
| 外来 system | `.claude/SYSTEM.md` / `SYSTEM_TEMPLATE.md` | 通过 capability 发现；当前可替换基础提示，**本设计要砍掉** |

因此改 system prompt 属于**下游分叉**，必须单独评审，不能混在“外来来源加载”里。
外来 `SYSTEM.md` 即便用户想用，也只做“预览 + 复制到 `.zeta/SYSTEM.md`”的一次性
动作，不做活加载。

## 3. 配置怎么算

当前四层深合并，优先级从高到低：

| 层 | 来源 | 备注 |
|---|---|---|
| 运行时覆盖 | SDK / CLI / 会话 | 最高 |
| `--config` 叠加 | 命令行传入 | 只作用于本次 |
| 项目层 | `.zeta/config.yml`、`.zeta/settings.json`，以及**今天会合并的** `.claude/settings.json`、`.codex`、`.gemini` | 目录顺序 `.zeta` → `.claude` → `.codex` → `.gemini`；后读覆盖先读 |
| 全局层 | `~/.zeta/agent/config.yml`；外来用户目录仅开启后 | — |
| Schema 默认 | 代码定义 | 最低 |

补充：
- 原生 `.zeta` 的 `modelRoles` 在项目层最后再覆盖一次；`dropSettingsGroupShadows`
  防止外来文件用非对象值整组覆盖设置。
- 所有设置没有“只能全局”标记，项目层可覆盖任意键。这是外来 `settings.json`
  危险的原因，也是门禁必须放在能力层而不是 UI 的原因。
- 普通设置写入全局层；项目层目前只有模型角色有写入 API。仓库级来源开关需要
  补项目层写入接口，或直接写 `.zeta/settings.json`。
- `.zeta/` 在 `.gitignore` 中，`.zeta/settings.json` 默认是本机仓库配置；团队共享
  需显式 force-add。可执行来源的同意记录**不写仓库**，写用户目录。

## 4. 工具档位

引导页选择，默认高亮标准；无 TTY 时回落标准。

| 档位 | 工具 | 数量 |
|---|---|---|
| 超级简 | `read` `write` `edit` `bash` | 4 |
| 极简 | 超级简 + `web_search` | 5 |
| 标准（默认） | 极简 + `glob` `grep` `find` `task` `wait` `todo` `ask` | 12 |
| 完整 | 全部；LSP/AST/插件/渠道/MCP 按条件出现 | 按配置 |

未启用工具不注册、不进入 `xd://` 目录。`super_memory`、memory 工具、`learn`、
`manage_skill` 仍跟随后端与自动学习开关。

## 5. 工具开关覆盖

现状不是每个工具都有独立开关，也不应该给每个工具再加一个开关。

| 类别 | 工具 | 现有开关 |
|---|---|---|
| 核心 | `read` `write` `edit` | 无，始终核心 |
| 有开关 | `bash` `web_search` `glob` `grep` `find` `todo` `ask` `eval` `lsp` `ast_edit` `ast_grep` `debug` `github` `tea` `ida` `checkpoint` `canvas` `security_scan` `tracking_update` `channels` | 各自 `.enabled` |
| 无工具级开关 | `task` `wait` `mode` `time` `plugin_manager` `plugin_inspect` `ssh_exec` | 需档位/禁用列表 |

统一机制：新增 `tools.disabled: string[]`（用户级 + 仓库级），档位是它的预设展开；
最终生效 = 现有开关 && 档位允许 && 不在禁用列表。测试只需覆盖“档位 → 暴露名单”，
不逐个测 20 个开关。

## 6. 外来来源门禁

### 6.1 能力层元数据

每个 provider 增加：

| 字段 | 含义 |
|---|---|
| `origin` | `native` / `foreign` |
| `executable` | hooks/tools/extensions/MCP 为 true |
| `scope` | `user` / `project` |
| `requiresConsent` | 外来项目级来源为 true |

`loadCapability` 在返回前过滤：`foreign && requiresConsent && !consented` → 不加载。
S0（项目设置）与 S1（system prompt）用同一过滤，不能只在 UI 拦。

### 6.2 同意存储

| 数据 | 位置 | 说明 |
|---|---|---|
| 外来来源同意 | `~/.zeta/agent/sources.json` | `repoRealpath → source → {enabled, hash, approvedAt}` |
| 可执行来源 | 同上，按目录内容哈希 | 文件变化后重新确认 |
| 项目策略 | `.zeta/settings.json` | 只存非可执行开关与工具档位 |
| 可执行来源策略 | 不写仓库 | 防止恶意仓库自带“允许执行 hooks” |

### 6.3 界面

| 界面 | 内容 |
|---|---|
| 引导页（setup 版本 3） | 现有登录/模型/字形/输入框/主题之后，新增 `tool-profile` 与 `external-sources` |
| 设置页 | 新增 `Sources` 标签：用户级来源、当前仓库来源、已加载文件、风险标记、重新扫描 |
| 仓库级 | “只对这个仓库生效”的开关；非可执行写 `.zeta/settings.json`，可执行只写用户目录 |
| CLI/headless | `--sources claude,codex` / `--no-foreign-sources`；无 UI 时 fail closed |

### 6.4 启动行为

- 已批准：一行“已加载：AGENTS.md（原生）、.claude/skills（已批准）”。
- 未批准：只提示“检测到 X，未加载”，给出设置页/命令入口。
- 外来 `SYSTEM.md`：只显示“检测到，未加载”；不提供一键活加载。

## 7. agent 请求开启

不新增顶层工具，复用 `read`/`write` 的 `xd://` 传输：

1. 系统提示告诉模型：需要未启用工具时，`read xd://<tool>` 发起启用请求。
2. `xd://` 解析到“已注册但未启用”的工具时，返回可请求状态并触发审批卡：
   本次允许 / 本仓库允许 / 拒绝。
3. 批准后 `setActiveToolsByName` + `refreshBaseSystemPrompt`，审计记录进会话。
4. 拒绝返回理由；保护名单：`read`/`write` 传输不可关，有后台任务时 `wait`
   不可关，plan 模式 `todo` 不可关，子代理不能改父会话。

外来配置来源**不允许** agent 触发开启，只能提示用户去设置页。

## 8. MCP 与内置重复

| 冲突 | 例子 | 默认 |
|---|---|---|
| 同名 | 极少（MCP 有 `mcp__` 前缀） | 内置优先 |
| 同能力 | 内置 `github` vs MCP GitHub；memory vs MCP memory；`web_search` vs MCP search；LSP vs MCP LSP | 内置优先，MCP 标 shadowed，不挂载、不进提示 |
| 部分重叠 | MCP `create_issue` vs 内置 `github` | 启动报告列出，用户按服务器选 |
| 无重叠 | 专用服务器 | 正常挂载 |

策略 `mcp.precedence = native | mcp | ask`，默认 `native`；`/mcp` 显示被压制项；
提示词只出现选中的那套。

## 9. 守护面

| 守卫 | 检查 | 时机 |
|---|---|---|
| `check-native-prompt-sources` | 非原生路径的 `SYSTEM.md`/`SYSTEM_TEMPLATE.md` 不得进入提示 | 单测 + 合并后回验 |
| `check-foreign-consent` | 无同意时 `.claude/settings.json`、hooks、tools、MCP 不加载 | 单测（每个 provider） |
| `check-tool-profile` | 每个档位暴露的工具名与清单完全一致；禁用工具不出现 schema/目录 | 单测 + CI |
| `check-context-budget` | 上下文文件/规则总字节超限即失败并列出文件 | CI |
| `check-mcp-shadow` | 同能力 MCP 与内置同时出现时失败 | 单测 |
| `check-doc-classification` | 文档不得把原生路径写成“外来/有害” | 文档审查 + 守卫 |

AGENTS.md 只保留每次会话都要生效的规则；操作细节放本目录。

## 10. 实施阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | provider 元数据 + 能力层过滤；S0/S1 只认原生 | 无同意时外来设置/提示/hooks/MCP 全不生效；headless 同样 |
| P1 | 同意存储 + 启动提示 + 撤销 | 首次进仓库只提示不加载；开关切换后重启仍正确 |
| P2 | 引导页两个新场景（版本 3） | 新装默认高亮标准；老用户升级只看到新增两步 |
| P3 | 设置页 Sources + 仓库级开关 | 用户级/仓库级作用域正确；可执行来源哈希变化重确认 |
| P4 | 工具档位 + `tools.disabled` + xd:// 请求 | 默认标准 12；超级简 4；agent 请求走审批 |
| P5 | MCP 去重 + 提示瘦身 + 上下文限字节 | 重复工具只出现一套；`/context` 可分类统计 |

## 11. 未决

| # | 问题 | 建议 |
|---|---|---|
| 1 | 标准档是否就 12 个 | 是 |
| 2 | `tools.disabled` 作为统一关闭机制 | 是 |
| 3 | agent 请求用 `read xd://<tool>` 还是独立隐藏工具 | 前者，保持超级简 4 个 |
| 4 | 外来 `SYSTEM.md` | 永不活加载；只允许预览后复制到 `.zeta` |
