# Changelog

## [Unreleased]

## [1.1.6] - 2026-08-30
## [18.0.11] - 2026-08-29

### Fixed

- Fixed Baseten GLM models, including GLM-5.3-Flash, being incorrectly classified as non-reasoning models.
- Fixed Cloudflare AI Gateway catalog refreshes so active Workers AI chat models, including newly released models, are discovered correctly.
- Fixed Cursor Kimi K3, Grok 4, and Composer 2.5 models being incorrectly treated as text-only when they support image attachments.
- Fixed OpenRouter routed model variants, including GLM-5.3 and dated DeepSeek V4 Pro, so their reasoning effort options are preserved correctly.
- Fixed MiniMax-M3 max output regressing to the upstream 512K pricing-tier boundary; all MiniMax providers keep the documented 128K output cap.
- Fixed GLM-5.3-Flash bundling the 50%-off launch promotion price; the catalog stays on the documented list price.
- Fixed Synthetic model discovery re-adding image input from the bundled reference when the route advertises text-only modalities.

## [18.0.9] - 2026-08-28

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

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
