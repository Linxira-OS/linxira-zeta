# Changelog

## [Unreleased]

- v18.1.10 sync baseline (collab session UI updates).
- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。
## [18.4.10] - 2026-10-02

### Fixed

- Fixed long transcript paragraphs slowing Markdown rendering: a 44 KB paragraph with no blank line now parses in about 3 ms instead of 100 ms ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed transcript paragraphs with many unclosed `$`, `\(` or `\[`, slowing Markdown rendering for seconds ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).

## [18.4.1] - 2026-09-28

## [1.0.2] - 2026-08-15

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
