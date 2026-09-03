# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
## [18.1.4] - 2026-09-02

### Changed

- Enabled Cursor tool schema projection for supported models

### Fixed

- Antigravity and Gemini CLI now collapse every Gemini Flash generation from 3.6 on (`gemini-3.8-flash-low/-medium/-high` and the `-tiered` alias, and future revisions) into one routed `gemini-<rev>-flash` entry via a revision-templated `variant-family`, instead of surfacing raw per-level ids until a per-revision rule lands.

## [18.1.3] - 2026-09-02

### Added

- Added support for Claude Fable 5.1

### Changed

- Updated pricing and context limits for various Claude models

### Fixed

- Claude Sonnet 5 no longer advertises unsupported mid-conversation system messages.
- Custom GLM 5.2 models on `alibaba-coding-plan` (and other blanket-GLM hosts) no longer crash startup with `AmbiguousOverlapError` ([#10553](https://github.com/can1357/oh-my-pi/issues/10553)).
- Gemini 3.7 Flash no longer offers the `minimal` thinking effort on direct google-level hosts (`google`, `google-vertex`, `opencode-zen`), which reject `thinkingLevel: MINIMAL` with a 400; budget and reasoning-effort resellers keep the tier ([#10543](https://github.com/can1357/oh-my-pi/issues/10543)).
- Fixed Alibaba Token Plan discovery for `qwen3.8-flash` to include its context limits, reasoning support, and image input.
- Z.AI GLM-5.3-Flash now uses the native API instead of failing through the unsupported Anthropic-compatible route ([#10539](https://github.com/can1357/oh-my-pi/issues/10539)).

## [18.1.2] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 DeepInfra / Yolo-Auto 提供商标识。

## [1.1.3] - 2026-08-25
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
- Bundled model metadata is prebuilt during generation, reducing catalog startup work.

### Fixed

- Fixed tool-call turn failures for `opencode-go/muse-spark-1.2` and related variants by ensuring API transport pins apply to live discovery and automatically inferring response routes for gateway-first OpenCode models ([#8957](https://github.com/can1357/oh-my-pi/issues/8957)).

