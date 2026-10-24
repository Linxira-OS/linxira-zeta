<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。上游同步的逐阶段操作细节。动手前与 document/merge-playbook.md 一起读。 -->

# 上游同步操作细节

> 本文是根 AGENTS.md 的展开版。**权威顺序**：`document/merge-playbook.md`（完整手册）
> > 本文（摘要 + 硬校验）> 根 AGENTS.md（只留硬约束）。

### 六阶段管线（摘要）

完整 tag 合并 → 结构修复（scope/catalog/sentinel/lockfile；gate:
`check-version-consistency` + `check:ts`）→ 品牌 overlay（`bun scripts/brand/
brand-overlay.ts`，脚本已入库）→ 逐 bucket 测试契约 resolve → brand-check 归零
+ 全测试绿 → 归纳回规则表/AGENTS。逐阶段执行细节见 `document/merge-playbook.md`。

**合并审阅规则单页**：`document/merge-review.md` — 合并前 checklist、冲突
决策记录模板、守卫矩阵；Zeta-only 代码哨兵见 `scripts/brand/zeta-sentinels.ts`
（`bun scripts/check-zeta-sentinels.ts`，CI check job 强制，AGENTS.md 必须链接
此文件——该链接本身被检查）。

### 上游增量合并规程（v18.2.5 起，唯一合并方式）

**任何涉及 OMP 上游合并的任务（agent 或人），动手前必须先通读
`document/merge-playbook.md` 的「上游增量合并规程」章节并按其执行**；
本节只立原则，操作细节以 playbook 为准。

- **只比对上游原生 tag 间差异**（`v18.2.5 → v18.2.6`），永不把"上游分叉后
  我们的差异"卷进合并计算。这一语义由 git 三方合并自动保证——**前提是
  merge-base 恰为上一个已集成的上游 tag**。
- **真 merge commit，禁止 squash**：上游合并一律 `git merge v18.2.x` 双亲
  提交，保持与上游 commit 谱系永续连接。谱系一断（如 squash 重写），
  merge-base 退化为远古祖先，theirs 侧退化为全量追赶窗口 diff——v18.2.1
  →v18.2.4 的 1300+ 冲突与多轮 CI 损伤即此根源。
- **合并前强制验证**：`git merge-base HEAD v18.2.6` 必须等于上一个已集成
  tag 的 peeled SHA（v18.2.5 = `3727311702`）；不等即谱系受损，停止合并
  并排查，禁止带病合并。
- fetch 用 `git fetch omp-upstream --no-filter tag <tag>` 回填对象
  （partial clone 老规矩）。
- 冲突 resolve 按 `document/merge-playbook.md` 契约（upstream-wins + Zeta
  surface 重应用 + 无白名单全树扫描）。

