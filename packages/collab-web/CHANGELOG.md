# Changelog

## [Unreleased]

- v18.1.10 sync baseline (collab session UI updates).
- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [18.4.1] - 2026-09-28

### Fixed

- Prevented iOS Safari from zooming collab text fields on focus in wide touch viewports, including landscape orientation ([#13371](https://github.com/can1357/oh-my-pi/pull/13371) by [@andersennl](https://github.com/andersennl)).

## [18.4.0] - 2026-09-28

### Changed

- Redesigned the web client: black chassis with one inset session panel, glass top bar with the omp mark and a live status pill, a docked composer card, prompts shown as cards in the transcript, a sectioned agents rail, and a floating agent drawer; the connect screen was rebuilt too

## [18.3.1] - 2026-09-25

### Fixed

- Improved large-session browsing and reconnect behavior: recent transcript entries load quickly, earlier entries can be loaded on demand without losing your place, and the existing transcript remains visible with download progress during reconnects.

## [18.3.0] - 2026-09-24

### Added

- Added support for rendering coordinated job and messaging views through the `wait` tool.

### Removed

- Removed the obsolete `hub` tool renderer.

## [18.2.1] - 2026-09-15

### Fixed

- Browser collab guests now automatically rejoin when a transient host network drop recreates the relay room ([#11858](https://github.com/can1357/oh-my-pi/issues/11858)).

## [18.1.17] - 2026-09-10

### Fixed

- Transcript links are now allowed by the scheme the browser will actually resolve, so a destination that only becomes `javascript:` after URL normalization is dropped like any other unsafe scheme ([#11562](https://github.com/can1357/oh-my-pi/pull/11562) by [@alphastorm](https://github.com/alphastorm)).

## [18.1.3] - 2026-09-02

### Fixed

- The guest transcript now returns to the latest message after an initial connection or reconnect.

## [18.0.8] - 2026-08-27

### Added

- Transcript Markdown now renders LaTeX: `$…$` and `\(…\)` inline, `$$…$$` and `\[…\]` in display mode, plus own-line `$$`/`\[` blocks. Currency ("$5 and $10"), escaped dollars, and code spans stay literal, and half-streamed delimiters stay visible until the equation closes.
- Note: parity with the TUI covers these delimited forms only. Bare `\begin{…}…\end{…}` environments without `$$`/`\[` fences remain literal here (the TUI typesets them); web support is a follow-up.

## [17.3.8] - 2026-08-19

### Fixed

- The ask tool card now renders the note the user attached to their answer; previously it was dropped from HTML exports and the collab guest view.

## [17.2.10] - 2026-08-06

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.2] - 2026-08-15

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
