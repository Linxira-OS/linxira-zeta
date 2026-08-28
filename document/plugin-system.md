# Zeta 插件系统设计（草案）

> 内部设计文档，未打包。目标：为 Zeta 官方/社区插件、插件商店、以及
> pi-messenger 这类用户可选插件的安装/发布/依赖关系提供统一方案。
> 状态：草案，2026-08-26 评审通过关键决议，进入多版本准备。

## 背景

- `@linxiraos/pi-messenger` 是第一个用户可选插件：不随主包打包，用户按需安装。
- 教训：1.1.0/1.1.1 发布时只改了 `name`/`version`，`peerDependencies` 和源码
  import 仍指向上游 `@earendil-works/*`，导致 Zeta 用户安装时把整套上游运行时
  当 peer 拉进来，扩展加载到的是上游运行时而不是 Zeta 运行时（"依赖关系没弄对"）。
- 上游（OMP/pi 生态）插件数量会增长，每次都往上游拉/手动改会越来越混乱，需要
  Zeta 自己的插件清单与查询体系。

## 目标

1. 用户可选的插件安装，分两种路径：
   - **web/CLI**：npm 装包，直接装进 CLI 的扩展系统。
   - **桌面应用**：从 GitHub 源码拉取，或从 release 拉插件压缩包，解压后自动
     安装到桌面二进制对应的插件安装路径。
2. 插件商店：在 web UI / 桌面应用中显示，支持离线展示与在线更新。
3. 插件分两套（定义更严谨）：
   - **官方（official）**：Zeta 第一方移植/维护。由我们亲自把其他开源仓库（
     MIT、Apache-2.0 等）的插件 fork/移植过来，或 Zeta 自研插件。来源与
     依赖改写都由我们负责，保证正确。
   - **社区（community）**：外部第三方提交、或收录自 pi/omp 上游、经我们
     验证可用的插件。
4. 上游插件集成时必须改写依赖/源码 import（`@earendil-works/*` → `@linxiraos/*`），
   确保扩展 peer 到 Zeta 运行时。
5. Zeta 自己的插件查询/清单体系：一次集成、收录进我们的清单，用户/桌面/网页
   都查我们的清单，不每次往上游拉。

## 仓库布局

```
plugins/
├── official/                     # Zeta 官方插件（源码在仓内开发）
│   ├── <plugin-id>/
│   │   ├── plugin.json / plugin.toml  # 清单（随打包一起分发）
│   │   ├── package.json          # @linxiraos/*，peer 全部指向 @linxiraos/*
│   │   ├── src/                  # 扩展工厂源码（registerTool / registerCommand）
│   │   ├── crew/ skills/ locales/ README.md CHANGELOG.md tests/
│   └── INDEX.md                  # 官方插件追踪文档（类别、来源、兼容性）
└── community/                    # 社区：只有元数据指针文件，不放代码
    ├── <plugin-id>.json|.toml    # 上游仓库地址 + 依赖处理说明 + 准入 CI 证明
    └── INDEX.md                  # 来源、拉取方式、兼容性记录
```

- 每个集合根目录的清单/菜单可直接打包进桌面或 web，支持离线显示或在线更新。
- 社区集合的 `INDEX.md`：写明每个插件从哪里获得、怎么拉取、是否兼容过、
  兼容性描述。官方集合同样有一份小文档 + 关键字段。

## 清单字段（草案，plugin.json / plugin.toml）

```jsonc
{
  "id": "pi-messenger",
  "name": "Messenger",
  "description": "Inter-agent messaging and file reservation",
  "source": "https://github.com/nicobailon/pi-messenger",
  "publish": "@linxiraos/pi-messenger",   // npm 包名（若走 npm）
  "install": "npm",                        // npm | github | release-zip
  "compat": { "zeta": "^1.1.0" },
  "unuse": false,                          // true = 暂不启用（不展示/不安装）
  "category": "community"                  // official | community
}
```

- 机器可读清单字段以 JSON 为主；TOML 用于偏配置/人设类条目（persona、agent
  定义），两者等价、可互转，解析器二选一。
- 官方/社区集合的菜单与追踪文档用 markdown（人类可读、可叙述兼容性）。

## 依赖关系规则

- 任何上游插件集成进 Zeta 前，必须把 `@earendil-works/*`（以及任何上游运行时
  引用）改写成 `@linxiraos/*`：
  - `package.json` 的 `dependencies`/`optionalDependencies`/`peerDependencies`。
  - 源码 import（`*.ts`/`*.mjs`/`*.js` 等）。
- 工具化：`scripts/publish-missing-packages.ts` 的 `rewriteEarendilDeps` 在发布
  pi-messenger 前自动改写、发布后恢复。自 `plugins/official/` 标准路径生效起，
  该改写成为官方插件的**常驻构建步骤**（源码内直接持 `@linxiraos/*` 引用），
  不再依赖发布时临时改写。
- 版本线：用户可选插件（如 pi-messenger）不强制进主构建，但版本号跟随 Zeta
  发布版本，避免与其他 `@linxiraos/*` 包版本线撕裂。

## 发布与查询

- 查询系统（待设计）：Zeta 自己的插件清单端点/目录，web 与桌面都从它查询，
  支持离线缓存与在线更新；不直接依赖上游仓库的实时状态。
- 发布路径：
  - web/CLI：`@linxiraos/*` npm 包（trusted publishing）。
  - 桌面：GitHub release 插件压缩包，或仓库内 vendored 源码打包。
- pi-messenger 当前：已在 npm（1.1.0/1.1.1），本地源码位于 `temp/pi-messenger`
  （gitignored，路径不对）。**现有 npm 1.1.1 暂不动**；待迁移到
  `plugins/official/pi-messenger/`、本地开发逻辑跑通后，随下个 release 版本线重发。
- 插件相关支持包：除 pi-messenger 外，后续大概率还会有更多插件依赖的
  支持包，统一走同一套发布/依赖规则。

## 贡献指南与社区准入

- 根 `README.md` 提供第三方插件贡献指南：
  - 如何把仓库配置正确并正常 npm 发包（trusted publishing / OIDC）。
  - 即使不走 npm 发包，若 fork 了别人 pi/OMP 的插件，也要在插件清单里
    写明针对我们 `@linxiraos/*` 的依赖改写关系。
- `docs/`（随产品打包的运行时文档树）对包依赖关系做描述，便于贡献者核对。
- 社区插件准入流程：
  1. 外部贡献者提交 PR（携带插件清单 + 依赖改写说明）。
  2. 我们为其提供/要求一套插件 CI 与 test，专门校验依赖是否改写正确
     （`@earendil-works/*` → `@linxiraos/*`、peer 解析、加载冒烟）。
  3. 该 CI 通过后，评审通过，才把插件描述加入 `plugins/community/` 索引。
- 官方插件定义更严格：仅指我们第一方移植/维护的开源插件（MIT、Apache-2.0
  等）或 Zeta 自研插件；来源与依赖改写都由我们负责。

## 2026-08-26 设计决议（评审通过，进入多版本准备）

### 官方插件三件套与依赖顺序

```
P0 agent-team（无 UI）—— 基座，前置中的前置
   ├── 场景一：多代理任务编排（crew: plan → work → review）
   └── 场景二：个人助理 / 多 AI 人设群聊（多个配置的 AI 各自带人设自主对话）
        ↑ 依赖                ↑ 依赖
     P1 桌宠助手（带 UI）   P2 科学插件（带 UI）
```

- P0 是「前置的前置」：P1（系统级桌宠助手，Linux 首发）与 P2（科学插件）都依赖它。
- 场景二（个人助理群聊）是 agent-team 的第二个形态：配置多个 AI、各自带人设，
  自主聊天，Neuro-sama 类娱乐向联动；它是 P1 桌宠「有性格」的底层能力。
- 三个插件目标在同一体系内一次性打通：同一份 manifest v2、同一套动态插入机制。

### 仓库内标准路径（取代 `temp/pi-messenger`）

- 问题：pi-messenger 源码现位于 `temp/pi-messenger`（gitignored，等同未版本化），
  打包路径与逻辑都不对。
- 决定：官方插件统一收进 `plugins/official/<plugin-id>/`，成为仓库内受管子仓库。
- `plugins/official/pi-messenger/` 标准模板：

  ```
  plugins/official/pi-messenger/
  ├── plugin.json / plugin.toml    # 清单（id/name/source/publish/install/compat/category）
  ├── package.json                 # @linxiraos/pi-messenger，peer 全部指向 @linxiraos/*
  ├── src/ 或入口 index.ts         # 扩展工厂：registerTool / registerCommand
  ├── crew/agents/*.md             # 团队代理定义
  ├── skills/                      # 自带 skills
  ├── locales/{zh,en}.json         # i18n 字符串表（宿主注入 t()）
  ├── README.md / CHANGELOG.md
  └── tests/
  ```

- 打包/发布：从 `plugins/official/<id>/` 构建并 trusted-publish；版本线与 Zeta
  发布版本对齐；`@earendil-works/*` → `@linxiraos/*` 的 peer/源码改写成为该插件
  **常驻构建步骤**，不再依赖发布时临时改写。

### 清单格式：JSON + TOML 双格式

- 机器可读清单 JSON 为主；TOML 用于偏配置/人设类条目（persona、agent 定义），
  两者等价、可互转，解析器二选一。
- `community/` 目录 = 纯指针文件（JSON 或 TOML）：上游仓库地址 + 依赖处理说明
  （如何映射到 `@linxiraos/*`）+ 准入 CI 证明文档；不放代码。

### 分发与查询（A + B 双轨）

- A 构建期打包：发布时把 `plugins/` 目录快照打包进产物（离线可用、版本锁定），
  方式同 `PI_DOCS_EMBED`。
- B 运行时刷新：手动「刷新目录」从 GitHub raw 拉最新 `plugins/community/`
  （带缓存）。
- 桌面与 web 共用同一份商城页（web-ui 内置「插件」页）；桌面壳只加两处小活：
  托盘菜单列出已启用并声明 windows 的插件（如 P1 悬浮窗开关）、安装影响原生
  窗口时提示重启 shell。

### 平台与模式决议

- P1 桌宠：**Linux 首发**。
- science/research：**新增 Zeta 模式，由插件安装后注册**。前置小重构：把
  `ModeId = "plan" | "goal" | "vibe"` 硬编码 union + enterMode/exitMode 的 switch
  抽为 `ModeRegistry`——内置三模式平移为默认注册项（行为零变化），插件贡献
  `{ id, promptPack, toolWhitelist, enter, exit }`。
- 调度器：做进 **`zeta serve` 进程内的插件调度模块**（P2 定时文献扫描/pipeline 与
  P1 定时主动行为共用）；pulse-daemon 保持地基定位，仅接收调度事件上报。

### pi-messenger 激活链路（试点）

- CLI：`zeta plugins install @linxiraos/pi-messenger` → 装进 `~/.zeta/plugins/`
  （`installPlugin()` 现有实现）登记 lock 文件；或 settings `extensions` 路径
  走 `discoverExtensionPaths()`。激活后：`pi_messenger` 工具（join/send/reserve/
  release/plan/work/review）+ `/messenger` 指令 + crew agents 自动发现 + skills 加载。
- 桌面：spawn `zeta serve`（`ZETA_DESKTOP=1`）服务端加载同一插件，工具经网关
  自动可用；但 `/messenger` 的 TUI overlay 在 `!ctx.hasUI` 分支直接返回——web
  需要独立显示面，不能复用 TUI overlay。
- web 显示面（team agent 特有）：成员名册、消息流、文件预留、任务看板、
  messenger 设置——全部走 manifest v2 `pages` + gateway `/api/plugin-assets` iframe
  动态插入。
- i18n：插件侧字符串表约定（manifest 声明 `locales/{lang}.json`），宿主注入 `t()`；
  messenger 现有英文硬编码文案抽出 + zh 条目。

## 未决问题（2026-08-26 更新）

- 插件商店 UI 交互细节（已定共用 web-ui 商城页，交互未细）。
- 桌面插件签名/校验（防篡改）。
- P0 场景二（人设群聊）的编排规则与交互形态（Neuro 系玩法细化）。
- `ModeRegistry` 重构的兼容面验证（内置三模式行为必须零变化，含回归测试）。
- 社区插件准入 CI 的具体形态（依赖改写校验 + 加载冒烟）。
