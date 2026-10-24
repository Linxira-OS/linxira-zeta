<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。已废止方案，仅作历史档案：不要在实施中参考它。 -->

# 【历史档案】压缩式 squash sync（已废止）

> **已废弃，勿再用。** 本文件只是为了让"为什么禁止 squash"有据可查，不是可选方案。
> 当前唯一合法的同步方式是 `document/agents/merge/sync-procedure.md` 里的非 squash 双亲合并。

### 超大量上游同步：压缩式 squash sync【已废弃，勿再用】（2026-09-17 授权，v18.2.5 起废止）

当上游追赶窗口超过 **300 提交**或推送 pack 预计 **>50MB** 时，常规
"non-squash 双父合并 + 祖先检查"流程在传输层不可行（单包数百 MB 会被
网络/代理掐断）。此时改用压缩式流程，此条为上方 non-squash 规则的**授权
例外**，逐次由维护者批准：

1. **基座**：`backup/omp/main`（云端与本地各一份）为上游对象沉淀锚点，
   每次同步完成后快进到最新 OMP tag，供下次快速同步复用。
2. **内容合并照常在本地完整执行**（冲突 resolve、六阶段管线、全部门禁），
   压缩只发生在"写历史"这一步：合并后的最终 tree 以 1~2 个 squash 提交
   落在 `backup/omp/main` 之上。
3. **旧 main 保档**：改写前先把原 main 推为 `main-old-<YYYYMMDD>`，
   旧历史永久保留在远端。
4. **新 main 上位**：force 推送 squash 提交序列；首个提交 message 带
   `[skip ci]`，末个提交触发 CI。
5. **作者信息**：上游提交折叠为统一记录，逐 commit 明细一律回上游仓库
   （github.com/can1357/oh-my-pi）查阅——本项目是 fork，历史可溯性由上游
   承载，符合开源协议（保留 LICENSE/NOTICE 即可）。
6. 首个 squash 提交 message 必须注明基座 SHA 与覆盖的 tag 区间；账本
   （`document/upstream-sync.md`）照常记录决策与门禁结果。

