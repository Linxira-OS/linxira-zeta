# Zeta 更新日志

## 下一版本（Unreleased）

### 1.4.6
- **思源笔记接入**：新增 `siyuan://` 内部 URL，可列笔记本/文档、读 Markdown、大纲、搜索与追加；设置位于 Tools → SiYuan，支持 API 地址与 token，开启但未配置 token 时会提示。
- **画板场景**：新增 `canvas` 工具，在仓库根 `.canvas/` 下管理 Obsidian `.canvas` 与 Excalidraw `.excalidraw`（list/create/write/outline）；`read <file>:img` 可渲染终端预览，`vault://…?op=canvas` 可生成大纲。`canvas.enabled` 默认关闭，查看/编辑仍由 Obsidian 或 Excalidraw 客户端负责。
- **发布链**：GitHub release 成功后才通知 packages 仓库执行 PKGBUILD bump；普通 CI push 不会触发。
- **attach 断线可恢复**：backend 继续运行时，非本地标准存储的 attach 会话会写入标准 sessions 目录；旧的 `~/.zeta/backend` 副本在首次 resume 扫描时导入；重连不再按连接累积副本文件。
- **配置目录校验**：`ZETA_CONFIG_DIR` 只接受 home 下的相对目录名，绝对路径与 `..` 逃逸直接拒绝，避免文件散落到错误位置。

### 1.4.5
- **上游同步 v18.13.1 + v18.13.2**：两次完整 tag 合并（基线 v18.12.6 → v18.13.1 → v18.13.2），带上会话自有空闲维护、上下文查看器（替代旧 `/context` 网格）、RPC 会话结算与语音听写、模型发现自述推理档位、`ssh://` 目录直列、TAR 索引按区间读取，以及一批原生 shell 修复（`sort -S` 百分比/内存上限、FIFO 重定向、后台作业回收、取消、jq BOM、`ps` PID 选择）。
- **`/local` 双模式**：独立模式不变；attach 后端时经网关列出/读取/回写后端会话的 `local://` 文件（28 MiB 上限、路径包含校验），本地编辑后仅回写变化的文件。
- **`/share` 自定义钩子**：`~/.zeta/agent/share.{ts,js,mjs}` 接管分享；TUI 与后端 headless（attach 转发的 `/share`）两条路径都生效，失败不回退 gist。
- **ADE 定位**：README 明确本套件是 Agent 开发环境（ADE）——保留 IDE 形态，中心移到会话、子代理与 mesh。
- **上游商业面台账**：商业端点与替代状态集中记录并纳入 `check-shared-infra` 守卫；CLI `share` 仍默认上传到上游查看器（P1，待替代），上游 18.13.x 的构建服务、遥测设置等商业面继续拒绝进树。

### 1.4.4
- **桌面默认关闭后端**：`zetawork` 启动时读取 `backend status --json`；`backend.enabled=false`（默认）不再自动拉起 daemon，终端里的 `zetacode` 是本地进程。设置里的“启动/停止/重启”分别走 `backend on` / `backend off`（drain）/ `daemon restart`，启动工作区固定为 `backend.workspace`，退出时不再留下 enabled=true 的空后端。
- **内置等宽字体**：GUI 终端与编辑器内置 Maple Mono CN Regular（SIL OFL 1.1），覆盖中文、Braille Patterns 和常用字符画，ASCII:CJK 严格 1:2；随包分发 OFL 与第三方声明。`zetawork`/`zetaide` 在外部终端运行时仍使用宿主字体。

### 1.4.3
- **IDE 版本面**：`zetaide --version` / `termide-editor --version` 改按 Zeta 产品线显示（如 `1.4.3 (termide 0.41.0)`）；vendored TermIDE 的 Cargo workspace 仍保持上游 `0.41.0`，避免每次上游快照重放冲突。
- **Windows 图标统一**：zetawork GUI、TUI、zetacode、zetaide 以及 editor 载荷全部使用同一个 Zeta logo；安装器和桌面/开始菜单快捷方式固定引用随包 `zetawork.ico`，不再依赖 Explorer 的 exe 图标回退。发布链新增 PE 图标校验：Windows 产物缺 `RT_ICON`/`RT_GROUP_ICON` 或图标载荷与统一 logo 不一致，直接失败。
- **后端命令面补齐**：`/goal` 生命周期与队列编辑（remove/promote/abort-and-restore）在 WebSocket 存在时优先走协议面；HTTP 回退也实现同名指令，不再出现 `Unsupported command: goal`。
- **HTTP 斜杠命令真正执行**：轻量 `zetacode attach` 与无 WebSocket 回退不再把 `/compact`、`/fast`、`/rename` 等内置命令当普通提示词发给模型；后端按 ACP headless 处理器执行，TUI-only 命令改为提示使用完整 TUI。
- **resume 不再分裂**：`backend off` 自动把 `~/.zeta/backend` 的 attach replica 导入正常会话存储；独立 `zetacode --resume` 能看到完整后端对话，不再只看到本地 stub。
- **无协议面也保持状态一致**：模型、思考等级以及 plan/goal/vibe 切换在 WebSocket 不可用时改走 HTTP 命令，不再只改本地副本。

### 1.4.2
- **`/guided-goal` 后端可用**：interview 从 TUI 专属路径下沉到 `AgentSession.startGuidedGoal`，后端 RPC/网关新增 `guided_goal` 指令，attach 客户端转发并在状态中镜像 `guidedGoalInterview`（访谈期间裸 `c` 仍是回答，不会触发模式切换）。后端会话自己激活 `goal` 工具、发送隐藏 kickoff，收到 goal create 或首个工具调用后结束访谈；不再提示“仅限 TUI”。
- **后端模式开关**：新增全局 `backend.enabled`（默认关闭）与 `backend.workspace`。关闭时
  裸 `zetacode` 永远是本地进程，不探测、不附着、不自动拉起后端；打开时裸启动成为唯一默认
  后端的客户端，后端没跑会明确报错而不是静默降级。新增 `zetacode backend on|off|status|logs`：
  `on` 在默认工作区拉起隐藏的 detached 后端（已运行则复用，多于一个活后端直接报错）；
  `off` 立即关闭开关、让新会话变成本地、拒绝后端新提示词并排空运行中的回合后自动退出，
  `--force` 才直接停止，排空期间再执行 `on` 会取消排空。`--standalone`（别名 `--local`）
  强制当前进程本地运行，可与后端并存。自启组件现在同时要求 `backend.autostart` 与
  `backend.enabled` 为真。
- **attach 真正连上后端会话**：网关从运行时的 `model_change.model`（`"provider/modelId"`）
  解析模型，而不是读早已不存在的 `provider`/`modelId` 字段；attach 客户端同时容忍空会话
  的空模型。此前每次 attach 都在 `modelRegistry.find(undefined, undefined)` 抛错后静默
  降级成本地会话——界面正常、后端却是空的。失败现在会带 stack 写日志。
- **`/loop` 在所属后端会话执行**：新增后端 `LoopContinuationController`（每次会话一个
  实例），重复提示词、`--while`/`--until` shell 条件、次数/时长上限以及 `loop.mode`
  的 compact/reset 全部在后端会话内运行；attach 的 `/loop` 转发命令并镜像状态，第二次
  `/loop` 停止、Esc 暂停，`/new`、`/resume`、`/clear` 等会话切换会先停掉 loop。
  RPC 新增 `loop_start`/`loop_stop`/`loop_pause`/`loop_resume`/`loop_status`，
  `get_state.loop` 与 `loop_state` 事件供客户端接状态；loop 优先于 goal continuation。
- **会话隔离**：新增测试证明两个后端会话的 loop 状态互不可见；等待中的 loop 只吸收
  自己会话的下一条手动提示，不会落到默认工作区。

### 1.4.1
- **终端 attach 与本地会话对齐**：早期版本的 attach 只放开少量展示命令，其余斜杠命令
  一律拒绝，看起来像“连接后少了半套功能”。现在分三层：客户端命令与镜像开关在本地跑
  （`/language`、`/theme`、`/tool`、`/stats`、`/git`、`/model`、`/effort`、`/switch`…），
  后端有 headless 处理器的内置命令**转发给后端用自己的会话执行**（`/compact`、
  `/handoff`、`/session`、`/retry`、`/rename`、`/move`、`/mcp`、`/todo`、`/plugins` 等），
  命令输出（`command_output`）显示在 attach 的状态行；只有真正不能远程执行的会话切换
  （`/fork`、`/branch`、`/tree`、`/clear`、`/delete`、`/restart`）与凭据/共享/子代理
  工作流会带提示地拒绝。
- **attach 跨目录修复**：客户端与后端会话不在同一目录时，切换副本会被
  `SESSION_CWD_CHANGE_REJECTED` 拒绝并静默降级成进程内会话；现在 attach 会采纳后端
  会话的工作区（本地面板显示的就是提示词实际编辑的 checkout）。
- **会话生命周期**：`/new` 在后端新建会话并让当前 attach 客户端重新挂接；`/resume <id>`
  挂接到指定后端会话（id 来自 `zetacode attach --list`）；`/queue <text>` 与 `->`/`=>`
  简写进入后端的 follow-up 队列，`/btw <question>` 走后端侧上下文。
- **轻量 attach 客户端同规则**：`zetacode attach` 的斜杠命令不再被当作消息发给模型，
  可执行的交给后端、纯客户端命令与拒绝命令给出明确提示。
- **Web UI 状态与文档**：Web UI 开发降级，`zetacode serve` 的网页端口返回双语占位页
  （HTTP 200），文档全面改写为“暂不随包、后续从 npm 按需获取”；新增随包文档
  `zeta://docs/zeta-features.md` 列出 attach、RPC 控制面、Stats 语言切换、daemon 等
  Zeta 自有面。Stats 面板提供 EN ⇄ 中文 切换并记忆选择。

### 1.4.0
- **`zetacode` 变成客户端 + 后台常驻后端**：直接输入 `zetacode` 不再自己跑一个 agent，
  而是连到本机常驻后端里的会话（当前目录最近的那个，没有就新建），连不上时退回原来
  的进程内模式；`zetacode serve` 仍是前台后端（容器/CI/robomp 不变），新增
  `zetacode daemon status|start|stop|restart|logs|install-autostart|uninstall-autostart`
  管理后台生命周期，重复启动是幂等空操作，残留 pid 会被清理而不是挂住。自启是显式安装
  （Linux 用户级服务 / Windows 登录项），命令会打印写入的路径与撤销方法。
- **跨会话消息规则化**：子代理只能对派它的主代理汇报，不能调其它主代理、兄弟子代理或
  跨仓库；主代理之间按**工作区**各自记忆两档（入站/出站），从默认全关逐级放宽到
  本仓库主代理 / 本仓库全开 / 跨仓库但默认工作区除外 / 全开（默认工作区专用）；
  一次调用要求双方都允许，接收方会再校验一次，放行方无法绕过关闭方。顺带修掉
  “本机另一个工作区被当成远端、消息进离线信箱”的误判。
- **飞书与 Telegram 凭据登录**：与微信扫码并列——`channels login feishu|telegram`
  先向平台校验再落盘（飞书应用 token + 机器人信息，Telegram `getMe`），错误里不带明文
  凭据，桌面端同一套“验证中 → 已验证：<机器人> / 验证失败：<原因>”状态与解绑。
- **桌面端成为后端的宿主**：启动时连接已有后端，没有则通过后台命令拉起，状态可见
  （启动中/就绪/失败可重试）；工作区标签连的是后端会话（连不上才退回本地进程并在标签
  上写明），后端重启后自动重连，崩溃以横幅呈现而不是冻结窗格。
- **桌面端补齐（第二批）**：历史页接会话目录（按天分组、搜索、置顶标记、运行中圆点，
  点开即进会话）；新增跟踪文档页（直接读 `.zeta/tracking` 的索引/状态/计划/摘要，不复用
  看板存储）；左栏新增跨项目会话管理（搜索、置顶、归档/恢复）；右栏新增工作树页
  （列主/会话/当前/锁定、新建、切换、删除），工作区分支改为来自真实的 git 状态，
  不再写死；新增 ⌘K 命令面板（只做跳转——项目/工作区/对话/文件——与桌面动作：
  切分支、打开远程设置页、重启后端）。
- **桌面端左栏三层**：顶部固定「默认项目」（系统自带、不可删改），其下是默认工作区与
  它的多个对话，全部强制置顶；普通项目 → 工作区 → 对话依次在下方，每个工作区可新建对话。
- **桌面端补齐**：右栏 Git 从只读变成可列本地/远端分支、切换、新建；上下文占用改成
  环形百分比（分段构成、阈值变色、悬停明细）；新增远程访问设置页（地址、TLS 证书、
  明文开关、令牌轮换/吊销、本机生成配对二维码）；终端图片显示可关闭（自动/开/关）；
  新增完整历史、跟踪文档、会话搜索/置顶/归档、每对话独立工作树、全局命令面板
  （只做跳转与桌面动作，不是斜杠命令）。
- **插件面板按终端激活**：只有 agent 运行在我们自己的终端里（或显式强制）时，插件声明的
  原生面板才出现；其它终端里插件照常提供工具与命令，但不出面板。
- **任务面板设计定稿**：`document/task-panel-design.md` 把工具形态（单工具 + op）、
  数据落点（每仓库 `.zeta/tasks/<id>.md` + 工作区绑定文件）、多仓库绑定与失效语义、
  与用户看板/会话待办的三层关系、以及“用户关闭后不自动复活”全部定死，并给出 23 条
  验收场景。用户看板仍是独立的一层，两者不合并。

- **用户看板**：`.zeta/board/` 下每张卡是一份带 front-matter 的 markdown，GUI 右栏
  新增「看板」页（表单增删改、列间移动）、TUI 新增看板窗格，网关提供
  `/api/board*` 与交接接口（termide vendored 偏离 30：`panel-ide` 的 `todo.rs`
  由 `board.rs` 取代）。
- **GUI PDF 阅读器**：`SessionKind::Pdf` + `pdf.rs`（hayro 纯 Rust 解码 → vello
  位图 → egui 纹理），翻页/缩放/适配/重读与错误提示齐全；TUI **永不**渲染 PDF
  （有守卫测试钉住）。
- **终端图形**：桌面内嵌终端实现 kitty 图形协议子集（`a=t/T/p/d/q`、`m=1` 分块、
  PNG/RGBA、`c`/`r`、`C=1`、`z`、`q`），按上报的**设备像素** 1:1 贴合单元格绘制；
  同时回答 `CSI 16 t`/`14 t`/`18 t`、DA1 与 XTVERSION，并以 `TERM_PROGRAM=zetawork`
  自报身份（本地 PTY 与 `serve` 挂载两条路径一致）。
- **移动端远程访问**：`zetacode serve` 新增 `--host`/`--tls`/`--tls-cert`/`--tls-key`/
  `--allow-plain-http`（非回环明文 HTTP 直接拒绝），配对二维码（SVG）、令牌轮换与
  吊销（SHA-256 存储）、401 门禁与失败限流（60 秒 10 次 → 429）；web-ui 懒加载媒体
  并支持 PWA。
- **GUI 设置 → IM 渠道**：二维码登录生命周期、本地 `qrcodegen` 回退、凭据掩码、
  工作区/别名/会话映射编辑；`PUT /api/web-config` 现在接受 `[{alias,path}]` 与
  `SessionMapping[]`，不再整文件重写丢键。
- **默认工作区**：首次使用时初始化 `git init` + `.zeta/settings.json`
  （`memory.backend = mnemopi`）+ `AGENTS.md` + `PERSONA.md` + 首次提交，幂等；
  `PERSONA.md` 注入到 personality 块之后；`@status` 汇总；新增
  `channels.reportPolicy` 设置。
- **跨进程 Agent 网格**：新增 `src/mesh/{transport,directory,mailbox,mesh-node,mutual-wait}.ts`，
  回环 socket（POSIX）/ 命名管道（Windows）+ 每工作区令牌握手，NDJSON、1 MiB 上限、
  心跳与 `gone` 判定、离线信箱 + wake + 去重；地址形如 `<workspaceId>/<agentId>`
  （别名与目录名可解析，歧义报错）；互相等待返回 `peer-waiting-on-you` 而不死锁。
  CLI：`@agent list`、`@agent use`、`@team`。根会话各自持有独立 id，`agent://main`
  只解析到调用方工作区。
- **CLI 内托管 IM 渠道**：`zetacode channels status|login|logout|enable|disable`
  （`--json`），终端二维码（UTF-8 半块），微信登录状态机；与 `serve` 共用
  `instance-lock.ts`；新增 `session-host.ts`，交互式与 `--print` 都能托管运行时。
- **插件三层的第二层**：插件清单可声明 `ui.panels[]`（`list`/`form`/`chart`/`html`），
  GUI 以原生控件绘制前三类、HTML 面板走 `/plugins/view/…` webview；`zetacode
  plugins panel <plugin> <panel> --json` 供自动化读取；示例插件
  `plugins/official/example-panel/` 提供三面板 + 一页面 + 一工具 + 中英词条，发布链
  产出 `zeta-plugin-example-<ver>.zip`。`zetaide`/工作台 TUI 不带插件面（守卫测试）。
- **GUI「全部设置」与中英双语**：`settings_schema.rs` 按 schema 生成标签页/分组/类型化
  控件/搜索/掩码，写入后回读确认，切语言整页重取；新增 i18n 守卫测试（每个中文
  `t!` 键必须有 en 行）。
- **架构文档**：`document/architecture-layers.md`（core ← host ← 前端，HTTP 只是适配器，
  迁移顺序）、`document/agent-mesh.md`、`document/agent-mesh-scenarios.md`、
  `document/default-workspace-scenarios.md`、`document/personal-account-channels.md`；
  README 重写为中英双语锚点导航 + 仓库分层地图。

- **修复（本轮审计发现）**：设置按会话工作目录隔离（`Settings.sessionForCwd`，写后
  热重载，`x-zeta-cwd` 传递）；`web.yml` 读改写 + 文件锁 + 共享读取器、实例锁原子发布；
  渠道 `reportPolicy` 与 `sessionMappings.mode` 真正生效；发布链补齐
  `release_web_ui_packages`、单点数叶包源、`cargo-workspace-lock` 全量重写、
  叶包 `.stamp.json` 新鲜度守卫；`mesh` 互相等待的两端都能拿到答复（此前快的一方
  答完即撤回，慢的一方整段阻塞）。

### 1.3.2

- **桌面应用内更新**：状态栏右侧新增「检查更新」（`检查更新` / `正在检查…` /
  `有更新 <ver>` / `更新失败`），经随包 `zetacode update --desktop --check` 读取
  GitHub 发行版 —— GUI 仍不持有 TLS 客户端。弹窗显示当前版本、最新版本、安装包、
  大小与 SHA-256；「安装」经 `zetacode update --desktop` 下载、校验后以 `/S`
  静默运行 NSIS 安装器并退出。`zetacode update` 新增 `--desktop` 目标模式；
  `update.check_on_start`（`~/.zeta/zetawork.toml`，默认 false）控制启动检查。
- **`zetawork --version` 快速路径**：在创建窗口前打印 `zetawork <version>` 并退出，
  供发布冒烟与更新比较使用。
- **终端页与 companion 页都跑随包二进制**：pane 的 PTY 在 `PATH` 最前面注入本
  install 的 companion 目录（运行中二进制所在目录 + `ZETA_BIN_DIR`），键入
  `zetacode` 不再命中旧的全局 npm 副本；GUI 的本地回退 PTY 走同一规则
  （`panel-terminal::new_with_shell_env`，`termide/VENDOR.md` 偏离 29）。
- **zetacode 页挂网关**：`ensure` 接受封闭集合 `program: "zetacode" | "zetaide"`，
  companion 页成为 `zetacode serve` 的客户端（与 TUI/浏览器共享会话、窗口关闭后
  存活），serve 不可达时回落本地 PTY；缺 companion 时页面报错，不静默换 shell。
- 路线图登记「任务面板 = 官方插件（多仓库绑定、GUI 自动激活）」，评审前不动工。
- **桌面安装包**：Windows 发 NSIS 安装器 `zetawork-<ver>-setup-x64.exe`（GUI +
  `zetacode` + `zetaide` + `zetawork` 一并装进 `%LOCALAPPDATA%\Programs\zetawork`，
  开始菜单快捷方式、卸载项、安装前结束占用进程），同时保留**只含 GUI** 的
  `zetawork-<ver>-windows-x64.zip`；Arch `.pkg.tar.zst` 与 AppImage 也带上两个 companion。
  资产名一律用不带 `v` 的版本号；release preflight 要求安装器/zip/AppImage/pkg 四件齐全。
- **资源面板**：GUI 右栏与 TUI 各新增一页——CPU/内存/GPU 占比与按 CPU 排序的进程表，
  共用 `main/crates/sysmon` 的采样器与工作线程（UI 线程不做阻塞读）。
- **Web UI 会话标签与项目拖拽**：标签持久化/恢复、关闭其他/关闭右侧、草稿关闭确认、
  后台运行徽章；项目列表可拖拽重排并落盘（`ProjectMeta.order`，manual 模式）。
- **扩展 API 与 tea 二期**：扩展上下文新增 `ctx.agents`（只读名册）与 `ctx.messaging`
  （send/wait/inbox）；`tea` 支持 Gitea 的 `issue://`/`pr://` 与 `run_watch`。

### OMP 同步基线

- v18.12.1 → v18.12.2（620 提交 / 269 文件；真双亲合并 `aa4e88b275d`，
  仅比 tag 间差异，Zeta 侧 URL/素材/品牌面按 tag 增量重放，不整树覆盖）。

### 1.3.1

- **工作台 TUI 回到发布面**：`zeta-work-{linux-x64,win-x64}` 重新随 release 下发，
  `@linxiraos/main` 与两个平台叶包恢复走 npm（叶包内嵌二进制按 1.3.1 重编提交）；
  `zetacode` / `zetaide` 的资产与包保持原状。
- **桌面应用首次进发布链**：`zetawork-windows-x64.zip`（`zetawork-gui.exe` +
  `WebView2Loader.dll`，后者从构建所用 `webview2-com-sys` 直接取出）、
  `zetawork-<ver>-1-x86_64.pkg.tar.zst`（Arch，`pacman -U` 安装）、
  `zetawork-<ver>-x86_64.AppImage`。Linux 以发行版包为主形态，zip 不再是 Linux 首选；
  flatpak 不做。GUI 不进 npm，二进制装在 PATH 之外（`/usr/lib/zetawork/zetawork-gui`），
  对外仍只有 `zetawork` / `zetacode` / `zetaide` 三个命令。
- **GUI 中英文切换**：新增内容寻址的 i18n 表（`t!` 宏，中文为源文本，461 条 UI 字符串），
  语言存 `~/.zeta/zetawork.toml` 的 `lang = zh|en`，设置头部菜单即时切换；中文输出逐字不变。
- **TUI 文件/分支页**：工作台 TUI 左栏新增真实 `files` 与 `git` 页（懒加载目录树、
  分支与工作区状态、最近提交），键位与既有列表一致；`search/tasks/automation/mobile`
  仍是占位。
- **资源采样 crate `sysmon`**：CPU/内存/磁盘/网络 + GPU 三档探测（Windows PDH →
  Linux sysfs → NVML），拿不到显示不可用，不阻塞 UI。
- **插件发布修复**：`@linxiraos/pi-messenger@1.3.0` 走 OIDC trusted publishing 成功
  （此前 422 因 `repository.url` 指向 upstream）；仓库内不再存在任何 npm token。

### 新增

- **LSP 注册表统一**：`lsp/servers.json` 成为 coding-agent 与 termide 共用的唯一内建注册表（55 个服务器），`scripts/gen-lsp-servers.ts` 生成 `packages/coding-agent/src/lsp/servers.generated.ts` 与 `termide/crates/config/src/lsp_servers_generated.rs`，`scripts/check-lsp-servers.ts`（CI `check` job 与推送前本地门禁）断言生成物未漂移；两侧都按候选链选择「第一个能在项目本地 bin 或 PATH 解析的命令」，TypeScript 家族为 `tsgo --lsp --stdio` → `typescript-language-server --stdio` → `tsc --lsp --stdio`，Python 为 `ty server` → `pyrefly lsp` → `pylsp`；新增共享用户覆盖 `~/.zeta/lsp.json`（优先级：内建 < `~/.zeta/lsp.json` < termide `[lsp.servers]`）；`lsp status` 与 termide 启动日志报告实际选中的命令，链上无命令可用时该语言不启动并记录原因。
- **zetawork GUI 接入 gateway agent 会话页**：新增 `SessionKind::Agent` 子页，按 tab 持有 `SessionView` 与后台 SSE 读取（`GET /api/agent/<id>/events`，主线程 `poll` 非阻塞）；`extension_ui_request` 与 `running → not-running` 边沿分别产生「等待输入」「跑完」通知，走既有系统通知 → IM → 状态栏回落链；serve 不可达时页面显示传输层原因，不阻塞、不 panic；本进程 PTY 路径不变。
- **工作台左栏按钮可配置（内建视图槽）**：工作台（`main/`，终端形态）新增左栏按钮列 —— 默认 4 个内建视图按钮（搜索 / 任务 / 自动化 / 手机端；用量、上下文默认隐藏），点按钮把中间面板区整块换成该视图，再点一次或 `Esc` 回到窗格；按钮下方 `+` 打开「管理按钮」面板：勾选显示/隐藏、`K`/`J` 调序（也可点行切换），改动即时写回 `~/.zeta/workbench.toml` 的 `[[slots]]` 段（写回只动该段与工作台自己的 4 个偏好键，文件里其它键/注释/段落原地保留）。配置缺失、截断或含未知 id 一律回落默认四槽、不阻断启动；设置里多出来的字段被忽略（向前兼容）。左栏只放内建视图，**没有"新增 URL"入口**；六个内建视图本期只做"切换 + 说明帧"（帧内写明各自的数据来源），数据面实现是后续工单。
- **welcome/splash 字符画改标准工具生成**（2026-10-14 品牌字样规格）：新增 `scripts/brand/logo-art.ts` + `scripts/brand/generate-logo-art.ts`，用 FIGlet 标准字体生成字符画常量（mark = `Z`/`ANSI Shadow`，主行 `Zeta`/`ANSI Shadow`，次行 `Linxira-Zeta`/`mini`；字体 `ANSI Shadow.flf`、`mini.flf` 随包 vendored 到 `scripts/brand/fonts/`，root devDependency 加 `figlet@1.8.0` 作渲染器，CI 离线可复现）；`brand-check.ts` 新增"字符画必须与生成脚本输出逐字一致"校验——手改一个字符即红，`bun scripts/brand/generate-logo-art.ts` 重生成即绿。拉丁 `Z` 而非 `Ζ` 的原因：标准 FIGlet 字体全是单字节码表、无希腊区，`Ζ`/`ζ` 渲染为空串（`Z` 与 `Ζ`…

### 修复

- **welcome/splash 字符画不再手绘**：`ZETA_LOGO`（mark）、`ZETA_WORDMARK`（主行 `Zeta`）、`ZETA_SUBLINE`（次行 `Linxira-Zeta`）三个常量改为 FIGlet 生成（此前是手画的块格 ζ + 半块 wordmark，mark 用小写 ζ 造型）；锁排为 mark 旁置字标、版本在字标下、次行居中于其下，welcome 与 setup splash（含 native TSP 面）一致；着色/渐变/闪烁逻辑不变。

### 移除

- **editor 的 Agent 菜单项与 `handoff.toAgent` 命令**：editor↔Agent 切换设计定为互切，editor 侧不应有"单独打开 zetacode"入口——整删 `editor/internal/app/handoff_to_agent.go`（`SwitchToAgent`/`spawnZeta`/`registerHandoffCommands`）、菜单栏 Agent 项与下拉、Agent 设置分区、`AgentSettings`/`agent` 配置键及 zh 串，并重生成 `editor/config/settings.json`；**保留** agent→editor 单向下发（`consumeHandoff`/`ApplyHandoff`）与 agent 侧 `/editor` 入口。

## 1.2.0（2026-10-13）

### OMP 同步基线

- v18.8.6 → v18.9.1 → v18.9.2 两 tag 串联合并（PR #91 / #92；均为真双亲合并、谱系 gate 精确通过；账本见 `document/upstream-sync.md`，Integrated through `v18.9.2` = `bd4dffd5e617`）。

### 新增

- **会话来源标记**：每个会话头记录创建它的客户端（`cli` / `web` / `desktop` / `automation`）——CLI、ACP、`zeta serve` 协调器与 IM bot 会话各自盖章；`/new` 与原地分支继承，fork / persistCopy 显式复制，旧会话读取为 unknown。
- **自定义命令热重载**：改一个 TS 自定义命令文件无需重开会话——命令目录 watcher（200 ms 防抖）刷新会话命令表并广播给 TUI / ACP / RPC 三处订阅者；坏文件保留上一个好版本并给出可见警告。
- **Web UI 渲染模型产出的 ```svg 围栏**：闭合围栏渲染为图形块（缩放对话框与 mermaid 共用），流式中未闭合的围栏保持代码显示；DOMPurify svg+svgFilters 清洗，禁 `script`/`foreignObject`/`style`、丢弃外部引用，无 DOM 时失败关闭。
- **追踪四项完整性**：`status.json` 与全局索引的读-改-写整体进文件锁并原子替换、`tracking_update` 同批次串行；`actions.jsonl` 改为 5 MB × 3 轮转、所有读者有界尾读；Web 面板补上摘要标签页；`GET /api/tracking` 的 `updatedAt` 改为内容派生。
- **内存吃紧自动收紧子代理扇出**：`task` 取并发许可时采样进程与系统内存，紧张 ≤8、危急 ≤2（只降不升），恢复即回配置值；危急时同时挂起空闲 tab 缓存与 mnemopi worker。
- **崩溃报告带内存计数**：`~/.zeta/logs/native-*.log` 与 stderr 增加进程 rss/峰值/提交与系统内存读数，走 syscall 无分配路径，真 OOM 下数字先落地再谈报告本体。
- **插件成为一等 workspace 成员**：`plugins/*` 进根 workspaces 与版本线（pi-messenger 1.1.3 → 1.1.29 对齐），`plugins/**` 进 CI 触发路径；官方插件标准里 `locales/` 由硬要求降为预留（宿主 i18n 机制未实现，已登记 roadmap）。
- **web-ui 单元测试进 CI**：`web_ui_build` 在 Lint 与 Build 之间执行 web-ui 自身的 `npm test`（42 个测试文件）；首次执行即抓出 4 个从未被运行过的测试缺陷（含一个 fail-closed 真 bug）。

### 修复

- **teamagent 键名双读者兼容**：命令端同时写 `thinking`（镜像端字面读取）与 `thinkingLevel`（CLI 优先），镜像端读 `data.skills ?? data.autoloadSkills`——此前 `/teamagent add --thinking` 写的键没有任何读取者。
- **追踪提示契约**：追踪与记忆的边界、缓存顺序规则写进提示词（含 `/tracking start` 一行），并补两条渲染器回归测试。

### 移除

- 无。

## 1.1.24（2026-10-03）

### OMP 同步基线

- v18.4.4 + v18.4.11（双 tag 一轮直上集成，682+174 commits 全解；谱系 gate 精确通过；账本见 `document/upstream-sync.md` v18.4.11 条目）。

### 新增

- **Web UI 左栏大修（发布硬门）**：项目分组 IA（分组头 hover 浮现操作簇）、草稿直开（＋入口直接进空态 hero，工作区/分支选择降级为输入卡上方 chip，解析不到时保底默认工作区 `~/.zeta/workspace`）、空会话折叠清理、设置面板控件现代化（开关三态/destructive）、Open split-button（终端解析链 pwsh→Git Bash→powershell + `zeta-ide`/`zeta-editor` 目标）、composer context 用量指示与 Alt+T thinking 循环。
- **OMP 模型配置只读兼容**：上游 `~/.omp` 已配模型/key 自动映射进模型列表（「来自 OMP」徽标），key 内存复用不落盘，Zeta 本地配置优先。
- **插件存储契约**：`pi.storage`（`~/.zeta/plugins/{data,cache,state}/<id>/`）注入每个扩展 factory；`adoptLegacyFileOnce` 一次性迁移原语公共化。
- **skills 嵌套路由树发现**（限深 3 层，linxira-skills 三级树叶子全部可见）；`skills.enableOfficial` 开关接线；npm 源码安装补齐 official skills。
- **合并驱动**：`@mariozechner/*` 原作者 scope 纳入 package.json 合并映射（brand-rules 加守卫）。
- **zh 本地化回填**：v18.4.11 新设置面（工件上限/棘轮递进/子代理完成度探测/goal 斜杠命令等）。

### 修复

- **CLI 指令面审计**：会话退出提示与全部示例改用 `zeta-c`（此前打裸 `zeta` 落入工作台静默无动作）；`--resume` 尾斜杠/`.jsonl` 粘贴噪音归一为 id 解析，显式路径缺失报错而非静默铸造空会话；`update` 不再触碰工作台 `zeta` shim，GitHub/mise 回退指向 Linxira-OS/linxira-zeta。
- **teamagent（pi-messenger 1.1.3）**：crew 子进程改跑 zeta CLI（此前 spawn 上游 pi）；user 角色目录修正为真实发现目录；状态从 `~/.pi` 迁 `~/.zeta`；项目级 crew 改 opt-in。
- **插件锁文件名还原** `omp-plugins.lock.json`（sweep 误改 `zeta-plugins.lock.json` 导致项目级插件解析静默丢功能——文件名非品牌面）。
- **虚拟模块 specifier 统一** `zeta-legacy-pi-modules`（生产/消费两侧，修复 install smoke bundle 失败）。
- **zh 本地化契约**：v18.4.11 新设置全部含 CJK 条目；`parseFlag`/`$env` 等测试桩补齐。
- **第三方协议头部**：THIRD-PARTY-NOTICES 标题与导语改 Zeta（vendored 法律文本与上游署名行原样保留）。

### 移除

- 无。

## 1.1.25（2026-10-03）

### OMP 同步基线

- 未同步（基线保持 v18.4.11）。

### 新增

- **桌面内置终端（批次 4 / Z2+U9）**：网关新增 `/api/terminal` REST 与 WS 数据面（64KiB 断线回放缓冲、并发上限 4、一次性 connect ticket 鉴权），web-ui 右侧 dock 新增 xterm.js 终端窗格（TerminalView，断线指数退避重连）；聊天文件芯片右键「在终端打开」→ 终端窗格跑 `zeta-ide <file>[:line[:col]]`（PATH 探测，未命中回退纯 shell）。桌面/浏览器共用同一 WS，PTY 全在网关进程，桌面壳零改动。
- **工作台 v1 批次**：OSC 8 超链接全链（termide 解析 + Ctrl+点击 → 右侧新窗格 `zeta-ide` 打开，IDE→editor 回退）；OSC 0/2 标题自动命名 + 槽位编号（`1:shell`，子进程报题实时接管 tab/pane 名）；子窗格单独关闭/提升为顶级 tab（Alt+B，PTY 存活）；死壳 tab 根因修复（关闭管线统一，不变量「tab 存在 ⇒ ≥1 活 pane」，末 tab 关闭自动补新 shell）；嵌套禁令（`ZETA_WORKBENCH=1` 时拒启，exit 2）；忙碌关闭二级确认（shell 有存活子进程时 Y/N，`~/.zeta/workbench.toml` 可关）。
- **zeta-ide 位置参数**：`zeta-ide file[:line[:col]]` 与目录参数（对标 `code`；TTT 侧原有能力不变）。
- **发布流程**：CI 双态切换（发布态跳过测试直进构建发布，tag 前强制同 SHA push-run 全绿）；set-version 纳管 main 工作区 Rust 版本（修复工作台二进制版本戳落后）。

### 修复

- 无。

### 移除

- 无。

## 1.1.26（2026-10-04）

### OMP 同步基线

- 未同步（基线保持 v18.4.11）。

### 新增

- 无。

### 修复

- **工作台 npm 二进制陈旧**：`@linxiraos/main-*` 平台叶包内嵌的 `zeta.exe`/`zeta` 是入库构建产物，1.1.25 发布链原样带出了 10 月 1 日的 1.1.23 陈旧二进制（缺失工作台 v1 批次全部功能且版本戳错误）。本版重建双平台二进制入库（1.1.26 戳，含 OSC 超链接/pane 生命周期/自动命名/嵌套禁令/忙碌确认），并把「发版前重编内嵌二进制」写入发布检查。

### 移除

- 无。

## 1.1.27（2026-10-07）


### OMP 同步基线

- v18.7.0 → v18.8.6 六 tag 串联合并（524 upstream commits；本轮窗口 v18.8.4→v18.8.6 为 292 commits / 244 文件 / +10555 / −2660）。谱系 gate 精确通过（`git merge-base HEAD v18.8.6` == v18.7.0 peeled `e0fc1cf4ea35`），合并后 `v18.8.6` 为 HEAD 祖先（真双亲合并，未 squash）。账本见 `document/upstream-sync.md`。

### 新增

- **Zetawork 工作区状态持久化 + 顶栏快捷启动**：桌面壳 `<userData>/workspace-state.json` 记录窗口位置/最大化状态与最近启动历史（工具、cwd、pid、zetacode 隔离 `--session-dir`），顶栏新增 zetacode / zetaide / zetaeditor 三个按钮，在当前会话目录启动对应产品（浏览器模式下自动隐藏）。恢复一律走 `--resume`（jsonl 仍是唯一事实源；运行中的 CLI 会话无法热接管，单写者约束）。
- **tea 工具套件（自托管 Gitea 一等公民）**：`repo_view`/`repo_create`/`issue_*`/`pr_*`/`release_*`/`checkout`/`merge` 等 op，创建类操作一律 API 回读验证（`tea repo create` 有静默失败史）；开关 `gitea.enabled` 默认关闭。
- **每会话 Git worktree（上游）**：`worktree.onStart` / `worktree.onExit` 两组设置，新建交互式会话可在独立链接工作树中启动并在退出时清理。
- **xAI 搜索与 X 内容读取（上游）**：X 帖子/话题/作者检索、作者排除、日期与新鲜度过滤，凭据可用时自动路由 xAI；已登录时可读帖子、串、回复与话题页（替代失效的 Nitter 镜像）。

### 变更

- **命令行标准指令名定为 `zetacode`**：四件套标准名统一无连字符（zetawork / zetacode / zetaide / zetaeditor），`--help` 用法与示例、`update` 横幅、`--resume` 提示、profile alias 生成脚本与文档全部改用标准名；`zeta-c`/`zeta-cli`/`zeta-ide`/`zeta-i`/`zeta-editor`/`zeta-e`/`zeta-work` 保留为 npm bin 兼容别名，垫片与发行资产文件名（`zeta-c.cmd`、`zeta-cli-*`、`zeta-capture-*`）不变。
- 桌面 `serve` 命令解析改为标准名优先（zetacode 先于历史别名），发行版原生包路径不再被别名遮蔽。

### 修复

- **合并期 Zeta 面丢失修复**：web_search 的 `provider` 强制钉（显式引擎不回落）、模型注册表只读 OMP 兼容面（`getOmpOriginProviders`/`getOmpCompatConfig`/`forceStatic`）、`setThinkToolEnabled`、provider 排序全局（web search + image-gen）、sdk 的 `channelSend`/`workspaceRun`/`imControl` 三 sink 全部恢复。
- **shell 快照环境变量重导出**：上游把快照脚本临时变量改为 `__omp_funcs`/`__omp_emit_referenced_exports`，而我们自有的 fn-env helper 仍定义 `__zeta_*`，两侧对不上导致被快照函数引用的环境变量在 Linux 上整片不再导出；两侧统一回 `__zeta_*`，快照文件头改 `generated by zeta agent`。
- **zh 本地化回填**：`worktree.onStart`/`worktree.onExit` 及其选项文案。
- `update` 横幅与 `update-cli` 拒绝文案改为跟随 `CLI_BIN_NAME`（不再硬编码 `omp update`）。
- 终端标题无会话名时回退 `zeta`；协作 replication 快照回到上游 no-copy 契约（活页眉 + 只读条目）；CHANGELOG 重复节头修复。
- `MODULE.bazel.lock` 按 crate_universe 哈希链刷新（从 CI 工件取回，未删除 freshness 校验）；`packages/catalog/src/compat/rules.json` 随新模型集重新生成。

### 移除

- 无。

## 1.1.23（2026-10-01）

### OMP 同步基线

- v18.4.3（经 dev/main 实验分支按 tag 差异合并验证后随本版落地；勘误 2026-10-02：初版误记为 v18.3.0）。

### 新增

- **`zeta` 工作台(嵌套终端工作台,bin `zeta`,包 @linxiraos/main)**:顶层标签页 + PaneTree 可分割窗格树(n 叉权重树,tmux 式扁平化)+ 每窗格子页栈;鼠标优先(菜单栏/标签栏/窗格标题控件全可点,滚轮切标签),快捷键为可选加速(Alt+C/E/I/F/D/P);原生组件窗格:时间+日历(可点翻月/选日)、🍅 番茄钟(可点启停)、📋 剪贴板历史;缺套件工具一键窗格内安装。窗格拖拽已上线(2026-10-01 调研裁定树机制健全后启用):拖共享边界伸缩(左右/上下),按下即钉住边界两侧窗格对、整段拖动只跟踪一条树实测边,嵌套布局不抓错边、连发事件精确累积;拖动中活动边界渲染亮白条实时指示位置;拖窗格标题到另一窗格即换位/移靠,拖标签即重排。**智能预设**:Tools 菜单与 `[layout]` 循环换为 6 形态——单窗、1+2(左⅓右⅔,agent 在左的默认工作形态)、三等分、T 形(上排⅓+⅔、下排整宽半高)、2×2、双列(左对⅓宽、右对⅔宽)。**窗格最小化**:标题栏 – / Pane 菜单 / Alt+M,窗格让位给兄弟窗格并沉到当前顶级标签页底部的泊坞条(PTY 保持运行,每标签页各显各的),点芯片即还原到聚焦窗格旁。**设置面板**:Settings 菜单打开可点击浮层——默认 shell(auto/powershell/pwsh 7/git bash,新窗格生效)、拖拽层总开关、焦点跟随鼠标;持久化 `~/.zeta/workbench.toml`,逐键容错回落。浮层互斥打开、点击任意处关闭(不再依赖键盘,IME 吞键也关得掉);菜单下拉清底不透。
- **套件命令入口**:`zeta code|editor|ide`(+首字母 c/e/i)接力各工具并透传参数,窗格内工具在 PATH 上时直接敲裸命令名(`zetacode`),与手敲一致;`zeta doctor` 报告全家桶安装状态与精确修复命令;连打别名 `zetawork`/`zeta-work` 随 npm 分发;Windows 默认 shell 修正(pwsh/powershell,不再落入 System32 bash.exe 的 WSL 陷阱)。
- **CLI 命名定稿**:coding CLI bin = `zeta-c`/`zeta-cli`/`zetacode`(`zeta` 名让位给工作台);IDE 包 @linxiraos/ide(bin `zeta-ide`/`zeta-i`);editor 包不变。
- **files 腿退场**:yazi 从未是 Zeta 代码,vendored 树整体移除,files 命令与窗格同步下线;终端文件管理器后续以原生 Rust 重做(roadmap 登记)。
- **CI 发布面**:新门禁 `check-ci-surface.ts`(job 清单/needs 接线/产物名三查);恢复 desktop_linux/desktop_windows/web_ui_build;产物名 zeta-cli-*/zeta-desktop-*;release_main_packages/release_ide_packages 接入发布链。

### 修复

- 官方插件编辑器切换按钮移除(统一入口=工作台);`/editor` 命令保留。
- 大量 CI 发布面回潮修复(v18.4.3 整文件带入上游 ci.yml 所致),详见 `document/upstream-sync.md` 损伤类 7 追记与 check-ci-surface 守卫。
- **agent ↔ editor 双向切换**(透传打开路径/git 工作区/会话):
   - handoff 文件 `~/.zeta/handoff.json` 一次性携带 cwd/gitRoot/sessionFile/file:line:col;write-then-rename 写入、读一次即删(不会重放昨天上下文);损坏或空 payload 不阻塞启动;**显式 CLI 参数永远优先**,同目录已开的工作区不拆。
   - zeta 侧入口:`/editor` 命令(右上角按钮形态随统一入口=工作台的裁定移除,见上)。
   - TTT 侧入口:**菜单栏 Agent 项**(直角配 editor 主题,追加在最后以免 menuOptionsIndex 指错)+ `handoff.toAgent` / `handoff.toAgentWithFile`(带光标位);spawn detached,PATH → 插件树 → repo checkout 三级解析。(**已移除**:用户裁定 editor↔Agent 互切,editor 侧不应有单独打开 zetacode 的入口,见"下一版本 → 移除";agent→editor 单向下发保留。)
   - 双层回归测试钉住跨进程契约(盘符冒号 vs 位置冒号、读一次语义、损坏容错、空 cwd 拒绝)——两侧无共享代码,契约只存在于两边。
- **`/teamagent` 指令**(一个词):把 crew 角色注册为可派发的 subagent。
   - `add <role> [--user]` 将 `TeamRoleDefinition`(只有 name/description/thinking/skills)转成标准 `AgentDefinition` frontmatter 写进 agents 目录——discovery 已经在看的路径,不养第二套注册表;保留名(main/sub)与非法名写入前拒绝,已存在不覆盖。
   - `agents` / `remove` / `roles` / `status` / `profile.list` / `charter.show` 共 7 个动词归一个命令(原 `/team` 删除,消除同名双注册)。
   - scope 默认 project(随仓库走),`--user` 写全局目录;discovery 缓存只在 runtime 刷新,故 add 明说需重开会话,不暗示立即可 spawn。
- **editor 按需安装守卫**:`editor.autoInstall`(默认 true)在切换时检测 `@linxiraos/editor`,缺失则自动 `npm i -g`;Linux/macOS 的 root-owned prefix EACCES 用 `sudo -n` 重试,需要密码时返回确切命令而非挂在不可见提示符上。配套 `editor.handoffSession` 控制是否把会话写进 handoff。
- **TTT Agent 设置分区**:启用交接 / 交接当前文件(tri-state,缺省即默认开)。(**已移除**,见"下一版本 → 移除"。)

### 修复

- **TTT agent 设置在默认配置中整段缺失**:`AgentSettings` 标了 `json:"agent,omitzero"` 而 `DefaultSettings()` 未赋该字段,导致新写配置里整块消失——Agent 菜单与两个 handoff 命令虽按 nil 即开生效,但用户没有任何键可以关掉它们。默认配置改为显式携带两字段;nil 仍表示"继承默认",旧配置不受影响。(**该 Agent 设置面随后整段移除**,见"下一版本 → 移除"。)
- **editor handoff 设置归错 tab**:两个 `editor.*` 键原先挂在 appearance tab 并自称 `"Editor"` 组,而 appearance 的 `TAB_GROUPS` 没有该组,`settings-layout` 测试直接红。改挂 interaction tab 的既有 `"Agent"` 组(语义本就属 agent 交互),不新增组。
- **CI 从不覆盖 editor/ 与 plugins/**:`ci.yml` 的 push 与 pull_request 两个 trigger 的 `paths` 过滤器都漏了这两个源码树,导致只改 editor 或 plugins 的 PR **跳过整个 workflow(零 check 直接绿合并)**。已双双补上。
- **TTT 汉化范围收窄为契约**:只译设置表单与描述性文案;**菜单栏/下拉动作/面板标题保持英文**——它们与快捷键并列,译名失去指位意义。此前译掉的 72 个菜单标签 + 8 个面板标题已回退,范围写进 `i18n.go` 头注防回潮。



## 1.1.20（2026-09-23）

### OMP 同步基线

- v18.2.5(`aead0d4742` 并入,随 1.1.16 发布);本版无新上游同步。

### 修复

- 内嵌 TTT 编辑器(editor vendor)鼠标交互整肃(v1.1.18 右键菜单乱弹的根治 + 用户实测验收):
   - 幽灵 Button2 残留位导致左键整体失灵——约 20 处 `Buttons()==ButtonNone` 绝对闩锁改为**发起键下降沿**判定(`ButtonGesture`/`capturedGesture`),对残留位免疫;root 捕获释放经 `capturedGesture.Ended`;modal overlay 吞事件时同步沿基线;新增幽灵流 e2e 回归测试。
   - 滚轮/中键穿透宿主终端(Tabby 收到后自己滚动或透给其它窗口):`Root.handleMouse` 末尾改为无条件 `EventConsumed`——TTT 是全屏 TUI,root 层兜底同时覆盖所有嵌套子页面(split/tab/内嵌终端/plugin widget)。
   - 中键关闭标签页(上游未实现的 tabbed-UI 惯例):press 记录 `middleDownTab`,**松开沿命中同一 tab 才关**;松开在别处取消;pinned tab 走 unpin。
- Zeta 品牌主题迁移:pi-tui titanium 色板(electricBlue accent / darkTitanium bg / brightAluminum 文本)映射为 TTT 86-token 主题文件 `zeta.json`,与 vermeer schema 逐 token 对齐(86/86),进 embedded themes FS,设置页 Appearance→Theme 直接可选。

### i18n 接口层(默认英文)

- 设置 TUI 完整本地化接口:`t()` 翻译表(130+ 条)覆盖分类标签、全部字段、枚举选项、菜单栏、侧栏/底部面板、下拉项、对话框按钮与状态行;语言选择器(Appearance→Language,中文/English/Default)Apply 后**即时重建**表单生效(工作草稿保留)。
- **斜杠命令描述跟随 `/language` 实时切换**(此前 import 时快照固化,`/language` 只重建列表、文字停留 OS 语言):203 处 spec/subcommand `description` 改 thunk,经共享 `resolveCommandDescription()` 在 TUI materialize、subcommand 补全、ACP available-commands payload 每个读取点解析;`/language` 文本模式补 `refreshCommands()` 让 ACP/RPC 客户端重新广告命令列表。回归测试钉住跨目录文案必须不同。
- **官方默认英文**:locale 探测收窄为显式 opt-in(settings.json `language` 或 `TTT_LANG=zh`),宿主 `LANG`/`LC_ALL` 不再触发切换——快捷键与命令名英文优先;翻译表完整保留供插件/社区自行适配。

### 版本线工具

- prerelease 版本号支持(semver `1.1.20-rc.1` 等):`set-version.ts` 校验放宽并拒绝空标识符/前导零/build metadata;`check-version-consistency.ts` 的 `__piNatives` 哨兵派生规则与 setter 对齐(此前 dots-only 规则会在 prerelease 下推出非法 Rust 标识符);两处 README badge 正则同步支持。
- 修复 9 个 `crates/*/BUILD.bazel` 自 1.1.17 起的版本漂移(setter 的 bazel 正则要求恰好 4 空格缩进,实际属性更深)。
- `writeJson` 保留 manifest 原有缩进与行尾(tab+CRLF),版本 bump 不再产生全文件 diff。
- `document/release.md` 记录版本号格式契约:稳定线纯数字、prerelease 仅内测/RC 且必须 `--tag` 不发 Release 资产、timestamp z 明确否决(混淆发布次序与构建时间)。

### 产品前门(README)

- Component Lineage 表:逐组件列上游来源 vs Zeta 所有权,含 TTT Editor 的插件兼容现状(当前跟随上游插件体系,若不适配则直接内嵌所需插件而非分叉协议)。
- npm 安装路径、Platform Support 矩阵、Interface Language 节;web/desktop 从 "planned" 更正为已发布;License 补 TTT 上游致谢。
## 1.1.19（2026-09-23）

### OMP 同步基线

- v18.2.5(`aead0d4742` 并入,随 1.1.16 发布);本版无新上游同步。

### 修复

- 内嵌 TTT 编辑器(editor vendor):无按键移动不再自动弹出右键菜单——按下沿检测免疫终端 SGR release 残留位(Windows/Tabby 实测,v1.1.18 损伤);内嵌终端鼠标按钮映射与 tcell v3 语义对齐;About/--help 品牌面清理(上游 tttedit.dev/eugenioenko 链接移除,改指 Linxira-OS/linxira-zeta;VENDOR.md 修改层 #1-#3)。

### Linux 主线分发(准备)

- 契约固化(document/release.md):`zeta-desktop-<ver>-linux-x64.tar.gz` 资产名冻结、字节稳定、正式 Release 形态、三处版本一致;范围 = 仅 zeta-desktop 壳,editor npm 分发不进系统包。接入由 Linxira-OS/packages 的 zetabin(asset 模式扫描器)自动驱动,v1.1.18 为首个契约样本。

## 1.1.18（2026-09-22）

### OMP 同步基线

- v18.2.5(`aead0d4742` 并入,随 1.1.16 发布);本版无新上游同步。

### 新增

- 全面板 CLI i18n(feat/i18n-overlay,PR #36):宿主可注入 tuiText 文本层,约 700 个 key 覆盖全部 TUI 面板、Settings、setup 场景与聊天/状态栏/工具元数据;`/language` 切换即时生效,无需重启。Settings 行由宿主侧 localizeSettingUi 覆写,zh 下 300+ 设置项全中文。
- Web 极简收尾(plan-surface-completion,PR #37):底部入口收敛为「折叠开关 + 设置」;侧栏可折叠为 56px 图标栏;欢迎态工作区/模式双选择器;区头新建工作区;命令面板 Ctrl+K(cmdk,动作 + 会话搜索);Shiki 替换 react-syntax-highlighter(代码块配色随主题 CSS 变量即时切换);设置窗口化(页内搜索 + 命中高亮 + 分组导航 + 外观组);侧栏 Plan 卡片;Tracking 面板入口按 tracking.enabled 条件显示;TrackingPanel/ChatInput 等硬编码文案全部入 i18n。
- Tracking v2(PR #37):`tracking_update` 新增 `sync_todo`(todo 阶段镜像 status.json,阶段推进记录 phase_complete);全局追踪索引升级对象行(path/name/phase/progress/lastActiveSessionId);INDEX.md 三读者模板(人/agent/协作者)自动落盘;批准的 plan 只读镜像至 tracking/plans/;todo 阶段完成后一次性隐藏提醒同步;`GET /api/plan` 白名单端点;agent 状态暴露实时 todos;docs/tools/tracking_update.md 与 docs/zeta-tracking.md 重写为 v2。
- 官方默认 skills 机制随 1.1.16 落地(docx/pptx/xlsx/pdf 首发,`skills.enableOfficial` 默认开)。

### 修复

- i18n 覆盖后 todo 警告选项丢失(hideWithToolActivity 第二参数)与测试语言钉扎(bunfig preload 钉 en,中文 Windows Intl 兜底不再产生假红)。
- 桌面托盘 Open Settings 404:`/?panel=settings` 深链 + `/settings` 307 重定向,点击先弹窗再导航。
- web-ui Next 构建钉 outputFileTracingRoot,消除多 lockfile 推断警告。
- 发布链三连修:`release_github` 等 desktop 产物(损伤类别 10 复发);editor npm 发布改 workflow_call 复用 editor-publish.yml 并显式授 id-token(reusable callee 不可越 caller 权限上限,startup_failure 根因);MCP instructions 测试等待两段式 prompt 重建的竞态。
- 发布链:editor 三包纳入 lockstep 版本线(`set-version.ts` EDITOR_NPM_PACKAGES),独立 `editor-publish.yml` 支持补发。

## 1.1.16（2026-09-19）

### OMP 同步基线

- v18.1.16（`61b1b8aef6`,经 `backup/pre-sync-v18.1.16` 离线验证分支全量合并 + 五守卫 + hunk 级丢失扫描后并入）；随后 v18.2.5（48 commits,streaming CLI 命令、热路径记忆化、TUI 主题/覆盖层组件迁移 pi-tui）。合并审阅方法论新增 slice 分层审阅(v14→15→16 逐 release 切片)。

### 新增

- 上游 v18.1.14→v18.1.16 功能面:任务执行器 AgentBusyError 忙碌反馈、事件循环 keepalive、idle 封装截止时间(arming/deadline)、上下文笔记(context-notes)、advisor 每轮建议条数上限设置、GitHub Copilot OAuth 公共 GitHub/GHE 双 client-id、renovate 系配置面、auth-broker wire-schema 资源。
- 上游 v18.2.5 功能面:streaming CLI 命令、热路径记忆化(工具 schema/stamp/which 缓存)、Astra 上下文确定性策略、eval 判定桥与 Python prelude 维护、设置 Stream 分区与 stencil.so 流式认证。

### Web UI 侧栏重构(feat/sidebar-redesign,PR #19)

- 项目=父节点、会话=子节点:每个项目行内联展示自己的对话(今天/昨天/本周/更早 分桶,超 10 条折叠),折叠父级收起全部子会话;箭头折叠、点名称切换项目。
- ⌘K 聚合面板:新建会话 + 会话(五档时间分组/标题匹配) + 命令,全键盘导航;悬浮预览卡承载重元数据(id/项目/分支/相对时间)。
- 排序体系:会话排序与项目排序 popover(含手动序),统一持久化;`lib/sidebar-prefs` 单 schema 自动迁移旧键。
- 破坏性操作二级确认:浮动菜单删除会话、归档、TEMP 清除全部需显式确认对话框;项目删除保留原对话框。
- 立体层次:ze-btn/ze-btn-hero/ze-quiet 三档 elevation(顶部受光+内嵌高光+分层阴影)。
- 移除与"打开工作区"语义重复的头部文件夹按钮;临时会话区补排序/新建/空态。
- 网关新增 git 端点(branches/checkout/branch)与会话 temp 标记;stats 孤儿行修剪、临时目录摄入过滤、Zeta 品牌/主题。

### 修复

- 中文界面 `/settings` 布尔项无法关闭:显示文案(开/关)被误用于机器值匹配,导致切换恒落 true;现值与显示分离(SettingsList 新增 valueLabel/valueLabels)。
- `/language` 切换后斜杠命令描述不刷新:内置命令注册表快照在启动语言冻结;现在切换后即时重建命令段与补全提供器,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅、attach(`zeta attach`)模式提示此前为英文硬编码;全部接入 i18n 目录(新增 imPlanUltraModeEnabledFmt 等键)。
- `/loop`、`/rename` 描述入目录(上游新文案 en 保留,zh 补译),i18n 契约测试恢复全绿。
- bun 1.4.0 bytecode 编译产物启动崩溃(desktop smoke 全平台)。

## 1.1.10（2026-09-07）

### OMP 同步基线

- v18.1.11（tag commit `e3106be68f`）完整真合并（PR #9，`sync/omp-release/v18.1.11`）。

### 新增

- `retry.waitForUsageReset`：服务商报告用量耗尽并给出重置时间（5 小时 / 每周配额窗口）时，会话休眠至重置时刻，而不是超过 `retry.maxDelayMs` 后快速失败；等待可中断（Esc），但会挂起子代理。
- `bash.allowCompoundCommands`（可选开关）：对保守的字面量 `&&` 命令链逐段评估审批规则；要求已识别的 POSIX 引号语义 shell，整链 deny 优先于先前的 prompt，未匹配段沿用常规 bash 审批策略与模式。

### 修复

- 超长选中行无法放入读取上下文时，给出可用的 raw 恢复 selector，而不是无限循环的续读提示。
- WorkPool 子会话启动时构造增量 `yield` 工具 schema 不再崩溃。
- 越南语、韩语等带音调文字的 commit 摘要不再因长度上限被拒，且保留原样音调。
- 瞬态网关流失败重试，不再作为会话错误抛出；`extractRetryHint` 竞争信号按最长窗口合并。
- GitHub Copilot 登录只申请基础 profile 权限，恢复被拒绝 repo/gist/Codespaces 权限的企业组织登录。
- v18.1.11 合并损伤清零：复合命令审批功能（`shell-tokenize.ts`/`isPosixShell`/schema/bash.ts）与 zh 翻译（`retry.waitForUsageReset`/`bash.allowCompoundCommands`）在合并适配中被回卷，已逐项恢复并测试。

### 历史（1.1.9）

### OMP 同步基线

- v18.1.10（tag commit `f241301c83726afe75a847e919b89977a54dafbe`）完整真合并（PR #8，`sync/omp-release/v18.1.10`）：原生 Rust 编辑引擎（EditStore/EditSession/DiffStream）、`skillful` 技能列示、智能体表情回应、安全扫描命令族、发现/插件系统强化。

### 新增

- TUI 设置页全量汉化：顶部标签、分组标题、选项值、底部提示条、预览 chrome、斜杠命令描述全部跟随语言设置，`/language` 即时生效；修复侧边栏设置开启后 TUI 不渲染的回归，侧边栏内容重构（会话头/待办进度/子代理状态/MCP 健康，空面板隐藏）。

### 修复

- v18.1.10 合并损伤清零：UA 常量（全 provider 请求回到 `zeta/<version>`）、基础系统提示字节守卫、计划文件读取窗口、扩展检查器配置目录键、channel 工具顶层会话独占门控、`tracking_update` 门控、Windows 安装器（install.ps1）包名/仓库/二进制名还原。
- Rust 作业控制修复：管道子进程在等待注册前自行 SIGSTOP 时，brush-core 的停机检测永久失明（`run_string` 挂死）——`waitid` 改按 pid 查询 + wait 入口预检查已停子进程，附红绿回归测试；GitHub 托管 runner 首次执行 Rust 门禁即触发的环境潜伏缺陷。
- 品牌残留清零并进入 CI 守卫（`scripts/brand/brand-check.ts`，check job 每次运行）：oh-my-pi/.zeta/π 家族标记五级分类规则表 + 品牌 overlay 脚本（`brand-overlay.ts`），后续 OMP 合并的机械替换一步完成。
- i18n：zh 目录 OMP 自指清零（守卫测试固定）、设置项占位假翻译 74 处换真文案、上游 issue 链接等合法引用入册豁免。

### 1.1.8（历史）

- v18.1.5 合并损伤修复（六类清单第 4 类）：plan-ultra 模板选择、`.zeta/agents` 项目代理发现、每会话 `AsyncJobManager`、prompt-cache 守卫、模式状态版本通知、Z.ai OAuth 键名品牌。
- CI：bun-install action 改为安装 `packageManager` 钉住的版本（1.3.14 硬编码曾与 1.4.0 lockfileVersion 2 冲突）；`bun.lock` 重新生成为 lockfileVersion 1（bun2nix 只解析 v1）+ `nix/bun.nix` 同步重生成。
- 测试卫生中心化：`symlinkDirectorySync`（win32 junction）、temp 清理重试窗口 7.5s、locale 钉住策略。

### 新增（1.1.7 补充，随 OMP v18.1.2–v18.1.5 同步）

- OMP 同步基线更新：v18.1.2（`86bf72f52947`）+ v18.1.4（`39cf639c7b`）+ v18.1.5（`2b8471bc33`）三 tag 一串真合并（`sync/omp-release/v18.1.2`）。Agent Hub 活动流（`/hub` activity 分区 + `src/activity/` 模块）、`/trace` 命令 + stats 追踪面板、声明式 provider 认证注册表（registry/engine/hooks/oauth 重构）、Copilot 认证标准化、selector 转录回滚过滤、welcome tip latch、`boxDotted.*`/`icon.advisorClosed` 符号预设。
- 品牌覆盖：状态栏 `icon.omp` unicode 预设 π→ζ（ascii `pi`→`zeta`，nerd 保留 + 决议注释）；`ZETA_LOGO` 换 ζ 描边版（用户选定 B）；AGENTS.md 品牌登记表新增 `icon.omp` 守卫行。

### 新增（1.1.7，随 OMP v18.0.11 同步）

- OMP 同步基线：v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。gallery 预览 CLI、状态栏紧凑思考档位图标、MCP OAuth 嵌套路径发现（Keycloak realm 等）、工具调用后传输错误安全重试与 fallback、损坏/截断图片可行动报错不再卡死会话、聊天链接 OSC 8 超链接、空闲 CPU 降低；pi-vcs 索引刷新（`load_index_or_head`/`status_with_fresh_index`）取代临时 gix_fresh 方案。
- Web UI 主题系统：43 套完整浅/深预设（背景/面板/语法/图表 8 色板全量变量，主题 JSON 入库）、VS Code 风格中性 zeta-dark（`#1E1E1E` 底 + 灰阶面板）、预水合主题引导（首屏即正确主题，不闪白）。
- 桌面信任打开桥：web-ui 经 HMAC 网关令牌 + 目标 ID 白名单 + 工作区包含检查安全唤起桌面 shell 打开本地目录。
- `zeta serve --host` 自定义绑定地址（远程访问 URL 统一展示）；blob 网关端点（外部客户端上传/拉取会话二进制）；Bing 搜索 provider；IM 频道转发任务深度守卫（嵌套任务不重复投递）。
- 追踪面板 compaction 摘要持久化；提示缓存仅在内容字节变化时刷新；增量 plan-ultra 工作流（plan 文件按完整默认窗口读取）。

### 新增（1.1.6，随 OMP v18.0.9 同步）

- Web UI 改造：右侧工具坞（会话 / 文件 / 追踪 / 插件四窗格常驻导轨，插件管理器 PluginsManager 上线）、左侧 Default Space 常驻首组、消息"涉及文件"下拉与 ⚡ 推理强度 / ⏱ 耗时元信息、三平台统一 frameless 自绘标题栏（桌面壳 IPC 控制窗口）。
- 插件平台落地：`plugins/official/` 与 `plugins/community/` 目录结构、pi-messenger 纳入版本管理。
- Zeta CLI 品牌恢复：v18.0.3 合并回退的 `ZETA_LOGO`、终端标题 `ζ`、`/language` `/tracking` 图标等逐项恢复，AGENTS.md 新增品牌登记表护栏。
- 下线 web-ui-next（Vite）UI 线：`zeta serve` 只托管一套 Web UI。
- v18.0.10 同步项：原生进程替换（支持 CLI `/restart`）、`VcsGitRepo.mergeBase`（PR 式 diff 以 merge-base 为基准）、`execReplace`、设置新增 Sharpshooter 记忆组。
- OMP 同步基线：v18.0.10（`33cc6b9a043a`，v18.0.9 经由其历史一并并入）。git/jj 工具迁入新 Rust crate `pi-vcs`，经 `@linxiraos/pi-natives/vcs` 暴露；Zeta 自有 web 网关（上游无此目录）同步移植到新 API。v18.0.9 合并提交 `842390f707`，v18.0.10 合并提交 `c1ee701735`。

### 修复

- v18.0.9/v18.0.10 合并损伤修复：恢复 AgentSession 会话层 mode API（plan/goal/vibe，web 网关与 ACP 外部客户端恢复可用）、channel 工具（`channel_send`/`workspace_run`/`im_control`）接线、root catalog `@linxiraos/*` 键与版本线（1.1.5）、包名规范与 `.zeta` 测试契约。
- 修复扩展发现读不到项目级配置：原生扩展根解析把项目配置目录写死为 `.zeta`，`<project>/.zeta/` 下的扩展注册失效。
- CI 门禁修复：PR 不再拉取 npm 最新发布 addon 充当测试产物（同步分支因旧 addon 缺新原生导出而必红），所有事件一律从源码构建；隔离上游继承的 issue-966 restage 竞态测试并立项（roadmap P1）。
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
- **Zeta 品牌适配**：14 包统一 `@linxiraos/*` 版本线 1.0.11、`@oh-my-pi` 残留清零、`.zeta` → `.zeta` 路径、desktop / web-ui 版本号识别单源（desktop `package.json`）。

### 版本与发布流程（v1.1.0）

- 各包 CHANGELOG 统一 Zeta 版本线：移除上游 OMP `[15.x]`-`[18.x]` 段（OMP 日志为 Zeta 子集，上游变更并入 `[Unreleased]`），恢复 Zeta 早期版本记录。
- 发布日志门禁：`release-v2` 发布前校验（无上游段 + 每包 `[Unreleased]` 非空 + UPDATE-LOG 非空）；CI 加版本一致性 + CHANGELOG 结构校验（`scripts/check-version-consistency.ts`）。
- README 徽章（版本 / Bun / TypeScript / Rust / CI）；版本号脚本体系 `scripts/set-version.ts`（14 包 + catalog + Cargo + sentinel + desktop + web-ui + README badge 一键对齐）。

- 当前基于 **OMP 17.3.8**（`858f7dd91f`）。
- 完整合并 OMP 17.3.8 官方 tag（分支 `zeta/v1.1.10-17.3.8`，合并提交 `2bf455c9c3`，`git merge-base --is-ancestor` 已验证），59 个冲突按 AGENTS.md 政策表解决：
   - 保留 Zeta 包名/版本（`@linxiraos/*` @ 1.0.9、workspace 1.0.9、native sentinel `__piNativesV1_0_9`）。
   - 接受上游依赖图（`bun.lock` 以 `@linxiraos/*` 名重新生成、`Cargo.lock` 经 `cargo metadata` 对齐）。
   - 上游实现 + Zeta 覆盖（i18n 键、`.zeta` 路径、`@linxiraos` 导入、Zeta 特性）逐文件保留；测试按 tests-as-contract 成对接受并适配 `.zeta` → `.zeta`。
   - `issue-887-repro.test.ts` 保留（上游删除），其 qwen3.7-max 断言随 17.3.8 `models.json` 路由更新。
- 合并分支已并入 `main`（合并提交 `76588be094`，无冲突；跟随修复提交 `82309f384d` 在其上保留）。
- 跟随修复（Phase 1-8，见各包 `CHANGELOG.md`）：stats 独立窗口导航、更新流程（checking 态 / 已是最新提示 / CLI 交互确认与 `--yes`）、微信 v1 API 登录与 peer 持久化及解绑、飞书首聊 onboarding、`allowedPeers` 白名单、web-ui `/plan` 进入计划模式、models 配置卡片去重、desktop 二次点击恢复、桌面菜单 i18n、设置面板新增可编辑项。

### 发布与 CI

- v1.0.10 已发布：13 个 `@linxiraos/*` 包全量 1.0.10（trusted publishing），GitHub Release `v1.0.10` 含 18 个二进制/桌面/checksum 资产。
- 发布门新增修复（release-v2 工具）：`selectLatestZetaTag` 现在排除上游 OMP 17.x tag（其自带 `chore: bump version to 17.x` subject，会误判为 Zeta tag 阻断发布）；Cargo.toml `[workspace.package]` 缩进版本格式适配。
- 发布 CI 首轮暴露并修复：`retry.enabled` 设置分组错放（interaction → model）、9 个新增 `ui:` 块补全 zh 文案（含 17.3.8 新增的 `providers.cacheRetention` 及选项）、`structured-subagent.test.ts` 的 `.zeta` 路径适配 `.zeta`。

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
   1. _隐藏_：纯前端 localStorage 隐藏清单（按 projectRoot），列表过滤展示；不删任何文件，重新打开该仓库即恢复连接。
   2. _彻底删除_：新增网关 `DELETE` 工作区端点，级联清理该 cwd 名下全部状态——`~/.zeta/agent/sessions/<编码cwd>/` 整目录、`terminal-sessions/` 中引用这些会话的面包屑（否则 `--continue` 悬挂）、指向该 cwd 的 bot/draft 注册表绑定（`remote.sessionMappings`/`botSessions`）、运行中会话拒绝删除或先注销；未发现 per-workspace 锁文件，所谓"隐藏锁文件"实质就是 sessions 目录与面包屑残留。
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
