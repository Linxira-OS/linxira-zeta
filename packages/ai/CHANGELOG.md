# Changelog

## [Unreleased]

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra 支持，空补全重试重构（withReplaySafeStreamRetry）。

## [1.1.3] - 2026-08-25
## [18.0.11] - 2026-08-29

### Fixed

- Fixed automatic session retries for Anthropic-compatible streams that end prematurely without a completion signal.
- Fixed Gemini 3.x tool-call continuations through OpenAI-compatible endpoints.
- Fixed credential fallback for HTTP 402 payment-required and deactivated-workspace responses, preventing them from being misclassified as quota exhaustion.
- Fixed Perplexity email sign-in for accounts protected by authenticator-based two-factor authentication.
- Fixed Qianfan API-key login validation for keys that cannot access the validation model.
- Fixed Z.AI browser sign-in to report an occupied callback port before opening the browser.

## [18.0.9] - 2026-08-28

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
