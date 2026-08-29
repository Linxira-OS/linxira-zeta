# Changelog

## [Unreleased]

## [1.1.5] - 2026-08-26
## [18.0.9] - 2026-08-28

### Fixed

- Improved OAuth sign-in flows, including a fallback message when the browser cannot automatically close the OAuth success tab.
- Fixed Cloudflare AI Gateway onboarding and routing so gateway account and endpoint configuration is preserved correctly while gateway credentials are not sent as upstream OpenAI authorization headers.
- Fixed Codex OAuth quota handling so chat and Spark usage remain independent, legacy shared quota limits continue to work, and incomplete usage reports are not incorrectly treated as unlimited.

## [18.0.8] - 2026-08-27

### Added

- Added Z.AI GLM Coding Plan usage tracking: credit-based `CREDIT_LIMIT` windows (5h + weekly) now surface in `omp usage` and the status line with the plan tier (`plan: lite/pro/max`).

### Fixed

- Fixed Amazon Bedrock requests to OpenAI-schema models (the `gpt-5.x` SKUs) failing with HTTP 400 `unknown_parameter: 'thinking'` when reasoning was enabled, by sending `reasoning.effort` instead of Anthropic's `thinking` budget block for models the catalog marks as effort-controlled.
- Fixed Cursor replay rejecting sessions with orphaned tool results while preserving their output as assistant context.

## [18.0.7] - 2026-08-26

### Added

- Added application-level usage attribution for billing and usage reporting, with per-application aggregation and automatic client identification. Applications can set their label with `OMP_APP_NAME` (default: `omp`); update the broker before clients to support the new usage reports.

### Fixed

- Fixed Anthropic Claude subscription OAuth requests being rejected by the upstream service ([#9801](https://github.com/can1357/oh-my-pi/pull/9801)).
- Fixed OpenAI-compatible streaming errors being reported as empty successful completions, enabling retries and model fallback when queue admission fails.
- Fixed multimodal tool results in OpenAI Responses requests so inline, remote, and OpenAI file-backed images are preserved correctly.
- Fixed resumed and forked Cursor sessions failing when their history came from a Responses-based provider such as Codex ([#9754](https://github.com/can1357/oh-my-pi/issues/9754)).
- Fixed Cursor `composer-2.5` selections using the Fast variant instead of the Standard tier ([#9012](https://github.com/can1357/oh-my-pi/issues/9012)).

## [18.0.6] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra 支持，空补全重试重构（withReplaySafeStreamRetry）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

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
