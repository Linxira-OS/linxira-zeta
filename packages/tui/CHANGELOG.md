# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
## [1.1.6] - 2026-08-30
## [18.1.3] - 2026-09-02

### Fixed

- Fixed the TUI tearing in Herdr panes so the live viewport updates as one frame instead of leaving the top frozen while only the bottom refreshed. Pane identity vars (`HERDR_PANE_ID` / `HERDR_TAB_ID` / `HERDR_WORKSPACE_ID`) also count as inside Herdr, not only `HERDR_ENV=1`. A DECRPM “unrecognized” report keeps synchronized output on; a “permanently reset” report, or a custom terminal that omits the DECRPM status, still turns it off.

## [18.1.0] - 2026-09-01

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").
