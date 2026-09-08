# Changelog

## [Unreleased]

### Added

- Muse Code subscription sign-in, credential refresh, inference, and quota reporting in `/usage`, with durable rate-limit backoff so quota refresh recovers instead of repeatedly retrying.

### Fixed

- Reasoning-off requests (e.g. GitHub Copilot `gpt-6-astra`) no longer surface `400 Unsupported value: 'none'`: the reasoning-effort fallback now recognizes `Supported values` phrasing and retries at the lowest allowed effort.
- Cursor GPT off-tier requests no longer send raw `-none` sibling ids (e.g. `gpt-5.6-sol-none-fast`), which the Run endpoint rejects; they normalize to the base model id with no reasoning parameter.
- Fixed Codex compaction timeouts triggering prolonged retries instead of advancing to the next compaction method.

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
## [1.1.10-omp18.1.12] - 2026-09-06

### Added

- Added Muse Code subscription sign-in, credential refresh, inference, and quota reporting in `/usage`, with durable rate-limit backoff so quota refresh recovers instead of repeatedly retrying.

## [1.1.10-omp18.1.11] - 2026-09-05

### Fixed

- Fixed OpenCode Go usage polls (`GET /zen/go/v1/usage`) missing `x-opencode-session` and omp's `User-Agent`: background polls now attribute with the stable install id so the requests OpenCode flags as `Bun fetch` carry the required session header.
- GitHub Copilot sign-in now requests only basic profile access, restoring login for Enterprise organizations that reject repository, gist, and Codespaces permissions ([#10656](https://github.com/can1357/oh-my-pi/issues/10656)).

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
