# document/agents/ — 从根 AGENTS.md 移出的操作知识

根 `AGENTS.md` 只留**每次会话都要生效的规则**。这里放它原来承载的**操作细节**：
什么时候读哪一份、照着做什么、失败时按什么指纹排查。

原则：

- **单一正本**。本目录不复制架构文档；`document/*.md` 的解释在那边，这里只放
  「合并 / 发布 / 分支」这类操作知识。
- **原文搬家**。各文件头部有一行 provenance 注释，标明是 2026-10-25 从根
  `AGENTS.md` 原样移出、未改写。之后修订请直接改这里，不要回写到根文件。
- **根文件保留指针**。`AGENTS.md` §11 是路由表；新增本目录文件时同步登记。

## 索引

| 目录 / 文件 | 什么时候读 | 覆盖内容 |
|---|---|---|
| `merge/sync-procedure.md` | 要同步一个上游 tag，需要逐阶段清单 | 六阶段管线摘要、上游增量合并规程（tag 间差异、merge-base 校验、禁止项） |
| `merge/damage-classes.md` | 合并后、或合并后 CI 红 | 14 类发布面损伤：症状 / 规律 / 修复规则 + triage 指纹 + 推 sync 分支前的最低门禁 |
| `merge/file-ownership.md` | 冲突时判断非代码文件归谁 | 产品前门 / `.github/**` / 其它文件 / `docs/` 的默认与例外 |
| `merge/squash-sync.md` | 想知道"为什么不能 squash" | 【历史档案】已废止的压缩式流程，**不是可选方案** |
| `brand/registry.md` | OMP 合并后逐行核对品牌面 | 逐行注册表：canonical 值 + 守卫方式 + "刻意不改"清单 + 启动字符画定稿 |
| `surface/code-locations.md` | 不确定代码该落哪个目录 | desktop / web-ui / gateway / channel / main / termide 归属、依赖方向、退役前的内嵌架构、上游面 vs Zeta 自有面 |
| `surface/packages.md` | 查包职责、插件目录约定 | 包清单表、`plugins/` 两层结构 |
| `workflow/branches.md` | 开工前 / 推送前 / 清理 worktree | 并行子代理流程、feature branch、内部整合批次（一次推）、`dev/*`、工作树纪律、`temp/` 与安全清理 |
| `workflow/release-publish.md` | 动发布面或新包引导 | npm trusted publishing 两步握手、新包手动首发顺序 |
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

机械守卫（CI `check` job 执行，不靠人记）：

```
bun scripts/check-version-consistency.ts   # 版本线 / catalog 键（损伤类 1、2）
bun scripts/check-scope-imports.ts          # @linxiraos/* 必须可解析（类 3）
bun scripts/check-zeta-sentinels.ts         # Zeta-only 代码未被合并吞掉（类 4）
bun scripts/check-ci-surface.ts             # CI job / needs / 产物名 / matrix 键（类 7、10、12、14）
bun scripts/check-license-map.ts            # 许可分层
bun scripts/check-release-asset-names.ts    # zeta-cli-* 资产名
bun scripts/brand/brand-check.ts            # 品牌残留
```

`document/` 在 `scripts/brand/brand-rules.ts` 的 `SKIP_PREFIXES` 里：本目录允许
按原样保留上游记号（`.omp`、`my.omp.sh`、`PI_LOGO` 等），不会被品牌扫描判红。
