# Zeta 更新日志
## 下一版本（Unreleased）

### 修复

- 发布链修复：1.1.0 各 `@linxiraos/*` 包依赖误带 Bun `catalog:` 协议（npm 无法解析、安装即报错），1.1.1 起发布时重写为实际版本并重发全部包。
- 1.1.2 空涨重发：重置 `latest` 指向，彻底排除坏的 1.1.0（内容与 1.1.1 无功能差异）。
- CLI 汉化自动检测修复：`language` 未显式设置时不再用 schema 默认值（`"en"`）顶掉环境检测，`LC_ALL` / `Intl` 区域设置生效——中文系统开箱即中文界面；显式 `/language` 设置仍优先。
- release 资产命名系统化：CLI 二进制统一 `zeta-cli-*`（不再与桌面产物混排），桌面安装包统一 `zeta-desktop-<version>-<os>-<arch>.<ext>`（electron-builder `artifactName`），release 正文自动附带桌面/CLI 资产索引分节。
- CI/发布链修复：release 发布串行化与幂等（darwin x64→arm64 串行、zeta-web 幂等发布、native_addons 超时 50→90min、warm 只预热 natives 缓存）。

### 新增（1.1.5，随 OMP v18.0.5 / v18.0.6 同步）

- `/language`、`/tracking` 斜杠指令恢复：v18.0.3 合并时上游重构遗漏了 Zeta 自定义指令注册，输入被当作普通消息；现已恢复注册并新增合并护栏测试。中文用户可直接 `/language zh` 切换界面语言。
- git TUI 内置 conventional commit 生成与 `commit --legacy` 统一生成入口、`if-bench` 基准框架。
- `read`/`inspect_image` 新增 `:img` 选择器：SVG 自动栅格化为 PNG 附件送视觉模型；git TUI 资产预览同步支持 SVG/PNG 媒体渲染与 Git LFS 指针解析。
- 新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra image_gen/tts 接入。
- canary 更新通道：更新器支持安装 prerelease 二进制（显式 opt-in），草稿/预发布校验更精确。

- OMP 同步基线：v18.0.6（`b4e8e856ad40`，v18.0.5 经由其历史一并并入）；PR #3 合并提交 `8043ec175c`。

---

## v1.1.0（2026-08-25）

## v1.1.0（2026-08-25）

### 网络与安全

- 网关访问控制：`zeta serve` 的 web 网关与 stats 现在**仅允许 loopback 访问**；通过非本机 IP/隧道/反代到达的请求必须携带配置的 `remote.token`（`X-Zeta-Token` 或 `Authorization: Bearer`），未配置令牌时一律 403 —— 端口即使被暴露也无法无鉴权操控。
- CSRF 防护：网关拒绝非本机 Origin 的浏览器请求（跨站简单 POST 不再能删凭据/控通道）。
- 点击劫持防护：web-ui 增加 `X-Frame-Options: DENY` 与 `frame-ancestors 'none'`。
- `remote.token` 从死配置变为真实访问令牌：设置面板保存后写入浏览器本地存储，LAN/隧道访问自动携带。
- Stats 仪表盘品牌修正（`OMP Stats` → `Zeta Stats`）。

### 微信 / 飞书连接

- 新增 IM 指令：`!workspace`（飞书可用，`@` 被飞书占用）、`!plan`、`!hello`（按平台回复验证绑定）、`*别名` 直达 / `*relay` 切回中转。
- 修复消息路由 bug（此前入站消息被丢弃、无回复）：`!workspace`/普通消息现在正确投递到协调者。
- 飞书消息清理 `@` 提及占位符（`@_user_N`）；裸 `@workspace`/`!workspace` 显示帮助而非报错。
- 飞书渠道凭据改为显式"保存"按钮（保存中…/已保存 ✓/错误反馈）；微信状态文案汉化。
- 微信二维码在 legacy iLink 返回页面 URL 时自动回退为二维码渲染。

### 中转委派（多工作区）

- 协调者（默认工作区）会话持久化并命名 **"Zeta Bot (Relay)"**，出现在会话列表、重启保留。
- 工作区别名（`remote.workspaces: [{alias,path}]`）、每聊天持久绑定（`remote.sessionMappings`）、通道默认仓库（`channels.*.workspaceRoot`）、直达/中转双模式。
- 远程计划审批增加 30 分钟超时。

### 服务商

- `models.yml` 定义的服务商在 Web 面板始终显示完整编辑卡片（不再被 auth 卡片隐藏）；模型编辑补全 `thinking`（思考强度）、headers、compat、per-model baseUrl 等字段。

### 设置面板

- Escape 在输入框内不再关闭整个面板；面板渲染崩溃时 ErrorBoundary 兜底（不再拖垮整个应用）。



### 同步基线

- 当前基于 **OMP v18.0.4**（`5eef8a2386`；v18.0.3 `160ed439ac` 亦已合并，`git merge-base --is-ancestor` 均验证通过）。
- **OMP v18.0.3 合并**：TUI 采用上游新渲染架构（provider window / resize replay），streaming edit guard 改为异步增量验证，Julia 内核可用性探测加固（超时上限 + 进程组击杀）；Zeta 侧保留 web-gateway / i18n / `.zeta` 路径与 scrollback 扩展（tui.ts 三方融合）。
- **OMP v18.0.4 合并**：update-cli 异步增量重构、streaming guard 漂移下限放宽（CI 抖动，上游 `4854db856c`）、zh 本地化 overlay（`38a7dff556`）。
- **Zeta 品牌适配**：14 包统一 `@linxiraos/*` 版本线 1.0.11、`@oh-my-pi` 残留清零、`.omp` → `.zeta` 路径、desktop / web-ui 版本号识别单源（desktop `package.json`）。

### 版本与发布流程（v1.1.0）

- 各包 CHANGELOG 统一 Zeta 版本线：移除上游 OMP `[15.x]`-`[18.x]` 段（OMP 日志为 Zeta 子集，上游变更并入 `[Unreleased]`），恢复 Zeta 早期版本记录。
- 发布日志门禁：`release-v2` 发布前校验（无上游段 + 每包 `[Unreleased]` 非空 + UPDATE-LOG 非空）；CI 加版本一致性 + CHANGELOG 结构校验（`scripts/check-version-consistency.ts`）。
- README 徽章（版本 / Bun / TypeScript / Rust / CI）；版本号脚本体系 `scripts/set-version.ts`（14 包 + catalog + Cargo + sentinel + desktop + web-ui + README badge 一键对齐）。

- 当前基于 **OMP 17.3.8**（`858f7dd91f`）。
- 完整合并 OMP 17.3.8 官方 tag（分支 `zeta/v1.1.10-17.3.8`，合并提交 `2bf455c9c3`，`git merge-base --is-ancestor` 已验证），59 个冲突按 AGENTS.md 政策表解决：
  - 保留 Zeta 包名/版本（`@linxiraos/*` @ 1.0.9、workspace 1.0.9、native sentinel `__piNativesV1_0_9`）。
  - 接受上游依赖图（`bun.lock` 以 `@linxiraos/*` 名重新生成、`Cargo.lock` 经 `cargo metadata` 对齐）。
  - 上游实现 + Zeta 覆盖（i18n 键、`.zeta` 路径、`@linxiraos` 导入、Zeta 特性）逐文件保留；测试按 tests-as-contract 成对接受并适配 `.omp` → `.zeta`。
  - `issue-887-repro.test.ts` 保留（上游删除），其 qwen3.7-max 断言随 17.3.8 `models.json` 路由更新。
- 合并分支已并入 `main`（合并提交 `76588be094`，无冲突；跟随修复提交 `82309f384d` 在其上保留）。
- 跟随修复（Phase 1-8，见各包 `CHANGELOG.md`）：stats 独立窗口导航、更新流程（checking 态 / 已是最新提示 / CLI 交互确认与 `--yes`）、微信 v1 API 登录与 peer 持久化及解绑、飞书首聊 onboarding、`allowedPeers` 白名单、web-ui `/plan` 进入计划模式、models 配置卡片去重、desktop 二次点击恢复、桌面菜单 i18n、设置面板新增可编辑项。

### 发布与 CI

- v1.0.10 已发布：13 个 `@linxiraos/*` 包全量 1.0.10（trusted publishing），GitHub Release `v1.0.10` 含 18 个二进制/桌面/checksum 资产。
- 发布门新增修复（release-v2 工具）：`selectLatestZetaTag` 现在排除上游 OMP 17.x tag（其自带 `chore: bump version to 17.x` subject，会误判为 Zeta tag 阻断发布）；Cargo.toml `[workspace.package]` 缩进版本格式适配。
- 发布 CI 首轮暴露并修复：`retry.enabled` 设置分组错放（interaction → model）、9 个新增 `ui:` 块补全 zh 文案（含 17.3.8 新增的 `providers.cacheRetention` 及选项）、`structured-subagent.test.ts` 的 `.omp` 路径适配 `.zeta`。

### 版本准备（1.0.11）

- 全部 14 个 `@linxiraos/*` 包、根 workspace catalog、`Cargo.toml` workspace、pi-natives sentinel（`__piNativesV1_0_11`，含提交的 native 绑定）、desktop `package.json`/`package-lock.json` 统一 1.0.10 → **1.0.11**；`bun.lock` 重新生成并通过一致性核对。
- 安装测试（`run-ci.sh`、tarball 镜像）与 brew 公式更新脚本随 14 包清单同步。

### 渠道包提取（新发布包 `@linxiraos/pi-channels`）

- WeChat / 飞书 / Telegram 通道运行时自 `coding-agent/src/channels` 抽出为独立包 `packages/channels`（原 `channel.ts`、`feishu.ts`、`host.ts`、`telegram.ts`、`wechat.ts` 移出删除）；`im-control.ts`、`session-router.ts`、`channels/index.ts` 改引 `@linxiraos/pi-channels`。
- `release-v2.ts` 的 `ALL_PACKAGES`/`CATALOG_KEYS` 与 CI 发布门从 13 包扩展到 **14 包**（catalog 键数校验改为按清单长度断言）。
- IRC 总线（`irc/bus.ts`）精简为直接复用通道包导出。

### 品牌与身份清理

- GitLab Duo Workflow：inline agent/prompt 标识 `omp_agent`→`zeta_agent`、`omp_inline_prompt`→`zeta_inline_prompt`，MCP `serverName` omp→zeta（工具注册改用裸名，注释同步）；OpenAI 兼容 User-Agent 测试随动。
- Z.ai OAuth 持久化键名 `oh-my-pi`→`zeta`（登录不再误写 ZCode 键）。
- OpenRouter 请求头：`HTTP-Referer`/`X-OpenRouter-Title` 改为 Zeta 官方值。
- 主题符号 `icon.pi`：unicode π→**ζ**、ascii `pi`→`zeta`；poimandres 双主题品牌色修正；web-ui favicon 更换。
- 其余 `omp`→`zeta` 字符串清理：SARIF 输出、json-tree、`dirs.ts` 路径常量、`rewrite-system-prompt.ts`、zeta-server 日志等。

### Web UI

- 用户消息彩虹关键词：消息以独立散文包含 `ultrathink` / `orchestrate` / `workflowz` 时，关键词行按行渲染彩虹渐变（代码 span 内不触发），其余行保持 Markdown 渲染。
- 全局样式补充（globals.css）。

### TUI

- `normalizeTerminalOutput` 折叠裸 `\r`（回车不换行）：进度条类输出不再把单行拆成多终端行导致重叠/粘连；新增回归测试（text-utils、issue-2115 复现用例加固）。

### CLI 侧边栏、回合遥测与桌面入口（功能批次）

- **read 工具目录列表文件图标**：非目录条目按当前符号预设的语言图标表（`lang.*`，与 glob 文件列表同源）加图标前缀；系统提示词工作区树保持无图标（KV 缓存字节稳定）。`theme-class.ts` 导出共享解析器 `resolveLangSymbolKey()`。
- **回合遥测**：新状态栏片段 `turn_stats`（吞吐 ⚡、首 token 延迟 ⇄、时长 ⏱、输入/输出 token、费用），加入 full/nerd 预设；`statusLine.turnTelemetry` 设置（默认开）在每回合结束后于编辑器上方显示一行暗色遥测，下一回合开始自动清除。数据面统一在 `status-line/turn-stats.ts`。
- **CLI 右侧边栏**：`tui.sidebar` 设置（默认关）+ `/sidebar` 命令 + `app.sidebar.toggle` 键位。启用后引擎主区按 `columns-36` 合成绘制，右侧 36 列由每帧重绘的 gutter 面板填充（Context 用量仪表 / Token 与费用 / Git 分支脏状态 / 当前模型，数据与状态栏同源）；gutter 不进入合成帧与 scrollback；<100 列或 overlay 可见时自动隐藏。引擎新增 `setMainWidth`/`setGutterComponent` API 与滚动路径的 gutter 擦除保护。
- **桌面入口 `zeta-d` 与 `--desktop`**：桌面包新增 `resources/bin/zeta-d` shim（Windows `.cmd` / POSIX sh），NSIS 安装器把该目录写入用户 PATH（PowerShell 辅助脚本，卸载时移除），Linux 安装器 symlink 到 `~/.local/bin`。裸 `zeta` 永远属于 npm 安装；`zeta-d -d [cwd]` 打开桌面 GUI 并以指定目录启动服务；npm 侧 `zeta --desktop [cwd]` 探测桌面安装后打开 GUI，未找到列出探测路径退出。捆绑二进制拒绝独立自更新（防破坏捆绑布局）。
- **原生目录选择器**：桌面壳新增 preload 桥 `window.piDesktop.selectDirectory()`（sandbox 兼容）与 `pi:select-directory` IPC handler；网关新增 `GET /api/desktop/info` 能力探测。web-ui 目录选择器在桌面壳内显示 Browse… 按钮直开 OS 对话框，纯浏览器保持手填 + File System Access API 回退。

### Web UI 会话侧面板

- 新增右侧会话面板（设置 → Display → "会话侧面板"开关，localStorage 持久化，<1024px 自动隐藏）：当前模型与思考级别、上下文用量（百分比 + 窗口）、token 进/出与缓存读写、累计费用；数据复用 AppShell 已有订阅，新增 ChatWindow 模型回调，无新增轮询端点。

### 双端同览调查（设计）

- 完成 pi / pi-web / opencode-v2 三方跨进程会话共享机制调查，设计文档落盘 `local://dual-plane-live-session-design.md`：采纳"TUI 富客户端化 + serve 托管会话"方向（opencode 形态），四阶段实施另立计划。


### Web UI 工作区列表无法删除（问题调查，修复另行安排）

- **成因**：侧栏的"工作区/仓库"列表不是独立注册表，而是 `GET /api/sessions` 的派生结果——网关扫描 `~/.zeta/agent/sessions/<编码cwd>/*.jsonl`，每个会话携带 cwd，按 projectRoot 去重后得到项目列表。因此只要某个目录开过一次会话，它就会永久出现在选择器里，目前没有任何删除入口。
- **现状量化**：本机 `~/.zeta/agent/sessions` 共 127 个按 cwd 编码的目录，其中 **120 个是 `-AppData-Local-Temp-*`**（advisor-toggle 探针、bot 草稿 cwd、自动化测试遗留）；真实仓库仅约 7 个。总量约 2.4 MB——问题不在磁盘占用，而在选择器被垃圾路径淹没。
- **拟议方案（两级删除）**：
  1. *隐藏*：纯前端 localStorage 隐藏清单（按 projectRoot），列表过滤展示；不删任何文件，重新打开该仓库即恢复连接。
  2. *彻底删除*：新增网关 `DELETE` 工作区端点，级联清理该 cwd 名下全部状态——`~/.zeta/agent/sessions/<编码cwd>/` 整目录、`terminal-sessions/` 中引用这些会话的面包屑（否则 `--continue` 悬挂）、指向该 cwd 的 bot/draft 注册表绑定（`remote.sessionMappings`/`botSessions`）、运行中会话拒绝删除或先注销；未发现 per-workspace 锁文件，所谓"隐藏锁文件"实质就是 sessions 目录与面包屑残留。
- 附带建议：对 `-AppData-Local-Temp-*` 这类短命临时目录的会话提供一键清扫（其会话价值为零）。

## v1.0.9（2026-08-19）

### 新增

- 远程 `@plan <题目>`：IM 渠道（Telegram / 飞书 / 微信）向协调者发起计划模式，计划完成后以图片（无 Chromium 环境降级为文本）发送到手机，回复 1 执行 / 2 压缩后执行 / 3 新会话执行 / 4 取消。
- Web UI 设置面板新增"关于 / 使用"文档页：用户手册、Web UI 架构、网关 API 三份文档，语言跟随界面，章节目录可点击定位。
- 网关新增 `GET /api/docs/<path>`：随包 Markdown 文档（编译二进制 / npm 包内嵌，源码目录开发兜底）。
- Web UI 会话新增计划审批卡片（PlanApproval）：`get_state` 返回计划内容，可在界面上直接选择执行方式。
- 随包中英双语文档：`docs/web-ui/architecture`、`docs/web-ui/api`、`docs/user-guide`。

### 修复

- CI `setup-system-deps` apt 镜像挂死：改用规范镜像、带 kill-after 的超时、有界重试；`install_methods` 任务设超时上限。
- `update-cli` 恢复提示对齐 Zeta 安装地址。
- **CI 发布链拆分修复**：`release_gate` 拆为 `release_quality_gate`（测试门，`skip_tests` 时豁免）与 `release_build_gate`（产物门），发布作业分别受两门控制；`build_only` 新增（只构建不发布）。
- **browser-relay 扩展包文件名修复**：构建输出从 `omp-browser-relay-extension.zip` 改为 `zeta-browser-relay-extension.zip`，修复 GitHub Release 生成时 checksums 找不到文件（ENOENT）导致发布失败的问题。

### 发布与 CI 纪律

- 触发纪律（已写入 `AGENTS.md`）：`push` 只做质量检查、永不发布；`.github/**` 不再自我触发完整 CI（CI 改动走 `workflow_dispatch` 手动验证）；发布只走 `release-v2` 原子推送或 `workflow_dispatch`（`skip_tests` / `build_only`）。
- 凡发布 tag 必须同步更新本文件（`UPDATE-LOG.md`），与各包 `CHANGELOG.md` 同等级别的发布门禁。
- v1.0.9 npm 包已发布（trusted publishing）；GitHub Release 资产在修复后重新发布中。

### 同步基线

- 当前基于 **OMP 17.3.5**。
- **尚未同步 OMP 17.3.7 / 17.3.8**（OMP Release Sync Policy 要求官方 tag 完整验证后合并，待后续版本跟进）。

## 早期版本（v1.0.8）

- 桌面版与系统托盘（关闭窗口后常驻托盘）。
- 独立的追踪文档功能（默认关闭，`tracking.enabled`）。

更早版本记录见各包 `packages/*/CHANGELOG.md`。
