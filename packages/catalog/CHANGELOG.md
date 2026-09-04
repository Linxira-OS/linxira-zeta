# Changelog

## [Unreleased]

## [1.1.8] - 2026-09-04
## [18.1.9] - 2026-09-04

### Added

- Added the `delegation-bias` capability for tuning how agents delegate work to subagents.

### Changed

- Adjusted subagent delegation for GPT-6 and newer OpenAI models to reduce unnecessary delegation.

### Fixed

- Fixed `/login zai` for Z.AI GLM Coding Plan by supporting the provider’s updated authentication flow, including local desktop sign-in, remote paste-code completion, and the configurable `ZAI_OAUTH_REDIRECT_URI`.

## [18.1.8] - 2026-09-03

### Added

- Added GPT-6 Astra to the OpenAI Codex model catalog, including support for configuration updates and requests using the freeform `apply_patch` tool.

### Fixed

- Fixed `omp models refresh` so revoked ChatGPT account tokens no longer prevent the remaining OpenAI Codex models from being discovered.

## [18.1.6] - 2026-09-03

### Added

- Added catalog-delivered model intelligence scores and estimated output throughput to help compare model capabilities and performance.

### Changed

- Improved model search and selection so configured roles, provider preferences, and recent usage are prioritized while browsing and filtering models.

## [18.1.5] - 2026-09-03

- OMP sync v18.1.2–v18.1.5: declarative KDL auth contract compiler (`@bgotink/kdl` now a devDependency), provider auth definitions, and model-policy rule updates.
- Restored the biome toolchain for catalog scripts after the v18.1.5 merge briefly adopted the upstream oxlint/oxfmt configuration.

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 DeepInfra / Yolo-Auto 提供商标识。

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
