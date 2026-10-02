# `.zeta` 存储规范与插件存储契约

> 类型：架构设计文档（document/ 三类③）。时点：2026-10-02。
> 事实底座：`packages/utils/src/dirs.ts`（符号单一来源）+ 本机实树
> `~/.zeta` 对账（2026-10-02 普查）。教义依据：design-principles §2（配置根
> 是数据主权锚点）、§3（一切数据在 `~/.zeta`）。
>
> 本文关键词按 RFC 2119 解释（MUST / SHOULD / MAY）。

## 1. 规范目标与适用面

### 1.1 目标

用户数据主权是本地优先产品的根基：`~/.zeta` 是唯一配置/数据根，卸载即带走
全部状态。任何子系统、产品或插件**不得**在 user data 面自定 unix 路径散落
存储（`~/.pi`、`~/.zeta-myplugin`、`join(homedir(), ...)` 皆属违规）。
为什么：双根必然漂移；散落路径让备份/卸载/XDG 迁移全部失效，且是上游 pi
生态的实际损伤样本（见 §5.3）。

### 1.2 适用面

| 对象 | 约束强度 |
|---|---|
| Zetacode coding-agent（`packages/coding-agent`，bin zetacode 系） | 全规范 |
| Zetawork Rust 工作台（`main/`，bin zeta/zetawork） | §2 边界 + §3 命名 |
| Zeta editor（vendored TTT，bin zeta-e） | §2 边界（只读面） |
| Zetaide（vendored termide，bin zetaide） | §2 边界（零接触面） |
| 插件（`~/.zeta/plugins` 装载的全部扩展） | §4 契约，红线级 |
| 仓库 `scripts/` 下的运维/统计脚本 | §2 路径地图（只读为主） |

### 1.3 非目标

- **项目内 `.zeta/` 不在此规范**：`<project>/.zeta`（`getProjectAgentDir`，
  dirs.ts）是项目级配置面，由 coding-agent 的项目配置机制管辖。本文只在
  §4 涉及插件项目级状态时引用它。
- vendored 上游（TTT、termide）**自有** XDG 配置面（`~/.config/ttt`、
  `~/.config/termide`）不在整改范围——它们是上游产品身份；本规范只约束
  这些产品**写入 `.zeta` 的部分**。
- `./.zeta/merge-scope/`（仓库内开发目录，merge-scope-report.ts:63）是
  brand-rules.ts:27 明确的排除项，与配置根 `.zeta` 无关，勿混淆。

## 2. `.zeta` 规范路径地图（normative）

### 2.1 三层结构与解析规则

```
第 1 层  配置根          ~/.zeta                （profile 无关：getBaseConfigRoot）
         └ profiles      ~/.zeta/profiles/<name>/agent   （ZETA_PROFILE 派生）
第 2 层  agent 子树      ~/.zeta/agent          （coding-agent 专属：getAgentDir）
第 3 层  项目级          <project>/.zeta        （getProjectAgentDir，非本文范围）
```

解析规则（全部由 `DirResolver`（dirs.ts）承担，业务代码 MUST NOT 复刻）：

- **R1** 根目录名 `.zeta`（`CONFIG_DIR_NAME`）受 `PI_CONFIG_DIR` 覆盖
  （`getConfigDirName`）。
- **R2** Linux/macOS 上设了 `XDG_DATA_HOME/STATE_HOME/CACHE_HOME` 且目标
  存在时，按 data/state/cache 三档重定向到 `$XDG_*_HOME/zeta/`；首次迁移
  由 `zeta config migrate` / `init-xdg` 执行（dirs.ts 文件头）。
- **R3** `ZETA_PROFILE` 把 agent 目录派生为
  `~/.zeta/profiles/<name>/agent`；`ZETA_CODING_AGENT_DIR` 可显式覆盖
  （`setAgentDir`/`refreshDirsFromEnv`）。
- **R4** 一切新路径 MUST 经 dirs.ts 的 `DirResolver`（`rootSubdir`/
  `agentSubdir` + XDG 档）解析，禁止业务代码手拼
  `path.join(os.homedir(), ".zeta", ...)`。为什么：手拼路径绕过 XDG 与
  profile，等于在规范上开洞——现有反例：zeta-main settings.rs:117 直拼
  `USERPROFILE→HOME→.`、editor handoff.go:33 自算基目录（§2.4 声明其
  vendored 豁免与最低要求）。

### 2.2 路径总表（现状固化）

「在用（未生成）」= 源码在用、本机因功能未触发而缺席，非孤儿。

| 路径 | 归属 | 源码符号 | 状态 |
|---|---|---|---|
| `~/.zeta/install-id` | 共享安装锚 | `getInstallId` | 在用 |
| `~/.zeta/workbench.toml` | Zetawork | settings.rs:110-120 | 在用 |
| `~/.zeta/stats.db` | 共享（agent+stats+scripts） | `getStatsDbPath` | 在用 |
| `~/.zeta/logs/`（含 `http-400-requests/`、`.zeta.<pid>-audit.json`） | coding-agent/ai | `getLogsDir`/`getLogPath`、http-inspector.ts:93、logger.ts:257 | 在用 |
| `~/.zeta/plugins/{package.json,omp-plugins.lock.json,bun.lock,node_modules}` | 插件平台 | `getPlugins*`、loader.ts:101-123 | 在用（半安装态见 §5.2） |
| `~/.zeta/plugins/{data,cache,state}/<plugin-id>/` | 插件平台 | **本文 §4 新增** | 待规范 |
| `~/.zeta/handoff.json` | 共享接缝：pi-messenger 写 / editor 读 | handoff.ts:39-45 / handoff.go:26-38 | 在用 |
| `~/.zeta/cache/{github-cache,commit-inference,judgment-cache,legacy-pi-extension-cache}.db`、`auth-broker-snapshot.enc`、`avatars/`、`fastembed{,-runtime}` | coding-agent | 对应 `get*Cache*` | 在用 |
| `~/.zeta/{reports,ssh-control,browser-profiles,security,autoresearch}` | coding-agent | 对应 `get*Dir`（state 档） | 在用（部分未生成） |
| `~/.zeta/{remote,remote-host,python-env,browser-relay}` | coding-agent | 对应 `get*Dir`（data 档） | 在用（未生成） |
| `~/.zeta/{puppeteer,natives,webcache}` | coding-agent | 对应 `get*Dir`（cache 档） | 在用（未生成） |
| `~/.zeta/wt/<7hex>` | coding-agent | `getWorktreesDir`/`hashPath` | 在用 |
| `~/.zeta/run/{tiny,daemons,collab-hosts,provider-inflight}` | coding-agent | `getTinyWorkerRuntimeDir` 系、registry.ts:166 | 在用 |
| `~/.zeta/collab/<roomId>.jsonl` | coding-agent | guest.ts:449 | 在用 |
| `~/.zeta/{marketplaces.json,autoqa.db,auth-broker.token,snapcompact-savings.jsonl}` | coding-agent | 对应符号 | 在用（未生成） |
| `~/.zeta/workspace/` | desktop 默认工作区 | web-ui/lib/default-workspace.ts:5 | 在用（按需） |
| `~/.zeta/agent/agent.db`（settings+auth）、`history.db`、`models.db` | coding-agent | `getAgentDbPath` 等 | 在用 |
| `~/.zeta/agent/config.yml(.yaml)` | coding-agent | `MAIN_CONFIG_FILENAMES`+settings.ts:660 | 在用 |
| `~/.zeta/agent/web.yml` | coding-agent（web/desktop/channels/remote） | web-config.ts:258 | 在用 |
| `~/.zeta/agent/models.yml` | coding-agent | model-registry.ts:434 | 在用 |
| `~/.zeta/agent/.env` | coding-agent | env.ts:280-283 链第 3 环 | 在用 |
| `~/.zeta/agent/settings.json` | coding-agent legacy | settings.ts:2396-2444 只读迁移 | legacy（只读） |
| `~/.zeta/agent/sessions/`、`archive/sessions/` | coding-agent | `getSessionsDir`、archive.ts:42 | 在用 |
| `~/.zeta/agent/blobs/` | coding-agent | `getBlobsDir` | 在用 |
| `~/.zeta/agent/{themes,tools,commands,prompts,modules,memories}` | coding-agent | 对应 `get*Dir` | 在用 |
| `~/.zeta/agent/terminal-sessions/`、`custom-session-files/` | coding-agent | 对应符号（state 档） | 在用 |
| `~/.zeta/agent/cache/{tiny-models,document-conversions,composer,composer.db,eval-js}` | coding-agent | 对应符号、package-installer.ts:51,64 | 在用 |
| `~/.zeta/agent/{official-skills,python-gateway,skill-descriptions.db,kimi-device-id}` | coding-agent | builtin.ts:371 等 | 在用 |
| `~/.zeta/agent/{zeta-crash.log,zeta-debug.log,last-changelog-version,secret-placeholder.key,tracking-index.json}` | coding-agent | 对应 `get*Path` | 在用 |
| `~/.zeta/agent/messenger/` | pi-messenger | feat/teamagent-fixes 分支（main 仍写 `~/.pi/agent/messenger`，index.ts:130） | 迁移中 |
| `~/.zeta/agents/`（复数） | pi-messenger teamagent 用户 agent 定义 | teamagent-command.ts:36-40 | **待规范**（与 `agent/` 消歧，见 §3.2） |
| `~/.zeta/profiles/<name>/agent/` | coding-agent named profile | `getProfileConfigRoot` 系 | 在用（机制） |
| `~/.zeta/gpu_cache.json` | **无主** | 全仓库零写点 | **孤儿**（§5.1） |
| `<project>/.zeta/{config.yml,settings.json,tracking/,modules/,prompts/,plugin-overrides.json,mcp.json,ssh.json,agents/}` | coding-agent 项目层 | `getProjectAgentDir` 系、tracking.ts:17 | 在用（非本文范围） |
| `<project>/.pi/{pi-messenger.json,messenger/}` | pi-messenger 上游项目态 | config.ts:209、README.md:415 | 迁移中（随 messenger） |
| `~/.pi/agent/{extensions,messenger,skills,agents,npm}` | 上游 pi 残留 | pi-messenger install.mjs:23-27 | 孤儿（§5.3） |

### 2.3 产品边界声明（normative）

- **Zetacode（TS 全家桶）**：独占 `agent/` 子树；根部目录经 dirs.ts。
  desktop（Electron）只写 Electron `userData/desktop-settings.json` 与
  `app.getPath("logs")`（session-monitor.ts:126、main.ts:339-343），对
  子进程仅注入 `ZETA_DESKTOP=1`——现状合规，MAY 长期保持。
- **Zetawork（Rust）**：唯一落盘 `~/.zeta/workbench.toml`
  （settings.rs:110-120，原子写）。MUST NOT 写 `agent/` 子树、`plugins/`、
  `cache/` 或任何其它 `.zeta` 路径。布局/会话状态纯内存，无日志文件——
  这是边界声明，不是缺陷。迁移注意：settings.rs 直拼 home 绕过 R4，属
  已知违规豁免点（单文件、三键），改用 dirs.ts 前至少 MUST 认
  `ZETA_CONFIG_DIR`（§3.4）。
- **Zeta editor（Go/TTT）**：对 `.zeta` 全只读——读 `handoff.json`
  （handoff.go:30-36，`ZETA_HANDOFF_PATH` 可直指）与
  `plugins/node_modules/.bin/zeta-c`（handoff_to_agent.go:71）。MUST NOT
  写 `.zeta` 任何文件；自有状态归 `~/.config/ttt/`
  （internal/config/config.go:60-75，`TTT_CONFIG_DIR` 认领）。双写契约
  （handoff.ts ↔ handoff.go 无共享代码）双方 MUST 保持字段兼容。
- **Zetaide（Rust/termide）**：零接触 `.zeta`（全树 grep `ZETA_|\.zeta`
  零命中），自有 XDG 三件套 `~/.config|local/share|cache/termide/`。规范
  立场：保持零接触；若未来需与 agent 交互，走 handoff 式只读接缝，不新开
  写面。
- **脚本（`scripts/`）**：只读消费（stats.db、sessions、logs）；现有写点
  `~/.zeta/stats-audit-cache.json`（audit.ts:49）属散落路径，SHOULD 并入
  `cache/` 档；实树未生成，非紧急。

### 2.4 共享面白名单

跨产品/跨进程共享件 MUST 且只能落在根部白名单内：`handoff.json`、
`plugins/`、`install-id`、`stats.db`、`logs/`、`cache/`、`wt/`、`run/`、
`collab/`、`workbench.toml`、`workspace/`。新共享件进白名单 = 修本文 +
dirs.ts 增符号，一次 PR 完成。为什么：白名单外根部条目即孤儿候选
（§5.1 的 doctor 审计以 dirs.ts 已知集合为准）。

## 3. 命名规则（新路径准入）

### 3.1 两段式命名

新增目录 MUST 采用 `<product-or-domain>/<feature>` 两段式：

- 产品/域段：`agent/`（coding-agent 子树）或根部共享面白名单（§2.4）。
- feature 段：功能名（小写、单数优先、连字符分词，如 `terminal-sessions`、
  `browser-relay`）。
- 数据档位 MUST 显式声明（data/state/cache 三档之一），进 DirResolver。

为什么：两段式让 doctor 审计可以按域归因孤儿；档位声明让 XDG 迁移免费
获得（R2）。

### 3.2 消歧：单数 `agent/` vs 复数 `agents/`

`~/.zeta/agent/`（单数）= coding-agent 子系统树；`~/.zeta/agents/`（复数）
= pi-messenger teamagent 的用户 agent 定义集合。二者仅差一个 s，是现行
最大混淆源：teamagent-command.ts:36-38 写复数目录，而运行时发现只读
`getAgentDir()/agents`（task/discovery.ts:1-6、cli/agents-cli.ts:52）——
`--user` 注册的 agent 落盘即蒸发（确定性死路，ScoutTeam 修正清单①）。

规范裁定：**禁止新增任何复数 `agents/` 形态的根级/新目录**；teamagent 的
用户级定义 SHALL 收敛到 `~/.zeta/agent/agents/`（运行时已认此路径），根部
`~/.zeta/agents/` 按 §5.1 孤儿流程清退。为什么：一个字母的差价要用整个
用户的排障时间来付；收敛到运行时已消费的路径是零迁移成本的一侧。

### 3.3 单一来源纪律

- 新路径的目录名 MUST 只出现在 dirs.ts（加导出符号 + 档位）；业务代码
  只 import 符号，禁止散落 `join("...")` 字符串。
- 禁止大小写/复数/同义词混用（`Cache` vs `cache`、`plugin` vs `plugins`、
  `data` vs `datas`）。现有骨架全部小写单数（`cache/`、`run/`、`wt/`），
  新路径跟随。
- 教训实例：pi-messenger 同时使用 `agent/`（单数，发现侧）与 `agents/`
  （复数，注册侧），加上上游 `~/.pi/agent/{agents,extensions,skills}`
  四处散落——同一概念三个目录名，直接产出「装了但静默无效」的缺陷。

### 3.4 统一 override env

全产品统一语义：`PI_CONFIG_DIR`（TS 面已认，dirs.ts `getConfigDirName`）
与 `ZETA_CONFIG_DIR`（本文新增裁定：全产品等价 override，pi-messenger
handoff.ts:43 已自认此名）。新代码 MUST 只用这两个名字之一（推荐
`ZETA_CONFIG_DIR` 做长期名），禁止自造第三个。vendored 面（zeta-main
settings.rs、editor handoff.go）至少 MUST 认其中之一。为什么：三套
override 各自为政时，测试隔离与用户搬迁都会漏面。

## 4. 插件存储契约（核心）

### 4.1 现状与动机

插件装载根是 `~/.zeta/plugins`（npm 布局；loader.ts:8,101-123，
`collectPluginsAtRoot`：node_modules ∪ package.json dependencies ∪
omp-plugins.lock.json）。`InstalledPlugin`（types.ts:102-110）与 manifest
**均无 per-plugin 存储字段**；extensibility 全树无 dataDir/storageDir 概念。
后果：插件想持久化只能自定路径——pi-messenger 把协调状态写
`~/.pi/agent/messenger`、配置写 `~/.pi/agent/pi-messenger.json`、migration
标记写 `~/.pi/agent/messenger/migrations/`，四散且互相越界（§5.3）。
本节契约即为消除这一恶习而设。

### 4.2 per-plugin 目录约定（normative）

每个启用的插件获得三个宿主管辖目录，`<plugin-id>` 取 manifest id
（package.json 的 `omp` 或 `pi` 键所声明的身份；命名校验复用
marketplace/cache.ts 的 `isValidNameSegment`：alnum+`.-_`、≤64）：

| 档位 | 路径 | 语义 |
|---|---|---|
| data | `~/.zeta/plugins/data/<plugin-id>/` | 用户数据，卸载可清、升级保留 |
| cache | `~/.zeta/plugins/cache/<plugin-id>/` | 可随时重建，GC 首选 |
| state | `~/.zeta/plugins/state/<plugin-id>/` | 运行时状态（锁、游标、标记） |

实现落点：dirs.ts 新增三个符号 `getPluginDataDir(id)` /
`getPluginCacheDir(id)` / `getPluginStateDir(id)`，经 DirResolver 走对应
XDG 档。为什么放 `plugins/` 下而非根部：插件域自洽（装卸/审计/GC 一个
前缀扫完），且不污染 §2.4 共享面白名单。

项目级插件状态 MUST 放 `<project>/.zeta/`（现成 `getProjectAgentDir`
面），禁止 `.pi/` 等旧根。pi-messenger 现状 `<project>/.pi/messenger/`
（crew/store.ts:24-26）属迁移中债务，目标 `<project>/.zeta/messenger/`。

### 4.3 loader API 草案（函数签名级）

```ts
// packages/utils/src/dirs.ts —— 新增
/** Per-plugin persistent data dir (~/.zeta/plugins/data/<id>). */
export function getPluginDataDir(pluginId: string): string;
/** Per-plugin rebuildable cache dir (~/.zeta/plugins/cache/<id>). */
export function getPluginCacheDir(pluginId: string): string;
/** Per-plugin runtime state dir (~/.zeta/plugins/state/<id>). */
export function getPluginStateDir(pluginId: string): string;
// 三者共用：校验 pluginId（isValidNameSegment 语义），非法 id 抛 TypeError；
// 经 DirResolver 对应档位解析（XDG/profile 感知免费获得）。

// packages/…/extensibility —— InstalledPlugin 增字段（types.ts）
interface InstalledPlugin {
  // …现有字段…
  /** Host-managed storage roots for this plugin. */
  storage: {
    /** Persistent user data. Caller must mkdir as needed. */
    dataDir: string;
    /** Rebuildable cache. May be wiped by GC at any time. */
    cacheDir: string;
    /** Runtime state (locks, cursors, migration markers). */
    stateDir: string;
  };
}
```

扩展 ctx 同步暴露同一 `storage` 对象；loader 实例化插件时惰性
`mkdir(recursive)` 三目录并注入。为什么宿主创建而非插件自建：目录存在性
是宿主契约，插件不得假设也不得在别处重建。

### 4.4 禁止清单（红线）

插件 MUST NOT：

1. 自定 unix 路径持久化——`join(homedir(), ".pi", ...)`、
   `~/.zeta-<name>`、`~/.<plugin-name>` 等一律违规；持久化只能写 ctx
   `storage` 三目录或项目级 `<project>/.zeta/`。
2. 读写其它插件的 `plugins/{data,cache,state}/<other-id>/` 目录。
3. 写 `.zeta` 白名单（§2.4）之外的任何宿主路径（含 `agent/` 子树、
   `config.yml`、`web.yml`、`sessions/`）。
4. 写上游根 `~/.pi/`、`~/.omp/` 及其任何子路径。
5. 绕过 loader 直接改 `omp-plugins.lock.json` / `package.json` /
   `plugin-overrides.json`。

违规即 review 拒收；宿主侧守卫见 §6.2。

### 4.5 迁移钩子

沿 pi-messenger 已验证的先例（`~/.pi/agent/messenger/migrations/
legacy-crew-agent-cleanup-v1.json`：标记文件 + 一次性执行 + 幂等）：

- 插件自带 `migrations/` 目录，每个迁移一个 JSON 标记（含 `migratedAt`）；
  首次在新布局运行时检测旧路径数据 → 一次性复制到 ctx `storage` → 落
  标记；标记存在即跳过。重复执行 MUST 无副作用（幂等）。
- 宿主把 dirs.ts 内部 `adoptLegacyFile`（legacy 路径一次性采纳到 XDG
  新址）提升为公共 API，供插件复用同款「搬家不丢数据」语义。
- pi 专属插件的更名立场：名字带 `pi`（`pi-messenger`、`legacy-pi-*`）是
  **血统标注**（上游来源记录），不是品牌违规，不做 sweep——与
  design-principles §2「icon.pi 保留」同一逻辑：语义字符/血统名不等于
  品牌残留。禁止的是**写**上游 `.pi` 路径，不是叫这个名字。

### 4.6 卸载语义

`zeta plugins uninstall <id>` SHALL 连带清理该插件的
`data/`、`cache/`、`state/` 三目录（现状只动 node_modules+lock）。涉及
用户数据时提示确认。为什么：卸载残留正是「散落路径无法回收」的另一面；
宿主管辖目录使回收成为纯目录删除。

## 5. 孤儿与清理

### 5.1 孤儿处置

实树对账（2026-10-02）唯一无主物：`~/.zeta/gpu_cache.json`（31B，全仓库
零写点，疑似外部工具或运行时产物 [INFERENCE]）。处置规则：

- 根级条目不在 dirs.ts 已知集合 → 标记 unmapped；「源码地图不存在且
  90 天未动」才进入清理候选。孤儿文件只提示不自动删——它可能是用户或
  外部工具的合法数据（数据主权教义的反面：宿主也不许越权删用户的东西）。
- 已知孤儿即刻可清（用户确认后）：`gpu_cache.json`；
  `~/.zeta/agents/`（§3.2 清退后确认无消费方）。

### 5.2 plugins/ 半安装态

本机现状：`plugins/` 有 `omp-plugins.lock.json`+`bun.lock` 但
`node_modules` 缺失——loader.collectPluginsAtRoot 无 node_modules 即返回
空（loader.ts:101），实际插件数为 0，登记与安装脱节。处置规则：doctor
类工具 MUST 检测「lock 有 / node_modules 无」并提示
`zeta plugins install` 重建；GC 不得自行删除 lock（它是用户意图记录）。

### 5.3 上游残留清扫

装过上游 pi 版插件的机器存在 `~/.pi/agent/{extensions,messenger,skills,
agents,npm}`（install.mjs:23-27 的散装布局）。处置：doctor 检测后提示
「迁移到 `~/.zeta` 对应新址 + `zeta plugins install`」，用户确认后整树
删除 `.pi` 残留。MAY NOT 自动删除。为什么：那是上游产品目录，可能有非
Zeta 管辖的 pi 安装仍在使用。

### 5.4 清理工具约定

- `zeta doctor` 增加路径审计：枚举 `.zeta` 顶层条目对照 dirs.ts 已知
  符号集合，未匹配报 unmapped；`plugins/` 报半安装态；`.pi` 残留报迁移
  提示。
- `logs/`、`wt/`、`run/`、`security/`、`autoresearch/` 已有各自 GC/保留
  策略，审计不重复清理、不越权删。
- 清理工具自身 MUST 经 dirs.ts 取路径（它也是被规范约束的代码）。

## 6. 生效与守卫

### 6.1 Review 清单（新代码落盘路径相关 PR 必查）

1. 新路径有 dirs.ts 符号吗？（无 → 打回，§3.3）
2. 有档位声明吗？（data/state/cache 三选一，§3.1）
3. 路径名小写、单数、连字符分词？与现有骨架一致？（§3.3）
4. 是否引入新的复数 `agents/` 形态？（禁止，§3.2）
5. override env 只用 `PI_CONFIG_DIR`/`ZETA_CONFIG_DIR`？（§3.4）
6. 插件代码是否只写 ctx `storage` 或 `<project>/.zeta/`？（§4.4）
7. 迁移逻辑幂等 + 有标记文件？（§4.5）

### 6.2 守卫测试方向（可选实现）

- **grep 断言**：新增轻量 CI 检查（模式同 brand-rules.ts 的机械守卫）：
  - `packages/` 与 `main/crates/`（豁免清单除外）内禁止
    `\.zeta["'/]`、`homedir\(\).*zeta` 之类裸拼；命中必须能对上 dirs.ts
    导入。
  - 插件官方目录内禁止 `\.pi[/"]`、`\.omp[/"]` 字面量。
- **fs 快照测试**：插件契约测试装载一个 fake 插件，断言其写入仅落在
  `plugins/{data,cache,state}/<id>/` 三个根内（pathIsWithin 断言，
  dirs.ts 已有该谓词）；越界写入用例必须失败。
- **doctor 单测**：构造含孤儿文件/半安装 plugins/ 的临时根，断言审计
  输出分类正确。

### 6.3 生效

本文自合入 main 起生效。§2.2 中「待规范」「迁移中」条目按各自迁移计划
收口（messenger 迁移在 feat/teamagent-fixes 线），收口后更新状态列。
新路径准入 = 修改本文 §2.2/§2.4 + dirs.ts 符号，同一 PR 完成。
