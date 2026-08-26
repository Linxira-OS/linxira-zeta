# Zeta 插件系统设计（草案）

> 内部设计文档，未打包。目标：为 Zeta 官方/社区插件、插件商店、以及
> pi-messenger 这类用户可选插件的安装/发布/依赖关系提供统一方案。
> 状态：草案，等待评审后进入实现。

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
├── official/                     # Zeta 官方插件
│   ├── <plugin-id>/
│   │   ├── plugin.json           # 清单（关键字段 + unuse 标记）
│   │   ├── README.md
│   │   └── <源码或打包产物>
│   └── INDEX.md                  # 官方插件追踪文档（类别、来源、兼容性）
└── community/                    # 社区（上游收录）插件
    ├── <plugin-id>/
    │   ├── plugin.json
    │   ├── README.md
    │   └── <源码或打包产物>
    └── INDEX.md                  # 来源、拉取方式、兼容性记录
```

- 每个集合根目录的清单/菜单可直接打包进桌面或 web，支持离线显示或在线更新。
- 社区集合的 `INDEX.md`：写明每个插件从哪里获得、怎么拉取、是否兼容过、
  兼容性描述。官方集合同样有一份小文档 + 关键字段。

## 清单字段（草案，plugin.json）

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

- 我方自研插件用 JSON 标记（含 `unuse` = 暂不启用）。
- 是否用 JSON 还是 markdown 承载：官方/社区集合的菜单与追踪文档用 markdown
  （人类可读、可叙述兼容性），机器可读的清单字段用 JSON。两者并存。

## 依赖关系规则

- 任何上游插件集成进 Zeta 前，必须把 `@earendil-works/*`（以及任何上游运行时
  引用）改写成 `@linxiraos/*`：
  - `package.json` 的 `dependencies`/`optionalDependencies`/`peerDependencies`。
  - 源码 import（`*.ts`/`*.mjs`/`*.js` 等）。
- 工具化：`scripts/publish-missing-packages.ts` 的 `rewriteEarendilDeps` 在发布
  pi-messenger 前自动改写、发布后恢复。
- 版本线：用户可选插件（如 pi-messenger）不强制进主构建，但版本号跟随 Zeta
  发布版本（1.1.3 等），避免与其他 `@linxiraos/*` 包版本线撕裂。

## 发布与查询

- 查询系统（待设计）：Zeta 自己的插件清单端点/目录，web 与桌面都从它查询，
  支持离线缓存与在线更新；不直接依赖上游仓库的实时状态。
- 发布路径：
  - web/CLI：`@linxiraos/*` npm 包（trusted publishing）。
  - 桌面：GitHub release 插件压缩包，或仓库内 vendored 源码打包。
- pi-messenger 当前：已在 npm（1.1.0/1.1.1），下一次按本规则重发
  （依赖改写后 @1.1.3）；发布机制从"本地脚本 + 2FA"迁移到 CI
  （trusted publishing）。
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

## 未决问题

- 插件商店的 UI 形态与交互（web 与桌面一致？）。
- 插件清单的存放/分发：仓库内静态文件 vs 独立服务。
- 桌面插件的签名/校验（防篡改）。
- 官方插件的类别目录与首批清单。
