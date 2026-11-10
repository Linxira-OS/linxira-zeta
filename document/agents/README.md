# document/agents/ — 从根 AGENTS.md 移出的操作知识

根 `AGENTS.md` 只留**每次会话都要生效的规则**。这里放它原来承载的**操作细节**：
什么时候读哪一份、照着做什么、失败时按什么指纹排查。

原则：

- **单一正本**。本目录不复制架构文档；`document/*.md` 的解释在那边，这里只放
  「合并 / 发布 / 分支 / 代码落点」这类操作知识。
- **原文搬家**。各文件头部有一行 provenance 注释，标明是 2026-10-25 从根
  `AGENTS.md` 原样移出、未改写。之后修订请直接改这里，不要回写到根文件。
- **根文件保留指针**。`AGENTS.md` §11 是路由表；新增本目录文件时同步登记。

## 目录归属

本目录按问题分目录；一个格只放一类知识，同一规则不要抄两份。

| 目录 | 放什么 | 不放什么 |
|---|---|---|
| `merge/` | 上游 tag 同步的逐阶段规程、损伤类别、非代码文件归属 | 品牌值（`brand/`）、日常分支流程（`workflow/`） |
| `brand/` | 品牌面逐行注册表、待扫清单、合并后恢复规则 | 判定分类（`document/brand-surface-rules.md`） |
| `surface/` | 产品面定义、代码/包落点、Studio 设计检查表、渲染性能测量协议 | 架构解释（`document/architecture-layers.md`） |
| `workflow/` | 分支登记与推送纪律、GitHub 交互、npm 发布、robomp | 发布链完整 job 表（`document/release.md`） |

新增/移动本目录文件时，必须同时更新本索引与根 `AGENTS.md` §11。

## 索引

| 目录 / 文件 | 什么时候读 | 覆盖内容 |
|---|---|---|
| `merge/sync-procedure.md` | 要同步一个上游 tag，需要逐阶段清单 | 六阶段管线摘要、上游增量合并规程（tag 间差异、merge-base 校验、禁止项） |
| `merge/damage-classes.md` | 合并后、或合并后 CI 红 | 15 类发布面损伤：症状 / 规律 / 修复规则 + triage 指纹 + 推 sync 分支前的最低门禁 |
| `merge/file-ownership.md` | 冲突时判断非代码文件归谁 | 产品前门 / `.github/**` / 其它文件 / `docs/` 的默认与例外 |
| `document/archive/squash-sync.md` | 想知道"为什么不能 squash" | 【历史档案】已废止的压缩式流程，**不是可选方案** |
| `brand/registry.md` | OMP 合并后逐行核对品牌面 | 逐行注册表：canonical 值 + 守卫方式 + "刻意不改"清单 + 启动字符画定稿 |
| `surface/code-locations.md` | 不确定代码该落哪个目录 | `web-app/`（渲染器）/ `studio-host/`（`/api/v1/*`）/ `studio-web-app.ts`（静态服务）/ gateway / channel / main / termide 归属、依赖方向、退役前的内嵌架构、上游面 vs Zeta 自有面 |
| `surface/surfaces.md` | 不确定某功能属于哪个产品面 / 名字对不对 | 三个产品面（Work Studio / `zetacode` / `zetaide`）的入口、形态、代码落点与发布线；「不存在 Rust UI」、旧名 `zetawork` 的确切含义 |
| `surface/packages.md` | 查包职责、插件目录约定 | 包清单表、`plugins/` 两层结构 |
| `surface/studio-design-checklist.md` | 改**冻结的** `web-ui/` 快照里的 Studio 面（产品渲染器 `web-app/` 不适用） | 快照的设计验收标准：颜色归属（`--studio-*` 桥接 L2）、四个字号角色、4/8/12/16/24 节奏、状态覆盖（loading/empty/error/active/disabled）、焦点环与对比度底线 |
| `surface/web-app-performance.md` | 要测渲染器性能 / 复现前后对比 | `web-app` 测量协议：六项基线指标、perf harness 的构建与启动、数字记录格式 |
| `workflow/branches.md` | 开工前 / 推送前 / 清理 worktree | 并行子代理流程、feature branch、内部整合批次（一次推）、`dev/*`、工作树纪律、`temp/` 与安全清理 |
| `workflow/branch-registry.md` | 开分支 / 删分支 / 搞不清某条分支干什么 | 分支登记簿：命名即生命周期、在册表（用途/负责人/何时删）、退役表（含 SHA，可恢复）；`scripts/check-branch-registry.ts` 在本地门禁校验 |
| `workflow/release-publish.md` | 动发布面或新包引导 | npm trusted publishing 两步握手、新包手动首发顺序、冻结发布面的 dispatch 开关（`publish_web_ui`） |
| `workflow/robomp.md` | 想复刻上游 issue→修复 PR→发布哨兵自动化 | robomp 的 webhook/队列/worktree/host tools、PR 前门禁、release sentinel 的真实职责与 Zeta 采纳边界 |
| `workflow/github.md` | 要发评论 / 改 PR 描述 | PR 模板、贡献者原话要求、changelog 归属 |

## 与其它文档的边界

| 想知道 | 读 |
|---|---|
| 合并的完整手册（逐 bucket、契约 resolve、overlay 用法） | `document/merge-playbook.md` |
| 合并前 checklist、守卫矩阵、lineage gate | `document/merge-review.md` |
| 品牌判定分类（SUBSTITUTE / COMPAT / DUAL / OVERTURN） | `document/brand-surface-rules.md` |
| 发布链 job、tag、更新日志、版本线 | `document/release.md` |
| 日常编码约定 | `document/dev-conventions.md` |
| 同步台账与历史决策 | `document/upstream-sync.md` |
| Blob / artifact 存储 | `document/blob-artifact-architecture.md` |
| 会话树与分支 | `document/session-tree.md` |
| 主代理互通场景 | `document/agent-mesh-scenarios.md` |
| 外来配置 / 工具档位 / 提示词归属 | `document/external-sources-and-tool-exposure.md` |

机械守卫（CI `check` job 执行，不靠人记）：

```
bun scripts/check-version-consistency.ts   # 版本线 / catalog 键（损伤类 1、2）
bun scripts/check-scope-imports.ts          # @linxiraos/* 必须可解析（类 3）
bun scripts/check-zeta-sentinels.ts         # Zeta-only 代码未被合并吞掉（类 4）
bun scripts/check-ci-surface.ts             # CI job / needs / 产物名 / matrix 键（类 7、10、12、14）
bun scripts/check-license-map.ts            # 许可分层
bun scripts/check-release-asset-names.ts    # zeta-cli-* 资产名
bun scripts/check-removed-upstream-files.ts # 已退役上游文件不得复活
bun scripts/check-no-upstream-defaults.ts   # 设置默认值不得指回上游 host
bun scripts/check-doc-host-parity.ts        # docs host 与台账一致
bun scripts/brand/brand-check.ts            # 品牌残留
```

外来配置门禁与工具档位的计划守卫（`check-native-prompt-sources`、
`check-foreign-consent`、`check-tool-profile`、`check-context-budget`、
`check-mcp-shadow`）见 `document/external-sources-and-tool-exposure.md` §9；
实现前不要当成已存在。

`document/` 在 `scripts/brand/brand-rules.ts` 的 `SKIP_PREFIXES` 里：本目录允许
按原样保留上游记号（`.omp`、`my.omp.sh`、`PI_LOGO` 等），不会被品牌扫描判红。
