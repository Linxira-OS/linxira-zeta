# Changelog

## [Unreleased]

## [1.1.5] - 2026-08-26
## [18.0.9] - 2026-08-28

### Added

- Added Z.AI GLM-5.3-Flash to the bundled GLM Coding Plan catalog, with a 1M-token context window, 131,072-token output limit, native image input, and low/high/max thinking levels. It is now available through model discovery and the model picker.

### Fixed

- Fixed Google Antigravity Gemini 3.7 Flash tiered models failing with HTTP 400 errors at minimal or disabled thinking levels; those tiers now use the compatible Gemini 3.7 Flash model routing.
- Fixed OpenCode Go and Zen GLM-5.3 Flash models exposing an unsupported extra-high reasoning level; they now use the supported low/high/max reasoning levels.
- Fixed Cloudflare AI Gateway credential handling so stored credentials and routing metadata are parsed and used correctly.

## [18.0.8] - 2026-08-27

### Fixed

- Fixed the thinking control mode for OpenAI models served over Bedrock Converse (`global.openai.gpt-5.6-luna`, `-sol`, `-terra`), which are now classified as `effort` rather than `budget` so requests use OpenAI's reasoning schema.
- Fixed LiteLLM discovery leaking a colliding bundled model's provider-specific transport onto custom endpoints: a discovered alias (e.g. `kimi-k3`) matching a bundled Fireworks model no longer inherits that model's wire-id transform, which had caused requests to POST a model id the endpoint never advertised and return HTTP 400 ([#9938](https://github.com/can1357/oh-my-pi/issues/9938)).

## [18.0.7] - 2026-08-26

### Added

- Added cached background refresh from the shared models.dev catalog so newly published models for known providers can appear without a new OMP release, while bundled models remain the offline fallback.

### Fixed

- Fixed LiteLLM model discovery so model pricing is correctly populated when pricing information is provided by a later metadata endpoint.

## [18.0.5] - 2026-08-25

- 同步上游 OMP v18.0.5 / v18.0.6：新增 DeepInfra / Yolo-Auto 提供商标识。

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
