# Changelog

## [Unreleased]

## [1.0.11] - 2026-08-22
## [1.0.4] - 2026-08-18
### Added

- Restored the `pdfToMarkdown` export in the published npm package. The `@linxiraos/pi-natives@1.0.2` npm publish predated the v17.3.5 merge and shipped neither the export nor the matching native symbol, so npm-installed zeta crashed at load with `SyntaxError: Export named 'pdfToMarkdown' not found`. This release bumps the package (with the `__piNativesV1_0_4` sentinel) so the rebuilt addons and bindings reach npm; omptype/wire stay at 1.0.2.


## [1.0.1] - 2026-08-14
- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.


## [1.0.0] - 2026-08-13
### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

