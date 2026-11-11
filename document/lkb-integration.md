# LKB 客户端边界（Zeta 侧）

> 状态：边界设计，尚未实现 Zeta 客户端代码。  
> 交互对象：Linxira Knowledge Base（`Linxira-OS/linxira-knowledge-base`，CLI/二进制 `lkb`）。  
> LKB 是独立组织仓库，由 LKB 维护者运营。本文只定义 Zeta 作为客户端如何接入，
> 不复制 LKB 的 schema、存储、检索或服务端实现。

## 1. 所有权与不变量

| 面 | 所有者 | Zeta 的边界 |
| --- | --- | --- |
| schema、迁移、存储、索引 | LKB | 不建表、不写库、不读库文件、不假设表结构 |
| 检索管线、`Answer` 契约、降级语义 | LKB | 只消费 `answer` / `citations[]` / `degraded[]` 等公开字段 |
| tenant / space / group 角色、ACL | LKB | 不维护平行 ACL；不缓存越权结果 |
| 审计记录、break-glass | LKB | 只提供归因字段；不伪造 actor，不声称 break-glass |
| 客户端配置、凭据生命周期、工具暴露、审批、会话映射 | Zeta | 本文定义的部分 |

硬约束：

- **Zeta 不实现第二套 LKB 服务端**：不 fork `lkb`，不内嵌其 Rust 内核，不代理其
  数据库。接入只走进程外 HTTP/OpenAPI 或 MCP，保持许可证边界（LKB 核心为
  AGPL-3.0-only，Zeta 不 vendoring 其代码）。
- **LKB 契约由 LKB 拥有**：Zeta 不定义 LKB 的 schema、迁移、检索打分或权限模型；
  契约变化按 LKB 的发布流程处理。
- **没有隐式写入**：默认只有读；所有写操作都必须有用户可见的意图和审批。

## 2. 契约面

LKB 的公开契约（以其仓库文档为准）：

- **REST**：`/api/v1/*`，JSON；页面更新要求 `If-Match`（`revision_conflict`
  返回 409）。写请求的幂等语义以 LKB 当前实现和 OpenAPI 为准；没有明文契约时，
  Zeta 不假设重放安全。
- **OpenAPI 3.1**：`GET /openapi.json`；只描述已实装路由，Zeta 可以据此做能力探测。
- **MCP**：`lkb mcp serve`，stdio JSON-RPC 2.0，与 REST 共用同一内核与 token
  scope。当前工具：
  `kb_search`、`kb_answer`、`kb_get_page`、`kb_get_page_summary`、
  `kb_get_page_history`、`kb_list_spaces`、`kb_write_page`。
- **Answer 契约**：CLI、REST、MCP 共享 `answer`、`citations[]`、`confidence`、
  `conflicts[]`、`degraded[]`、`knowledge_as_of`、`mode`。

本仓库只记录 Zeta 的消费面；字段与路由的权威定义在 LKB 仓库，Zeta 文档不得
反向定义 LKB schema。

## 3. 委派身份（delegated auth）

- **按用户委派**：Zeta 用户以自己的 LKB principal 访问，不共享管理员凭据，也不把
  服务账号当作所有用户的身份。
- **凭据形态**：LKB 支持 Bearer token（`lkb_` 前缀，服务端只存 SHA-256）、本地
  session cookie 和可信反代 Header SSO。Zeta 客户端使用 **Bearer token**；
  浏览器场景可复用 LKB 自己的 session，不由 Zeta 代发 cookie。
- **token 类型与 scope**：LKB 的 token kind 为 `user` / `agent` / `service`，
  scope 为 `read` < `write` < `admin`。Zeta 默认申请 `read`；只有用户明确执行
  写操作时才使用带 `write` 的个人 token；`admin` token 不与 agent 的默认工具集
  绑定。
- **组织成员关系**：tenant / group / space 的角色和成员关系由 LKB 判定。Zeta 的
  组织身份不能替代 LKB 身份；团队/企业部署下的 SSO 只走 LKB 已支持的可信反代
  Header 路径（LKB 当前未实现 OIDC/SAML/SCIM），且只有受信代理可以注入身份头。
- **凭据存放**：token 放 Zeta 的凭据存储或环境变量，不进仓库、不进会话转录、
  不进日志；错误信息与工具输出不得回显完整 token。
- **401 / 403 / 409 不是降级**：认证失败、ACL 拒绝、修订冲突都要停止当前操作并
  如实报告；不得用更宽 scope 的 token 重试，也不得回退到无认证模式。

## 4. 上下文检索

- **按需检索**：只有用户问题或 agent 明确需要外部知识时才调用
  `kb_search` / `kb_answer`；不做后台全量同步，不把 LKB 当本地索引。
- **引用与降级**：回答必须携带 `citations[]`；`degraded[]` 非空时向用户说明
  缺失通道；`confidence` 与 `knowledge_as_of` 按 LKB 返回展示。不得把无引用
  内容包装成已核实事实。
- **会话映射**：`external_session_id` 使用稳定的 Zeta 会话标识，便于 LKB 关联
  用户可见消息；Zeta 只发送用户可见消息，**不发送 chain-of-thought、系统提示或
  完整工具轨迹**。
- **默认只读**：检索路径不写回 LKB；不修改页面、不同步本地记忆、不把 Zeta 的
  项目 tracking 写入 LKB。
- **缓存**：如果 Zeta 侧做短期缓存，只缓存当前 principal 可见的结果，键包含
  principal / space / query；不得跨用户复用 ACL 过滤后的内容。

## 5. 个人与管理员维护作用域

- **个人笔记**：LKB 为每个登录用户提供私有 `notes_<principal>` 空间，正常页面 API
  下仅本人可见，管理员也不可读。Zeta 不得另建第二份笔记存储，也不得通过管理接口
  读取他人笔记。
- **空间/组织维护**：页面、修订、成员、空间设置通过 LKB 自己的 UI 或 REST 维护；
  这些操作使用 LKB 的管理权限模型。
- **管理员操作**：MCP 默认不暴露 admin 工具。Zeta 如提供管理入口，必须使用单独的
  admin token、明确标注影响范围，并在每次调用前取得用户确认；不得把 admin 能力
  放进 agent 的默认工具集。
- **break-glass**：LKB 的租户管理员越权读取/写入会写入审计记录。Zeta 不得模拟或
  隐藏该路径；需要时由用户在 LKB 侧显式执行。

## 6. 审计归因

- **actor**：LKB 记录真实 principal。Zeta 不伪造身份头，不用共享服务身份替代用户
  操作；受信反代 SSO 只由部署方配置的代理注入。
- **请求关联**：读请求带 `X-Request-Id`；会话关联使用 `external_session_id`。
  Zeta 日志记录 request id、LKB 状态码、scope 与目标 space/page，不记录 token。
- **重试**：只在 LKB 提供幂等保证的写路径上重试；429 遵守 `Retry-After`；不得因
  超时盲目重复破坏性写。
- **可解释性**：向用户展示 LKB 返回的引用与 `degraded[]`，不把 LKB 的审计责任
  转移给 Zeta 的本地日志。

## 7. 破坏性写审批

- Zeta 的 MCP 工具统一按 `write` 档处理，而默认 `yolo` 模式会自动批准 `write`。
  因此 LKB 的 MCP 配置必须显式设置审批策略，例如
  `tools.approval.<注册后的最终工具名>: prompt`；不能依赖默认模式。
- **删除**：LKB 的页面删除是 REST `DELETE /api/v1/pages/{space}/{slug}`（软删除），
  当前不在 MCP 工具集中。Zeta 若未来封装删除，必须每次弹出确认，且不提供
  “本会话始终允许”。
- **管理员写**：成员、角色、空间、配额、模型配置等管理写操作不属于 agent 的
  常规工具；需要用户在 LKB 管理面或显式 admin 会话中执行。
- **审批粒度**：审批必须显示目标 space/page 与动作；不允许一次批准覆盖整个组织
  或批量删除。无交互 UI（print / headless / 子代理）时按 fail-closed 拒绝。
- **默认拒绝**：没有审批策略、没有用户确认、或工具声明不明确时，破坏性写一律
  不执行。

## 8. 失败与降级

- **网络/5xx/超时**：向用户报告 LKB 不可用，必要时有限重试；不得编造引用，也不得
  静默改用其他知识库或本地索引。
- **认证/ACL**：401 / 403 / 409 直接停止并报告；不降级为匿名或更宽权限。
- **限流**：429 按 `Retry-After` 退避；不并发轰炸 LKB。
- **部分结果**：保留 `degraded[]` 并说明缺失通道；用户可见的答案必须能追溯到
  LKB 返回的 citation。

## 9. 版本与兼容

- LKB 当前发布线为 `0.2.z`；`/api/v1` 只增不改，破坏性变更由 LKB 走自己的
  ADR/迁移流程。Zeta 不假设未公开的路由或字段。
- Zeta 客户端应通过 `GET /openapi.json` 或 MCP `tools/list` 做能力探测；缺少
  所需工具时禁用对应功能并说明，而不是报一个笼统错误。
- 新增字段按可选处理；未知字段忽略；不因 LKB 内部 schema 变化修改 Zeta 存储。
- Zeta 侧行为变化（例如启用新的写工具）必须在同一 PR 更新本文与相关运行时文档；
  LKB 的契约变化由 LKB 维护者发布。

## 10. 未实现 / 开放项

- Zeta 当前没有 LKB 客户端代码、内置 MCP server 条目或管理 UI；本文是接入边界，
  不是已交付功能。
- LKB 当前没有 OIDC/SAML/SCIM；团队/企业身份依赖可信反代 Header SSO。
- 个人笔记、空间维护、审计导出都在 LKB 侧实现，Zeta 不复制这些能力。
- 需要 LKB 维护者确认的接口细节（token 生命周期、OpenAPI 版本策略、审计字段
  名称）以其仓库文档与 issue 为准。

## 关联文档

- LKB：[README](https://github.com/Linxira-OS/linxira-knowledge-base/blob/main/README.md)、
  [认证与安全](https://github.com/Linxira-OS/linxira-knowledge-base/blob/main/docs/en/06-auth-security.md)、
  [概念（会话与 `external_session_id`）](https://github.com/Linxira-OS/linxira-knowledge-base/blob/main/docs/en/02-concepts.md)、
  [实现状态](https://github.com/Linxira-OS/linxira-knowledge-base/blob/main/document/implementation-status.md)。
- Zeta：[MCP 配置](../docs/mcp-config.md)、[工具审批](../docs/approval-mode.md)。
- 仓库导航：[README](../README.md)。
