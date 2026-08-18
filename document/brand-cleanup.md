# Zeta 品牌清理记录（Brand Cleanup）

> 记录 v1.0.2 发布后的一次 OMP 商标/标识清理（2026-08-16）。
> 目标：确保面向用户/agent 的文档与提示词准确自称 Zeta，不残留 OMP 产品面。

## 已清理（产品面 → Zeta）

### 提示词（packages/coding-agent/src/prompts/）
- `system/system-prompt.md`：Role 行 "Oh My Pi coding harness" → "Zeta coding harness"；`security://` 描述 "OMP scans" → "Zeta scans"；`omp://` 措辞注明 scheme 为协议兼容保留。
- `security/scan-coordinator.md`、`validate-request.md`：OMP-native → Zeta-native。
- `tools/browser.md`、`tools/hub.md`：omp/OMP → zeta/Zeta（描述性）。
- `tools/security-publish.md`、`tools/security-scan.md`：OMP-native/OMP-owned → Zeta。

### CLI/UI 用户可见文案（packages/coding-agent/src/）
- `cli/command-help.ts`、`modes/acp/acp-agent.ts`、`modes/controllers/event-controller.ts`（通知标题兜底）、`commands/launch-help.ts`、`cli/help-extra.ts`、`cli-commands.ts`（~10 条 `omp ...` 提示）、`cli/browser-relay-cli.ts`、`commands/browser-relay.ts`、`commands/ttsr.ts`（examples）、`cli/agents-cli.ts`、`commands/agents.ts`、`cli/ttsr-cli.ts`、`cli/profile-alias.ts`（--wraps zeta）、`config/settings-schema.ts`（2 处设置描述）、`config/mcp-schema.json`（4 处 schema 提示）、`session/agent-session.ts`（power assertion reason）、`modes/utils/ui-helpers.ts`（"Run: zeta update"）、`commands/update.ts`（examples）。
- `web-ui/components/AppShell.tsx`：OMP-WEB-INTERFACE → ZETA-WEB-INTERFACE。

### 更新源（发布正确性）
- `cli/update-cli.ts`：`REPO` → `Linxira-OS/linxira-zeta`；`HOMEBREW_FORMULA` 置空、`MISE_TOOL` → `zeta`（Zeta 无 tap/mise 分发，防止 `zeta update` 误装 OMP 二进制）。

### 运行时文档（docs/，随 npm 打包给 agent）
- 57 个文件：命令名 `omp` → `zeta`（含 `omp --`、反引号命令）；`oh-my-pi` → `linxira-zeta`；保留功能标识（`omp-upstream`、`omp://` scheme、`OMP_CODING_AGENT_DIR` env、`omp_rpc`、`omp_worker`）。

### 内部文档（document/）
- `macos-signing-notarization.md`：`omp` 二进制 → `zeta`、`omp.sh` → `linxira-os.github.io`。
- `roadmap.md`：`omp stats` → `zeta stats`；tracking 归属 `autolearn/controller.ts` → `src/tools/tracking.ts`（规划与代码脱节修正，同时修正 document/roadmap.md）。

## 保留（合理引用，不清除）

- `document/upstream-sync.md`：OMP 是上游事实，台账记录。
- `document/porting-from-pi-mono.md`、`porting-to-natives.md`、`natives-*.md`、`plugin-manager-installer-plumbing.md`、`rulebook-matching-pipeline.md`：技术/流程文档中的 omp 指上游/内部技术名。
- `OMP_PROFILE`/`OMP_AUTH_BROKER_URL` env 名、`__omp_worker_*` worker selector、`MANAGED_SKILLS_PROVIDER_ID="omp-managed"`（持久化 id，改名失配）。
- `omp://` URL scheme（功能性内部协议，改 scheme 属协议级改动）。
- `Dockerfile.robomp` + `python/robomp`：**活跃基础设施**（GitHub triage bot，scripts/ci-test-ts.ts 引用），非残留。
- `.bazel*`/`BUILD.bazel`/`MODULE.bazel`：bazel 构建（CI bazel job 使用），非商标。
- 包名 `@linxiraos/*`、`pi-*`：技术命名。
- CHANGELOG 上游归属条目、`docs/memory.md` 上游致谢。

## 验证

- `grep -rnE "\bOMP\b|\bomp\b" packages/coding-agent/src/prompts/` 仅剩 `omp://` scheme 行。
- `grep -rnE "Oh My Pi|omp ttsr|omp --profile|omp agents|--wraps omp" packages/coding-agent/src web-ui/components` 零命中。
- `bun run check:ts` 全绿（改动后）。
