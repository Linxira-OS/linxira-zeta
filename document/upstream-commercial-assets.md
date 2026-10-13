# 上游商业资产 / 共享基础设施处置台账

与代码合并无关，但**每次上游合并都必须对照本表检查**：上游把一批共享/商业
服务硬编码在客户端里，其中有些改了就会坏（端到端加密中继、OIDC 登录、模型
发现源、安装提示），有些是我们要逐步替换掉的外部依赖。机械品牌扫描
（`scripts/brand/brand-check.ts`）**不覆盖**这些域名——它们在品牌注册表里被
显式列为「刻意保留」，所以这份台账必须单独存在，并由
`bun scripts/check-shared-infra.ts` 在 CI 里做机械对账。

## 核实方式

```bash
# 域名全景（排除 CHANGELOG）
git grep -ohE "https?://[a-zA-Z0-9._-]*(omp\.sh|stencil\.so|scl\.so)[a-zA-Z0-9./_-]*" \
  -- packages crates scripts desktop docs .github web-ui \
  | grep -v CHANGELOG | sort | uniq -c | sort -rn

# 单域名落点
git grep -lE "qa\.omp\.sh" -- packages scripts desktop .github

# 台账守卫（必须归零；已进 CI check job）
bun scripts/check-shared-infra.ts

# 品牌守卫（另一条线，也必须归零）
bun scripts/brand/brand-check.ts
```

## 总览

| 处置 | 域名 / 面 | 一句话依据 |
|---|---|---|
| **保留** | `my.omp.sh`（中继/分享）、`https://omp.sh/install`（安装提示）、`catalog.stencil.so`（模型发现数据源） | 共享基础设施：协议两端由上游运营，改 URL 等于切断 `/collab`、`/join <link>`、模型发现或安装路径 |
| **保留代码，凭证自填** | `api.stencil.so` / `auth.stencil.so`（Stencil 账号体系）、`client-id "omp"`、Tern 客户端适配 | 代码留着（将来可能有同类商业产品），凭证改成用户自填 `STENCIL_API_KEY`；OIDC public client id 与 issuer/scope 名是协议契约，**改名即登录失败** |
| **待替代** | `skills.omp.sh`（P2）、`live.omp.sh`（P3）；`qa.omp.sh` 已替换 ✓（见 §3c） | 用户可主动触达的外部依赖，上游关停即失效 |
| **已移除** | `scl.so`（Tern 推广文案链接，2026-10-14 用户裁决）；`qa.omp.sh`、`build.stencil.so` 已替换/退役（见 §3c） | 上游产品推广面；守卫标为 `replaced`，复活即红 |

## 1. 保留：共享基础设施

| 服务 | 非测试落点 | 依据 |
|---|---|---|
| `my.omp.sh` — 中继/分享 URL | `packages/collab-web/{index.html,public/robots.txt,public/sitemap.xml,scripts/local-relay.ts}`、`packages/wire/src/index.ts`（另有测试 12 处） | 端到端加密中继，协议两端由上游运营；注册表「不品牌化」 |
| `https://omp.sh/install` | `packages/coding-agent/src/cli/update-cli.ts` | 注册表「共享基础设施，勿改」 |
| `catalog.stencil.so/models.json.zstd` | `packages/catalog/scripts/generate-models.ts`、`packages/catalog/src/provider-models/openai-compat.ts` | 模型发现数据源；替换需自建模型目录服务，未列入计划。注意 `packages/catalog/src/compat/rules.json` 是生成物 |
| `docs.stencil.so/tern/protocol/` | `packages/tui/src/native/node.ts`、`packages/wire/src/tsp.ts` | 协议文档出处（注释），不是 API 调用 |

> `scl.so/tern` 推广链接**已移除**（2026-10-14 用户裁决）：欢迎页 tips 的
> `[NO-TERN] … [tern](https://scl.so/tern)` 条、`welcome.ts` 的 `[NO-TERN]`
> 可见性标签机制、以及 i18n `tip33` 文案一并删除；`check-shared-infra.ts` 的
> `INVENTORY` 把 `https://scl.so` 标为 `replaced`（`files: []`），
> `scripts/brand/brand-rules.ts` 加 `MUST_NOT_CONTAIN /scl\.so/` 精确规则
> （裸 `stencil.so` 不禁——`catalog.stencil.so` 是模型目录基础设施）。详见 §3c。

## 2. 保留代码，凭证改为用户自填

- **Stencil 账号体系**（`api.stencil.so` / `auth.stencil.so`）：端点保留在
  `packages/catalog/src/compat/rules/auth/stencil.kdl`（+ 生成物
  `compat/rules.json`），凭证由用户提供 `STENCIL_API_KEY`；涉及
  `packages/coding-agent/src/stencil/credential.ts`、`packages/wire/src/stream.ts`。
  提示文案已改写为「Zeta-hosted Stencil services」。
- **`client-id "omp"`**（最容易被误改的一项）：注册在 `auth.stencil.so` 的
  OAuth **public client id**。改成 `zeta` → OIDC 换 token 失败 → 登录直接坏。
  可用环境变量 `STENCIL_CLIENT_ID` 覆盖，将来要换不必改代码。同理
  `stencil.kdl` 里其它 `omp*` 字段名（OIDC issuer 路径、scope 名）是协议契约。
  与「模型 API 认不认 agent」无关：模型侧走 `STENCIL_API_KEY`，两条路。
- **Tern 适配**：保留全部客户端适配文件。上游仓库**没有** Tern 服务端代码，
  只有客户端；「多端同步 + web 页面」是开源的 `collab/`（150 文件）+
  `collab-web/`，我们已经拥有。

## 3. 待替代（按优先级）

1. **`skills.omp.sh`（P2）** — 支持但未改默认源。落点
   `src/skillshare/client.ts`、`src/commands/skill.ts`、
   `src/slash-commands/builtin-skills.ts`、`src/cli/command-help.ts`、
   `packages/wire/src/skillshare.ts`。已有 npm 包
   `@linxiraos/linxira-skills`（v0.1.1，96 技能，npm+git，零服务器依赖）。
2. **`live.omp.sh`（P3）** — 语音服务，与 Stencil 账号同源，依赖服务决策，
   优先级最低。落点 `src/stream/clip-upload.ts`、`src/cli/command-help.ts`、
   `packages/wire/src/stream.ts`、`catalog/.../stencil.kdl` 注释。

> ⚠️ 改 URL 时：`skills.omp.sh` 5 处都在 **CLI 可见文案**里，必须同时改提示
> 文本，否则用户看到「提交反馈到上游」而请求发到我们这边。

### 3b. 品牌指向待替换（`replace-brand`，非功能风险）

守卫（`scripts/check-shared-infra.ts`）首次运行即抓出这批**未登记的落点**——
它们不影响功能，但把我们的产品面指到了上游站点：

| 落点 | 内容 | 处置 |
|---|---|---|
| `packages/browser-relay/extension/manifest.json` + `src/tools/browser/relay/extension-assets/manifest.json.txt` | `homepage_url: "https://omp.sh"` | 待换成 Zeta 自有站点 URL |
| `src/modes/rpc/wire/index.ts` + `rpc-wire.schema.json` | JSON-Schema `$id: "https://omp.sh/schemas/rpc-wire.json"`（上游 `c4d3204151a` 引入，从未扫过） | 待换成 Zeta URL（改 `$id` 需同步再生成 SDK 产物） |
| `packages/collab-web/index.html` | JSON-LD publisher = Stencil Labs, Inc. / `stencil.so`，另引用 `https://omp.sh/` | 待换成我们的组织身份 |

### 3c. 已完成的替代（留档，便于下次核对）

| 项 | 结果 |
|---|---|
| **`qa.omp.sh/v1/grievances` → GitHub Issues（2026-10-11）** | 三处落点（`src/cli/grievances-cli.ts`、`src/tools/report-tool-issue.ts`、`src/tools/settings.ts`）改走新客户端 `packages/coding-agent/src/grievances/client.ts`：目标仓库取 `ZETA_ISSUE_REPO`（默认 `Linxira-OS/linxira-zeta`），令牌链 `GITHUB_TOKEN` → `GH_TOKEN` → `dev.autoqaPush.token` → `gh auth token`；401/403/404/422 有各自可操作提示；**无令牌不发请求**，改为打印成文 issue + 预填 `issues/new` URL；每条 body 明示"将公开发布"。标签：工具缺陷 `bug`、手动反馈 `feedback`。已删除 `dev.autoqaPush.endpoint` 与 `PI_AUTO_QA_PUSH_URL`/`_TOKEN`。守卫把该端点标为 `replaced` 且 `files: []`——任何落点回归即红。 |
| **`build.stencil.so` 发布步骤退役（2026-10-14）** | v1.2.1 发布 run 的 `Publish to build.stencil.so` 步骤 HTTP 403（服务只接受 `can1357`/`stencil-hq` 仓库，本 fork 永久无权限；v1.2.0 同步骤亦红）。删除 `.github/workflows/ci.yml` 该步骤及其 `scripts/ci-build-upload.ts`，连同只为它下载 `zeta-binary-*` 的步骤；`INVENTORY` 把该端点标为 `replaced` 且 `files: []`，`check-ci-surface` 规则禁止 `ci-build-upload`/`build.stencil.so` 出现在 workflow —— 复活即红。二进制只进自己的 GitHub Release（更新器消费 `zeta-cli-*` 资产，见 `document/release.md` 损伤类别 11）。 |
| **`scl.so/tern` 推广提示移除（2026-10-14）** | 欢迎页 tips 末行 `[NO-TERN] Psst, zeta has a natural habitat 🐦 [tern](https://scl.so/tern)`、`welcome.ts` 的 `[NO-TERN]` 可见性标签机制（`NO_TERN_TIP_MARKER` + `TIPS`/`TSP_TIPS` 分池；只有这一条用过，故机制一并移除）、i18n `tip33`（`en.ts`/`zh.ts`/`messages.ts`）全部删除。这是上游产品推广（"来用上游终端 Tern"）+ 上游短链，用户裁决**推翻** `document/upstream-sync.md` 里 v18.8.5 合并时「tern tip kept」的旧决议。守卫：`scripts/brand/brand-rules.ts` 加 `MUST_NOT_CONTAIN /scl\.so/`，`tips.txt` 的 `USER_SURFACE_FILES.forbid` 加 `scl\.so`；`check-shared-infra.ts` 把 `https://scl.so` 标 `replaced`/`files: []`。 |
| 安装站点脚本 | `F:\Linxira-OS\Linxira-OS.github.io`（Astro，推 `master` 自动部署）：安装脚本原本下载 `zeta-windows-x64.exe` / `zeta-linux-x64`，而 CI 实际发布 `zeta-cli-*` —— **两个平台的安装脚本都必然失败**。已改为 `zeta-cli-*` 并安装为 `zetacode`（裸 `zeta` 是工作台 bin，会互相遮蔽）。站点仓库提交 `90d2e14`，已推送。 |
| `.ompcast` → `.zetacast` | 已改完。 |

另有两处**保留**的引用需要知晓：`src/discovery/builtin.ts` 的
`https://omp.sh/docs/context-files` 是溯源注释；`packages/tui/src/native/node.ts`
与 `packages/wire/src/tsp.ts` 引用 `https://docs.stencil.so/tern/protocol/` 作为
协议文档出处（注释）。

## 4. 明确不改（防止下一个人"顺手改掉"）

| 项 | 为什么 |
|---|---|
| `OMP_*` / `PI_*` 环境变量（约 190 个） | 文档化的用户配置项；改名破坏现有配置，且要求生产者/消费者同时改，漏一处即静默失效。正确路径是读旧写新分阶段迁移 |
| Stencil `client-id "omp"` | 改则登录失败（见 §2） |
| `.omp-plugin` / `omp-plugins.lock.json` | OMP/Claude 插件兼容面，刻意保留 |
| `my.omp.sh` / `omp.sh/install` | 共享基础设施（见 §1） |

## 5. 遥测（已硬关闭）

`TELEMETRY_EXPORT_ENABLED = false` 写死在
`packages/coding-agent/src/main.ts`：不是「默认关」，而是**没有开关**——没有
settings key、没有 env var、没有 CLI flag；设 `OTEL_EXPORTER_OTLP*` 端点不会
有任何效果。我们没有遥测服务端，等自建采集端后有意识地加回。守卫在
`scripts/brand/brand-rules.ts`。

## 6. 机械守卫与变更流程

`bun scripts/check-shared-infra.ts`（CI `check` job）扫描
`packages/ scripts/ .github/ desktop/ crates/`：

- **未知域名**（出现未登记的上游端点）→ 失败；
- **已知域名出现在未登记的落点**（非测试文件）→ 失败。

流程：**先改本台账，再改守卫的 `INVENTORY`，最后改代码**。测试文件豁免
（fixture 可以任意引用端点）。替换某项（如 `qa.omp.sh` → GitHub Issues）时，
同一提交里：改代码 + 从 `INVENTORY` 移除该域名（或改状态为 `replaced`）+
更新本台账的处置表。
