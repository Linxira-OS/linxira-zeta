# Changelog

## [Unreleased]

## [1.1.12] - 2026-09-10
## [18.1.16] - 2026-09-09

- Updated Fire Pass (`firepass`) login validation probe to `accounts/fireworks/routers/glm-5p2-fast` and bundled `glm-5.2-fast` and `kimi-k3-fast` models in place of decommissioned `kimi-k2.6-turbo` ([#10859](https://github.com/can1357/oh-my-pi/pull/10859) by [@olegpulatov](https://github.com/olegpulatov)).

## [18.1.14] - 2026-09-07

- 品牌与合并工具链维护版本;无本包用户可见变更。

## [1.1.11] - 2026-09-08

### Added

- Added Muse Code as a provider with Muse Spark models and live account-scoped discovery; subscriptions resolve a compact edit-prompt variant, cutting recurring per-request tool bytes without touching other providers. Added Meta's `max` reasoning effort tier to Muse Spark 1.3 (standard) on the Meta Model API and Muse Code.

### Fixed

- GPT-6 Astra keeps its documented 1.05M-token window with `/extended-context` on or off; Codex Astra defaults to 272K, clamps explicit context-window overrides to the server-honored ceiling, uses the documented 922K input cap inside the 1.05M total, and bills long-context requests at the documented 2x input / 1.5x output tier above 272K input (Codex subscription route exempt with free cache writes).
- Fixed GitHub Copilot enterprise-only model ids inheriting another provider's wire routing (e.g. `gpt-5.6-sol-fast` pinning every request to the `-none` sibling id regardless of thinking level).
- Extended-context catalog rebuilds resolve each model's maximum window once per process.

## [1.1.10] - 2026-09-07

### Added

- Muse Code provider baseline from the v18.1.12 sync: provider registration, Spark models, live discovery, `max` reasoning tier.

### Fixed

- Fixed OpenCode Go/Zen live model discovery missing `x-opencode-session` attribution: discovery requests carry the stable install id so requests flagged as `Bun fetch` get the required session header.
- Fixed GPT-6 Astra requests through GitHub Copilot failing with an unsupported endpoint error.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline; retired pi-hashline catalog entry removed from the version-line catalogs.

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
