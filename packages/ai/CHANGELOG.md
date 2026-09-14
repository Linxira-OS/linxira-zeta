# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12
## [18.1.20] - 2026-09-13

### Fixed

- Fixed Windows OAuth sign-in failing on every attempt after an upgrade when a previous run left a stale native callback registration behind; handlers registered by older binaries are now recognized as owned and rolled back instead of blocking recovery ([#11967](https://github.com/can1357/oh-my-pi/pull/11967) by [@H4vC](https://github.com/H4vC)).

## [18.1.19] - 2026-09-12

### Added

- Charm Hyper accounts now report their remaining prepaid credit balance in `/usage` ([#11656](https://github.com/can1357/oh-my-pi/pull/11656) by [@oldschoola](https://github.com/oldschoola)).

### Fixed

- Fixed Kimi Code's 7-day rate-limiting window being mislabeled as "Total quota" in `omp usage`, causing accounts whose monthly subscription pool is exhausted to appear 100% free while chat completions fail; parsed `totalQuota` add-on packs into the true "Total quota" row when present, and recognized Kimi's HTTP 403 `access_terminated_error` as a credential-rotatable usage limit. ([#11827](https://github.com/can1357/oh-my-pi/pull/11827) by [@revofusion](https://github.com/revofusion))
- Fixed provider streams that die after emitting `toolcall_start` but before any argument content failing validation with empty `{}` arguments; the uncommitted attempt is now discarded and retried ([#11823](https://github.com/can1357/oh-my-pi/pull/11823) by [@justdoGIT](https://github.com/justdoGIT)).
- Fixed Windows `zcode://` (Z.AI coding-plan) OAuth sign-in never completing after a successful browser authorization: the native callback handler is now registered with a path the Windows shell can launch, so the `zcode://zai-auth/callback` redirect reaches omp instead of being silently dropped by the browser ([#11907](https://github.com/can1357/oh-my-pi/pull/11907) by [@oldschoola](https://github.com/oldschoola)).
- Codex OAuth login now accepts valid account tokens that expose an email but omit `chatgpt_account_id`, without fabricating a workspace header ([#11847](https://github.com/can1357/oh-my-pi/pull/11847) by [@nguyennguyenit](https://github.com/nguyennguyenit)).
- Fixed Muse Code login failing when Meta returns no assigned subscription tier (`subs_tier_id`/`subs_tier_name` as null); sign-in now succeeds and usage is reported without a tier ([#11843](https://github.com/can1357/oh-my-pi/pull/11843) by [@John-Cusack](https://github.com/John-Cusack)).

## [18.1.18] - 2026-09-11

### Added

- Anthropic server-side compaction (`compact-2026-01-12` beta): `anthropicCompaction` on `StreamOptions` sends the `compact_20260112` context-management edit, the streamed `compaction` block is surfaced as an `anthropicCompaction` provider payload, the `compaction` stop reason is a normal stop tagged in `stopDetails` (exempt from the empty-completion retry), and usage sums `usage.iterations` whenever a compaction iteration ran. A user-role compaction summary carrying that payload replays as a leading assistant `compaction` block — folded into the retained assistant turn when one follows — with the beta and a never-firing strategy attached automatically; other providers keep reading the summary text. Everything compaction-related is gated on the model line (`compat.supportsServerCompaction`, rule-owned in the catalog) and on the endpoint the request actually reaches (`supportsAnthropicCompaction`: the official API for the first-party provider, resolved through Foundry / `ANTHROPIC_BASE_URL` reroutes, or an explicit `remoteCompaction.enabled` opt-in), so a rerouted session or an older model line falls back to the text summary instead of sending a block the API rejects. Caller-owned clients are gated on their own endpoint (the client's `baseURL`, or an explicit `remoteCompaction.enabled` opt-in when it exposes none) and receive the compaction beta per request, like the effort and control betas. A block held by its originating assistant message — a caller that appends the compacting response itself — replays at the head of that turn. The block's opaque `encrypted_content` is captured from the stream, kept on the payload as `encryptedContent`, and replayed verbatim. A compacting turn is priced per sampling iteration (like a server-side fallback turn), so a long-context tier applies only to an iteration whose own prompt crosses the threshold, never to the summed totals.
- Added historical decimation prompt-cache breakpoints every 15 user turns on Anthropic requests, so long conversations retain stable cached prefixes during branching, rewinds, and session resume ([#11665](https://github.com/can1357/oh-my-pi/pull/11665) by [@camjac251](https://github.com/camjac251)).

### Changed

- Defaulted Anthropic OAuth requests to 1h prompt-cache retention where supported, matching Claude Code subscriber behavior and preventing cache expiry during idle intervals ([#11667](https://github.com/can1357/oh-my-pi/pull/11667) by [@camjac251](https://github.com/camjac251)).

### Fixed

- Fixed Codex HTTP response-body transport failures forwarded through Anthropic-compatible proxies being treated as terminal errors; replay-safe turns now use the existing transient recovery without re-executing completed tools.
- GitHub Copilot Enterprise requests keep the Copilot CLI identity accepted by private Enterprise endpoints, and Business requests denied with HTTP 400 `model_not_supported` now retry once as the Copilot CLI (matching the existing 403 fallback), restoring models that 18.1.17 rejected as unsupported ([#11669](https://github.com/can1357/oh-my-pi/issues/11669)).
- Fixed provider stream truncations reported as a bare `unexpected EOF` (and other stream-parse diagnostics) classifying as terminal errors, so they now retry like every other transient transport failure ([#11745](https://github.com/can1357/oh-my-pi/issues/11745)).
- GitHub Copilot streams remember the working `Copilot-Integration-Id` per credential after a denied chat identity retries as the Copilot CLI, so later streams start at the working shape instead of replaying the denial ([#11669](https://github.com/can1357/oh-my-pi/issues/11669)).
- Fixed Anthropic OAuth requests omitting the tool-array cache breakpoint, so tool definitions are now cached across session rewrites and sibling subagents ([#11660](https://github.com/can1357/oh-my-pi/pull/11660) by [@camjac251](https://github.com/camjac251)).
- Fixed Amazon Bedrock OpenAI models rejecting image-bearing tool results by sending each image as a sibling user content block ([#11681](https://github.com/can1357/oh-my-pi/issues/11681)).

## [18.1.17] - 2026-09-10

### Fixed

- Fixed transient Python HTTP/2 stream resets and HTTP/1.1 chunked response interruptions being treated as terminal errors when forwarded by a proxy ([#11160](https://github.com/can1357/oh-my-pi/pull/11160) by [@cyriusweng](https://github.com/cyriusweng)).
- Ollama cache hits now populate cached-token usage: `prompt_eval_cached_count` from the `/api/chat` done chunk maps to `cacheRead`, with `input` reduced to the uncached portion, so status-line `cache_turn`/`cache_hit` segments and cache-prefix audits report real hit rates instead of false misses.
- Fixed requests that run across a price change being costed at the newer rate; peak/off-peak estimates now use the rate in effect when the request started.
- Fixed GitHub Copilot Business seats getting HTTP 403 on every model while the same token succeeds with a Chat client identity: chat and model-policy requests now identify as `copilot-chat`, denied requests retry once as the Copilot CLI (`copilot-developer-cli`), and `COPILOT_INTEGRATION_ID` pins the `Copilot-Integration-Id` header up front; model discovery keeps the CLI identity and the 403 message names the identity and the remedies ([#11372](https://github.com/can1357/oh-my-pi/issues/11372)).

## [18.1.16] - 2026-09-09

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10
- Anthropic `credits_required` responses now rotate to another account instead of retrying the same one: the entitlement wall is a quota outcome, so a session no longer repeats the request against an account that cannot serve the model ([#11333](https://github.com/can1357/oh-my-pi/pull/11333) by [@AshishKumar4](https://github.com/AshishKumar4)).
- Codex SSE streams that end without a terminal completion event now retry when replay-safe and remain transient errors when partial output prevents replay ([#11349](https://github.com/can1357/oh-my-pi/issues/11349)).
- Anthropic subscription usage now falls back to the canonical `api.anthropic.com` OAuth usage endpoint when a custom provider `baseUrl` does not serve it, instead of leaving the report to rate-limit headers — those carry the model-scoped weekly window only on responses for that model family, so `/usage` could report a scoped window far below its real utilization.

- 上游 v18.1.16 同步:AuthStorage 合并封锁契约——凭据级 `blockedUntilMs` 与 `providerTimed` 时间线合并,先到的更长封锁在短提示到来时保持有效;GitHub Copilot OAuth 拆分公共 GitHub / GHE 双 client-id;Codex WebSocket 传输 abort 携带 cause 链。

## [1.1.12] - 2026-09-10

- 品牌与合并工具链维护版本;无本包用户可见变更。

## [1.1.11] - 2026-09-08

### Added

- Muse Code subscription sign-in, credential refresh, inference, and quota reporting in `/usage`, with durable rate-limit backoff so quota refresh recovers instead of repeatedly retrying.

## [1.1.10-omp18.1.12] - 2026-09-06

### Added

- Added Muse Code subscription sign-in, credential refresh, inference, and quota reporting in `/usage`, with durable rate-limit backoff so quota refresh recovers instead of repeatedly retrying.

## [1.1.10-omp18.1.11] - 2026-09-05

### Fixed

- Fixed OpenCode Go usage polls (`GET /zen/go/v1/usage`) missing `x-opencode-session` and omp's `User-Agent`: background polls now attribute with the stable install id so the requests OpenCode flags as `Bun fetch` carry the required session header.
- GitHub Copilot sign-in now requests only basic profile access, restoring login for Enterprise organizations that reject repository, gist, and Codespaces permissions ([#10656](https://github.com/can1357/oh-my-pi/issues/10656)).

## [1.1.10] - 2026-09-07

- GitHub Copilot sign-in now requests only basic profile access, restoring login for Enterprise organizations that reject repository, gist, and Codespaces permissions.
- Transient gateway stream failures are now retried instead of surfacing as session errors.

## [1.1.9] - 2026-09-05

- Z.ai OAuth key name sends zeta (merge restored the upstream oh-my-pi literal in tests); xAI/OpenAI-compatible requests send the zeta User-Agent again.

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra 支持，空补全重试重构（withReplaySafeStreamRetry）。

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.1] - 2026-08-14

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
- Fixed Gemini thought summaries occasionally leaking a raw `` ```thinking `` / `` ``````thinking `` fence delimiter into the reasoning block, so it no longer shows up as fence spam in the thinking display or persisted transcripts ([#8719](https://github.com/can1357/oh-my-pi/issues/8719)).
