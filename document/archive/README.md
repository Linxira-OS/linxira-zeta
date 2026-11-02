# document/archive

只读归档。这里的内容**不是当前规范**，只保留历史与决策依据；不要按这里实现。

| 文件 | 归档原因 | 当前正本 |
|---|---|---|
| `squash-sync.md` | 压缩式上游同步已废止（2026-09-17 授权，v18.2.5 起废止） | [`../merge-playbook.md`](../merge-playbook.md) |
| `porting-to-natives.md` | 字段笔记已合并进 crate 文档 | [`../native-crates.md`](../native-crates.md) § Porting field notes |
| `natives-addon-loader-runtime.md` | 加载器细节已合并进 natives 架构 | [`../natives-architecture.md`](../natives-architecture.md) § Loader runtime details |

规则：

- 新归档文件必须在本表登记原因与正本路径。
- 归档内容不参与品牌扫描争议：`document/` 本就在 brand 的 `SKIP_PREFIXES` 中。
- 不要删除归档文件；需要淘汰时先改本表并说明。
