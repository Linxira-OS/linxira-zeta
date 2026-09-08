# Changelog

## [Unreleased]

## [1.1.10] - 2026-09-07
## [1.1.10-omp18.1.12] - 2026-09-06

### Added

- Added Muse Code as a provider with Muse Spark models and live account-scoped discovery.
- Muse Code subscriptions now resolve a compact edit-prompt variant, cutting recurring per-request tool bytes without touching other providers.
- Added Meta's new `max` reasoning effort tier to Muse Spark 1.3 (standard) on the Meta Model API and Muse Code.

### Fixed

- Fixed OpenCode Go/Zen live model discovery (`GET /v1/models`) missing `x-opencode-session` and omp's `User-Agent`: discovery requests now attribute with the stable install id so the requests OpenCode flags as `Bun fetch` carry the required session header.
	- Fixed GPT-6 Astra requests through GitHub Copilot failing with an unsupported endpoint error ([#10874](https://github.com/can1357/oh-my-pi/pull/10874) by [@xpcmdshell](https://github.com/xpcmdshell)).
	- Fixed GPT-6 Astra showing as free with a 272K-token window in the OpenAI Codex catalog by applying its documented pricing; `/extended-context` enables the wire-advertised 872K-token maximum ([#10980](https://github.com/can1357/oh-my-pi/pull/10980) by [@H4vC](https://github.com/H4vC)).
	- Fixed GPT-6 Astra compacting early at a 272K-token window with its full window gated behind `/extended-context`: it now defaults to the documented 1.05M-token window.
	- Made extended-context catalog rebuilds faster by resolving each model's maximum window once per process ([#11039](https://github.com/can1357/oh-my-pi/pull/11039) by [@H4vC](https://github.com/H4vC)).

## [1.1.10-omp18.1.9] - 2026-09-04

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

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
