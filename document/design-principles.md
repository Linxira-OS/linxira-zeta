# Zeta 设计理念与项目内容总览

> 面向开发者的架构/设计总览，属 `document/` 内部规范许可的第三类（架构设计
> 文档）。时点：2026-10-02。规则的操作细节一律以来源文件为准，本文只收束
> 「理念是什么、为什么」，每条教义给一句「为什么」。
>
> 信息来源：根 `AGENTS.md`、`document/webui-desktop-overhaul-plan.md`
> （下称「本批次 spec」）、`document/roadmap.md`、`document/upstream-sync.md`、
> 参考项目调查 deepseek-harness（dsh）与 zcode-ui-reference（ZCode）
> （`agent://ScoutHarness/report`、`agent://ScoutZcode/report`）。

## 1. 产品定位与四产品线

**来源：`AGENTS.md`（Zeta Direction / Brand Surface Registry）、本批次 spec §13、
`roadmap.md`（Deferred Queue TUI 套件条）。**

Zeta 是 OMP（oh-my-pi，github.com/can1357/oh-my-pi）的下游发行版：运行时树、
包布局、Bun workflow、内部 `@linxiraos/*` 命名**刻意**跟随 OMP，唯一目标是
上游 release tag 永远可合并。分叉的自由度只留给品牌面与产品面。

- 为什么：结构跟随是可合并性的前提；产品差异化收拢到少数显式注册的面
  （品牌注册表、产品前门），合并才不变成每次全树考古。

**平台立场**（`AGENTS.md` 用户批注 + 损伤类别 7）：Linux（Linxira OS，Arch 系）
一等公民；Windows 开发二等公民；macOS 已整体退出发布面（2026-10-01 裁定，
`web_ui_build` darwin 矩阵与 `warm_darwin` 移除，无 darwin 消费方不得回引）。

- 为什么：每个发布平台都是持续的 CI 与损伤面成本，无消费方的平台只产损伤。

**四产品线**（bin 命名 2026-09-30 定稿）：

| 产品线 | 包 | 标准名（唯一对外文案） | 兼容别名 | 形态 |
|---|---|---|---|---|
| Zetawork 工作台 | `@linxiraos/main`（`main/` 独立 Rust workspace） | `zetawork`（裸 `zeta` 同指工作台） | `zeta-work` | 嵌套终端工作台：tab = 窗格布局快照，窗格 = 真 PTY 终端（zetacode / zetaeditor / shell 为子进程）；零快捷键基线——一切元素可鼠标高效点击，快捷键只是可选加速器 |
| Zetacode 编码 CLI | `@linxiraos/zeta`（`packages/coding-agent`，仓库主包） | `zetacode` | `zeta-c` / `zeta-cli` | 编码 agent CLI + `zeta serve` 网关 + IM 渠道；`APP_NAME`("zeta") 仍是产品身份（配置根/日志名/归因头/splash） |
| Zetaide | `@linxiraos/ide`（termide） | `zetaide` | `zeta-i` / `zeta-ide` | 终端 IDE |
| Zetaeditor | `@linxiraos/editor`（vendored TTT） | `zetaeditor` | `zeta-e` / `zeta-editor` | 终端编辑器 |

**命名裁定（2026-10-09）**：四个标准名一律**无连字符**（zetawork / zetacode /
zetaide / zetaeditor）。连字符形式只作为 `package.json` `bin` 兼容别名存在，
用户可见文案、`CLI_BIN_NAME`、提示串、示例一律写标准名；`zeta code` 这类带空格
写法不是 bin，任何文案不得出现。文件/垫片名语境（`zeta-c.cmd`、`zeta-capture-*`、
`zeta-cli-*` 资产名）是例外，机械 sweep 的正则须排除 `[\w.-]` 后缀。

两个 IDE（ttt 与 termide）并存观察，不二选一。壳坚定 Rust（真 PTY 窗格；
参照系 fresh：绘制时登记命中区，渲染几何即命中几何）。

**bin 命名教义**（本批次 spec §13.4，红线级）：

1. **展示一律 canonical**；连字符别名内部可存、绝不展示。
   为什么：用户可见串是承诺面，别名扩散让文档与支持面失控。
2. **空格形式零容忍**：`zeta code|work|editor|ide` 这类内部 hand-off 语法
   保留，但任何用户可见串（README、help、UPDATE-LOG）不得出现。
   为什么：空格形式误导用户把参数喂给工作台 bin——`main` 对 `-` 开头参数
   静默吞掉，2026-10-02 实测静默失败的元凶即此类。
3. **`CLI_BIN_NAME` ≠ `APP_NAME`**：命令行提示插值必须用 `CLI_BIN_NAME`；
   `APP_NAME`("zeta") 是产品身份（配置根/日志名/归因头/splash），勿把配置
   /线值扫成 CLI bin 名。
   为什么：resume 提示曾用 `APP_NAME` 插值打出 `zeta --resume`（裸 zeta 是
   Zetawork 的 bin），用户照敲即静默失败（spec §13.1 P0）。
4. **兼容内部保留**：别名注册在包 `bin` 字段里照常工作，只是不进文档/帮助
   文案。为什么：老用户的肌肉记忆是兼容面，不是宣传面。
5. **发包规矩**：全包系统一版本号（依赖不强制最新）；新包先由用户手动以
   现行版本号占位首发，npm trusted publishing 配好后才接自动发布链
   （`main-publish.yml` 已备未接线）。
   为什么：自动发布链一旦误触发，占位错误会写进 npm 历史。

## 2. 品牌教义

**来源：`AGENTS.md`（Zeta Brand Surface Registry / OMP Release Sync Policy）、
本批次 spec §12（D12）、`roadmap.md`（P2 TTT About）。**

- **ζ 品牌**：CLI 终端标题字符 `ζ`（title-generator）、`ZETA_LOGO` 字符画、
  `icon.omp` unicode 预设用 `ζ`。`icon.pi`（π）与 latex-to-unicode 的 π 条目
  **保留**——那是 provider 图标与数学转换语义，不是品牌残留。
  为什么：品牌收拢要精确，语义字符被误扫恰恰是过度品牌的损伤。
- **`.zeta` 配置根**：配置目录 `.zeta` / `~/.zeta` 唯一，无上游名别名；上游
  测试/文档携带的上游配置目录路径在合并时改写为 `.zeta` 并记入账本。唯一
  刻意保留的兼容目录是 `.omp-plugin`（OMP/Claude 插件清单兼容面，勿扫）。
  为什么：配置根是数据主权的锚点，双根必然漂移，兼容别名只会让两边都坏。
- **`zeta://` scheme 唯一**：内部文档/资源 scheme（`zeta://docs` 根别名保留）；
  出现 `omp://` 即全树 sweep（代码/提示词/docs 语料/测试 fixture），
  v18.2.5 起不再保留 alias handler，`brand-check` MUST_NOT_CONTAIN 强制。
  为什么：scheme 出现在提示词与语料里，残留等于把上游身份喂给模型。
- **npm scope `@linxiraos/*`**：上游 `@oh-my-pi/*` 全量改写；唯一例外是
  driver 的 `OMP_SCOPE` 必须保留 `@oh-my-pi/` 字面量（MUST_CONTAIN 守护）。
  为什么：那是改写机制自身的输入，扫掉它机制就自毁。
- **上游兼容面立场（D12 用户裁决：兼容删除，除产品面板）**：纯品牌残留
  全删（`lib/omp-models.ts`、`lib/omp-auth.ts`、`models-cache`、死 icon 目录
  等 11 项）；迁移期项（env 回退、旧键迁移、旧文件名读取等 7 项）保留至
  下一版本复审；**产品功能误伤警示单列勿删**（`request-security`/
  `session-reader`/`pi-types` 与 `@earendil-works/pi-*` 依赖——运行时协议
  非品牌残留；`/api/stats` rewrite 与用量面板本体；`ZetaWebTitle`）。
  为什么：兼容代码不是免费的，每行都是认知税；但协议依赖与品牌残留是两
  回事，删错了是把功能当垃圾。
- **法律署名保留**：THIRD_PARTY_NOTICES 的署名行不可删；vendored 上游组件
  （如 TTT，MIT）保留 upstream attribution 行，旁加 Zeta 发行身份
  （`Zeta Editor · v<zeta 版本> · TTT <上游版本>`）。
  为什么：署名是 fork 的合规义务，也是 fork 存在的诚实记录。
- **守卫机制**：机械规则进 `scripts/brand/brand-rules.ts`，
  `bun scripts/brand/brand-check.ts` 进 CI check job；散文文档只留判断。
  产品前门（README/logo/名称/主页/安装文档）每次完整合并后用单独的
  branding-overlay commit 恢复。
  为什么：v18.0.3 合并曾静默回翻 ζ 品牌——散文规则不可执行，机械守卫才
  挡得住合并。
- **刻意不品牌化**：中继/分享 URL `my.omp.sh`、安装提示 `omp.sh/install`
  （共享 OMP 基础设施）、native Tokio 安装导出 `__ompInstallTokioRuntime`
  （crate/index.js/loader 三方一致协议，sweep 会让 Tokio 静默不装）、上游
  进程间协议符号（`__omp_with_call_site__` 等负断言 marker）。
  为什么：守卫的对面是「不该扫的别扫」——v18.0.10 与 v18.1.21 的反向损伤
  全部来自过度 sweep。

## 3. 数据主权教义

**来源：本批次 spec §2.2、`roadmap.md`（Shipped / P1 Mobile / P2 stats）、
`AGENTS.md`（损伤类别 11）。**

- **一切数据在 `~/.zeta`**：会话 `~/.zeta/agent/sessions/<encoded-cwd>/
  <timestamp>_<uuid>.jsonl`（标题槽 256B）、用户命令 `~/.zeta/commands/`、
  默认工作区 `~/.zeta/workspace`、媒体 blob `~/.zeta/agent/blobs`；项目级
  `<project>/.zeta/tracking/` 是唯一允许的项目内落点。
  为什么：本地优先产品的承诺是「卸载即带走全部状态」——没有云端副本，
  也就没有云端依赖与云端泄露面。
- **统计只统计自己的**：`packages/stats` 是本地可观测仪表盘，只消费本机
  用量数据，不外发；跨包只读快照自带类型（`TrackingSnapshot`），禁止
  import coding-agent 类型。
  为什么：观测面一旦变成数据外流通道或反向类型耦合，数据主权与包边界
  同时失守。
- **跨面 token 只扫一面 = 事故**：同一 token 存在于 producer/consumer 两侧
  ——worker argv 协议（源 `__omp_worker_*` ↔ cli.ts 派发侧）、env 契约
  （测试设 `PI_CODING_AGENT_DIR` ↔ 源只读 `ZETA_*`）、UA 正则、CLI 提示串、
  XDG 目录名、测试夹具写死的版本坐标。只扫一面的症状是 `check:ts` 全绿但
  运行时/CI 才炸（v18.4.3 首轮六红同根）。规则：清扫必须 producer+consumer
  成对；`brand-rules.ts` 的 MUST_NOT_CONTAIN「跨面 token 对」组常驻守卫；
  版本相对夹具一律从 `packageJson.version` 推导；Cargo.lock 任何改动后必须
  重刷 MODULE.bazel.lock。
  为什么：跨面契约的损伤不在编译期显形，成对清单 + 机械守卫是唯一便宜
  的防线。

## 4. UI 设计教义

**来源：本批次 spec §4（决策表）/§11（参考基线，含不采纳记录）、两份参考
项目调查报告。主参考 dsh（deepseek-harness），副参考 ZCode（自带
DESIGN.md 设计系统）。**

1. **草稿直开（首发才建会话）**：任何 `+` 入口直接把主区切到空态 hero 并
   聚焦输入框；首条消息发出才会话落盘；弹窗只是降级路径（`NewSessionDialog`
   已随 D2 删除）。为什么：创建会话是机制不是仪式——两个参考产品独立收敛
   出同一模式（dsh「New Session clears to empty state」+ zcode
   `resolveWorkbenchNewTaskTarget` 三级解析），前置表单消灭了「打字即发」。
2. **默认工作区保底**：草稿 cwd 解析链 = 入口指定 → 默认工作区
   （`~/.zeta/workspace`）→ 两者皆不可用才整卡降级为选择触发器；不存在
   无 cwd 草稿态，chip 可改。为什么：空态 hero 的价值是零步进输入，任何
   「先选路径」的强制步骤都在惩罚新会话。
3. **项目 = 侧栏一级分组**：分组键 = `projectRoot`（gateway 侧归并
   worktree），组内会话平铺、**无时间桶**；置顶全局浮顶、临时会话独立区
   （temp 判定在网关，与项目组互斥）、归档沉底。视口收窄的让步顺序为
   details → 中栏 → 侧栏，侧栏折叠成图标轨而非卸载。为什么：用户心智的
   单位是「项目/工作目录」而不是时间——双层分组头曾把条目二次切碎成噪音
   （spec §3 根因 5），侧栏则是导航的家，永不让步。
4. **hover 渐显范式**：行内 chrome（排序/`+`/终端/删除/⋯）默认
   `opacity:0; pointer-events:none`，触发行 `:hover`/`:focus-within` 时
   0.12s 浮现；操作簇预留固定宽度（68px 模式）防行宽抖动；CSS 实现，
   不用 JS 状态。为什么：常驻按钮堆是视觉噪点主源（spec §3 根因 2），
   hover 化把操作从视觉负担降为按需 affordance，且键盘可达（focus-within）。
5. **单状态点优先级链**：行内状态合成单点，优先级 = 等待用户交互 >
   运行中 > 未读完成；完整状态进 aria 隐藏文本 + hover card（路径/绝对
   时间/全部状态）。为什么：多徽章并排互相淹没；单点 + 优先级把「需要我
   现在看吗」压缩成一次扫视（dsh `Rows.tsx:231-269`、zcode
   `task-row.tsx:387-427` 同构）。
6. **空会话特殊呈现**：`messageCount===0` 且 >24h、非运行中、非置顶的
   会话不进常规列表，在组尾渲染「N 个空会话」折叠行；「清理」是唯一动
   数据的操作（批量 DELETE + 二次确认）；24h 内/运行中/置顶的空会话正常
   渲染。为什么：CLI 一次性运行、fork 副本、worker/relay 都会留 0 消息
   文件，列表曾是一排 `"(no messages)"`；但用户刚建的草稿绝不能被藏掉。
7. **composer 两形态一组件**：hero（空态居中）与 docked（会话贴底）是同一
   `ChatInput` 的位置迁移，DOM 跨态存活；草稿文本按 draftKey 持久、跨形态
   不丢；`DraftContextBar`（工作区 chip + 分支 chip）两形态共用。分支 chip
   仅显式切换才 checkout，绝不自动 checkout。
   为什么：换组件会丢焦点/草稿/IME 状态——「one InputBar moves position
   rather than swapping components」。
8. **触发符管线**：`/` `@`（斜杠命令/文件引用）走统一 combobox 管线，焦点
   留在 textarea，IME 组合安全；命令模式显式声明，绝不由草稿内容推导。
   为什么：触发符是输入的语法层，各自实现必然键盘行为不一致（dsh
   `ui-input-trigger/controller.ts`、zcode `promptInputTriggers.ts` 同构）。
9. **语义 token 纪律**：沿用现有 `styles/` 主题 token 体系（默认
   `zeta-dark` 首启暗色；系统 UI 字体栈 + CJK 回退，无远程字体依赖；
   Starfield 仅作 legacy 可选主题）；特性组件不写字面色、不写主题分支。
   **明确不采纳**：dsh 的 748px 内容轴/r22 圆角/业务蓝交互色（那是 dsh 的
   品牌语言）、zcode 的用户自定义分组（登记 roadmap）。
   为什么：token 纪律让主题与暗色成为免费副作用；参考项目的具体视觉值是
   它的品牌而非普适规范，搬值等于换品牌。
10. **规范文档先行**：改 UI 前先读/先写规范（ZCode 的 DESIGN.md 把违规
    定性为「design-system defects」且 AGENTS.md 声明「修改 UI 前阅读」；
    dsh 用 32 行权威 styling 文档 + 每个非平凡变更一篇含被否方案的
    agent note）。本文与 spec 的「决策表 + 参考基线（含不采纳理由）」
    即该模式的 Zeta 形态。
    为什么：UI 走样不是品味问题而是规范缺失；「为什么 + 被否方案」写下来
    才能阻止下一轮返工。
11. **红线契约**：项目分组 + running-session SSE + final-answer fold 是
    视觉重排不许破坏的 preserved contract（v1.1.10 起锁定）；本批次网关
    零新增端点、零 DTO 变更（D8），AppShell 对外 Props 不变。
    为什么：网关契约是 CLI/web/desktop 三客户端共用的地基，UI 迭代不许
    顺手改地基。

## 5. 工程教义

**来源：`AGENTS.md`（Zeta Direction / 增量合并规程 / Post-Merge Checklist /
Feature Branch Workflow / Documentation Layout / Planning Discipline）。**

### 5.1 四上游角色与合并策略

| 上游 | remote | 角色 | 规则 |
|---|---|---|---|
| OMP | `omp-upstream` | 运行时树 | 只在官方 release tag 集成；`sync/omp` 是未修改镜像（仅 fast-forward，永不并入 main）；`sync/omp-release/<tag>` 短命分支做**真双亲 merge（禁止 squash）**；合并前 `git merge-base` 必须等于上一个已集成 tag 的 peeled SHA |
| Pi | `pi-upstream` | 特性语义移植源 | 永不 raw merge（`port/pi/<scope>` 分支），保留 OMP 刻意分叉 |
| OMP Web | `omp-web-upstream` | **已冻结** | `feat/desktop-ui-upgrade` 起分叉为 Zeta 自有演进；仅手工 cherry-pick 并逐笔记账本 |
| Pi Web | `pi-web-upstream` | web 特性语义移植源 | `port/pi-web/<scope>`；保 OMP 运行中 SSE 契约，不移植 Pi-only runtime facade |

- 为什么 non-squash：谱系一断，merge-base 退化为远古祖先，theirs 侧退化成
  全量追赶窗口 diff——v18.2.1→v18.2.4 的 1300+ 冲突与多轮 CI 损伤即此根源。
- 为什么只按 tag：tag 间的原生增量才是「上游改了什么」的干净语义；把我们的
  分叉卷进合并计算会让冲突量随分叉时长爆炸。

### 5.2 测试 = 契约

上游 commit 同时改实现与测试时**整对接受**，禁止留 Zeta 侧旧断言陪跑
（v17.2.11：上游把 retry-after 30s→200ms，合并却保留旧 `delayMs: 30_000`
——红 CI）；每个被触碰的测试文件对照 `v<tag>` 版本逐文件 resolve。

- 为什么：旧断言与新行为共存不是保守，是把契约撕成两半；测试的价值在它
  钉住行为，不在它属于哪一方。

### 5.3 损伤类别矩阵

`AGENTS.md` 的 11 类合并损伤（catalog 版本线 / Cargo 版本+哨兵 / 包名映射 /
Zeta-only 代码静默丢弃 / 本地 natives 漂移 / XDG 路径测试 / 上游 CI 基建 /
rustfmt 折叠翻转 / 测试全局符号 / 发布链组装竞态 / 跨面 token 单侧清扫），
每类带症状指纹、修复规则；triage 指纹把 CI 失败直接路由到对应检查（所有
job 死在 bun-install ⇒ 版本线损伤，先跑 `check-version-consistency`，不要翻
测试日志）。推送 sync 分支前六项最低门槛：version-consistency 零漂移 +
`check:ts` 零错误 + 类 3 grep + `brand-check` 归零 + 动过 crates 时
`cargo fmt --all --check` 归零 + `check-ci-surface` 归零。

- 为什么：每次 OMP 合并都反复砸坏同一批 release surface，矩阵把历史损伤
  变成 push 前的机械检查；「删校验让链变绿」（类 10）是静默漏发，所以
  preflight 校验严禁删除、判定 CI 绿必须核对 jobs 数。

### 5.4 Feature Branch Workflow

新方向（非纯修复）一律先开本地离线分支，**计划写定时必须命名分支**；每次
push 集成分支前先 `git merge main` + 本地门禁；push → PR → CI 绿 → 云端
合并 → 本地 main 同步 → 删分支。`dev/<topic>` 实验分支由用户亲自开、默认
无 PR/CI 要求、**永不合并进 main**——结论沉淀成规则（AGENTS.md /
merge-playbook），代码按正常流程重新落地；失败即删。

- 为什么：main 只保留已发布/稳定工作；实验的价值是结论不是代码，让实验
  代码绕过评审路径等于给 main 埋雷。

### 5.5 document/ vs docs/ 路由

`docs/` 是运行时文档：打进二进制（`PI_DOCS_EMBED`）并经 `zeta://docs/` 服务。
`document/` 是内部开发/过程文档：永不打包，且只放三类——①当前执行计划
（新计划生效即删旧计划，一律不并存）；②未开发的后期规划（登记 roadmap 的
Deferred Queue，不另立计划文）；③架构设计文档（本文即此类）。已完成/被
取代的计划发现即删，结论沉淀进规则表、注册表或 roadmap。

- 为什么：文档腐化的主因是已完成计划滞留——「保留个历史」的实际效果是
  让下一个读者分不清哪份是现实。
- 附：计划纪律——plan 是执行 spec 不是设计文档，decision-complete（承重
  选择全部写死）、自包含、完成后剪除；plan 产物落在 userdata 根（`local://`
  → `~/.zeta` 会话工件），不入仓库工作树。

## 6. 项目内容地图

**来源：根 `AGENTS.md`（Package Structure / Code Location Rules）、
`packages/*/package.json` description、本批次 spec §2、`roadmap.md`（Shipped）。**

### 6.1 packages/*（一句话职责）

| 包 | 职责 |
|---|---|
| `coding-agent` | 主包：编码 CLI（bin zetacode 系）、`zeta serve`、web-gateway、渠道宿主、InteractiveMode/TUI 宿主 |
| `ai` | 多 provider LLM 客户端（流式、自动模型发现与 provider 配置） |
| `catalog` | 模型目录：bundled models.json、provider 描述符、模型身份/分类/等价（import 惯例：从 `@linxiraos/pi-catalog/<module>` 导值，`pi-ai` barrel 只出类型） |
| `agent` | agent 运行时：工具调用、状态管理、附件、传输抽象 |
| `tui` | 终端 UI 库（差分渲染；i18n 文本层 `setTuiTextSource` 可注入） |
| `utils` | 共享工具：logger、streams、dirs、vterm、压缩档解析、mermaid-ascii 等 |
| `natives` | Rust N-API 绑定：PDF/音频/WebRTC/grep/剪贴板/图像/语法高亮/PTY/shell |
| `stats` | 本地用量可观测仪表盘（bin `zeta-stats`） |
| `omptype` | ArkType 兼容 schema 校验（懒 JIT） |
| `channels` | IM 渠道适配：WeChat / Feishu / Telegram（`ChatChannel`/`ChannelHost`） |
| `collab-web` | 协作 live session 的浏览器 guest 客户端与本地中继工具 |
| `browser-relay` | Chrome 扩展：让 agent 浏览器工具驱动用户既有标签页 |
| `wire` | 包间共享 wire 协议类型 |
| `snapcompact` | 位图帧上下文压缩（vision LLM） |
| `mnemopi` | 本地 SQLite 记忆引擎 |
| `metaharness` | 统一 benchmark 运行器 + Harbor run 存储 + REST/SSE API + 仪表盘 |
| `typescript-edit-benchmark` | TS 源码变异编辑基准套件 |

**native 层**：`crates/pi-natives` Rust crate + committed bindings
`packages/natives/native/index.{js,d.ts}` + 版本哨兵 `__piNativesV1_X_Y`；
CI 由 bazel 现场构建（本地 `.node` 预编译产物不入库、合并后需重建——损伤
类别 5）。Zeta 自有能力（tracking、autoresearch、custom commands、
marketplace、ACP、渠道、远程 token 鉴权、trajectory、mermaid、`/share`）
见 `roadmap.md` Shipped 表。

### 6.2 三大 UI 面 + 渠道面（代码各归其家，依赖方向永不倒置）

```
desktop/ (Electron)  ──HTTP──▶  zeta serve (zeta-server.ts)  ──▶  packages/coding-agent/src/**
web-ui/ (Next.js)    ──HTTP──▶  webGatewayFetch (/api/*)     ──▶  packages/coding-agent/src/server/web-gateway/
TUI (packages/tui + InteractiveMode)  ──进程内──▶  packages/coding-agent/src/**
channels (src/channels)  ──嵌入 zeta serve──▶  ChannelHost + channel_send/workspace_run 工具
```

- **TUI 面**：`packages/tui`（差分渲染库）+ `coding-agent` 的
  `InteractiveMode`；Zetawork 工作台把 zeta-c/zeta-e 作为 PTY 子进程嵌套。
- **web-ui/**：Next.js 独立快照，自有包管理器与规则（`web-ui/AGENTS.md`），
  不是根 Bun workspace 包，不 carry 自己的 workflow（检查全在根 `ci.yml`）；
  `feat/desktop-ui-upgrade` 起为 Zeta 自有演进。
- **desktop/**：Electron 壳（托盘/frameless 自绘标题栏/会话完成通知），
  **零业务 UI 代码**——嵌入 web-ui standalone 构建 + zeta 二进制 + 捆绑
  Node（`prepare-runtime.mjs`），只经 HTTP loopback 对话
  （30141 web / 3847 stats），永不 import `packages/*` 或 `web-ui/*` 源码。
  「one source, two outputs」：桌面嵌入的 web-ui 与浏览器 UI 同源同构建。
- **渠道面**：`src/channels` 嵌在 `zeta serve`；渠道工具走 surface-scoped
  sink 模式——构造期接线（只有 serve 协调器与 bot 会话拿到 sink），不是
  运行时门；合并时必须保住「subagent/临时会话永不拿 sink」的不变量。

### 6.3 gateway 分层

`web-gateway.ts` 持路由正则（`*_RE` 常量）与 `webGatewayFetch` 分发；
`server/web-gateway/` 每资源一个 handler 模块（sessions/projects/settings/
models/open/web-config/archive…），handler 只 import coding-agent 内部源；
`web.yml` 配置层（tray/autostart/channels/remote）被网关与桌面壳共读。

- 为什么分层/单向：方向一旦倒置（UI 面出现服务端代码），冻结的上游就再也
  合不回来——依赖方向是可合并性在代码布局上的表达。

## 7. 在途轨道

**来源：本批次 spec §8/§10/§13、`upstream-sync.md`（账本）、`roadmap.md`
（Deferred Queue / Priorities）；v18.4.4 与 pi v1.0.0、teamagent 的在途状态
来自当前任务上下文。**

1. **上游合并（v18.4.4 在途）**：v18.3.3+.34 增量双 tag、v18.4.3 五 tag 直拉
   已在 `dev/main` 实验线按「上游增量合并规程」完成（v18.4.3 带入
   check-ci-surface 机械化：job 清单/needs 接线/产物名三查）。v18.4.4 合并
   在途，剩余步骤 = 六阶段管线后段（结构修复 → 品牌 overlay → 逐 bucket
   测试契约 resolve → brand-check 归零 + 全绿）+ 实验线结论回 main 的正常
   Feature Branch 落地。
2. **web-ui 大修（本工作树 `feat/webui-sidebar-overhaul`，发布硬门）**：
   批 0 切分支/基线截图 → 批 1 清场（D12 兼容面 11 项删除 + D13 i18n 债
   接线）→ 批 2 IA 重排（删 action row/死代码、`ProjectsSection`、组头
   hover 化、去时间桶）→ 批 3 草稿直开（空态 hero + `DraftContextBar`，
   删 `NewSessionDialog`）→ 批 4 命名规则 + `EmptySessionsFold` → 批 5
   偏好统一 P2（`zeta-web:sidebar-preferences-v2` 单一偏好源）→ 批 6
   merge main → PR → CI 绿 → 桌面 dist 冒烟 → 合并。
3. **发布门规则（硬性）**：下一次 release CI 之前必须完成本计划全部批次 +
   验收 1-17 全绿 + 桌面链路（desktop_linux/windows）在含本计划的 commit
   上跑绿 + tag release 的桌面产物内嵌新 web-ui（冒烟断言「项目」section
   文案存在）；未满足不得打任何 release tag；判定 CI 绿必须核对 run 的
   jobs 数（1-job run 是 flake 评估器）。
4. **CLI 指令面修复（独立分支 `fix/cli-command-surface`）**：P0
   resume-command 提示错名（`APP_NAME` → `CLI_BIN_NAME`）；P0 update-cli
   自更新链（shim 劫持工作台 `zeta.exe`、REPO/MISE 指向上游）；P1 约 18
   个文件 run-string 错名；空格形式展示违规零容忍（根 README / `main` help /
   UPDATE-LOG，brand-rules 扩 MUST_NOT_CONTAIN 守卫）；P2 语料；P3 卫生
   （游离孤儿文件删除、裸 `zeta` 回退候选收窄）。
5. **pi v1.0.0 语义移植排队**：pi 仍是特性语义移植源；v1.0.0 的移植项按
   语义移植纪律逐项评估排队（`port/pi/<scope>`，保留 OMP 刻意分叉，
   不移植 Pi-only 运行时 facade）。
6. **teamagent 修正**：随 agent-team 插件线推进（设计登记于
   `document/plan-zeta-ui-carryover.md` Z5+U11 批、
   `document/session-map-web.md`）；具体修正项以任务分配为准。
7. **其余排队项（roadmap）**：compaction as a service（专用 compaction
   agent + 分相进度事件）、tracking+prompt-cache 写序规则、上下文文件
   热更新（AGENTS.md 变更感知）、OpenCode 命令三种类迁移、记忆稳定性
   （Bun 1.4 锁文件/CI pin + 内存护栏）、移动远程控制硬化（`--host`、TLS、
   配对 QR、token 轮换）、Linux mainline 分发（1.1.19 起 `[linxira]` pacman
   仓 + linxira-update 自动送达）、TUI 工作台迭代（菜单栏系统/设置页/
   布局编辑器/files 选型；拖拽交互暂缓）。

## 附：一句话总纲

结构跟随 OMP（可合并），品牌与产品面归 Zeta（可辨识），数据归 `~/.zeta`
（可带走），跨面契约成对清扫（可运行），测试当契约合并（可信任），
损伤变机械守卫（可推送），计划写死再执行（可交付），规范先行并记录被否
方案（可维护）。
