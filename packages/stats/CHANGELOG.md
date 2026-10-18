## [Unreleased]

### Fixed

- Usage recorded at $0 for a model whose catalog price changes on a date (Gemini 4 Argon, Devin SWE-2) is now priced at the rate in force on the request's date, instead of staying $0 like peak/off-peak tariff usage ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Providers → Subscription windows no longer mixes Codex 5-hour and 7-day quotas across plans: Team and weekly-only (ProLite) accounts now share the 7-day row, the 5-hour row counts only accounts that have one, and labels no longer flip with whichever account reported last ([#15664](https://github.com/can1357/oh-my-pi/issues/15664))

- Fixed usage stats pricing Google Antigravity and MiniMax Token Plan models at $0 when their catalog rows carry no price; they now use the catalog's pricing peer, as `xai-oauth` already did ([#16092](https://github.com/can1357/oh-my-pi/pull/16092) by [@H4vC](https://github.com/H4vC))

## [1.2.0] - 2026-10-12

### Added

- The dashboard renders in the host language: the CLI's language setting (or the browser preference) is injected into the page, and the sidebar, cards, table headers, legends, empty states, and date/number formats all follow it; Simplified Chinese ships first, with English as the fallback. The language is fixed at startup (no in-page switcher) because the dashboard launches together with `zetacode stats`.
- The "emotional pressure" page: the coverage card distinguishes "judged / regex / unscored" — languages the dictionary does not cover (e.g. Japanese, Korean, Cyrillic) show as **unscored** rather than being judged calm.

### Changed

- Improved dashboard responsiveness and efficiency by reducing unnecessary data refreshes and re-rendering, speeding up session synchronization, database access, package imports, and usage, model, and time-series requests, and avoiding repeated downloads of unchanged traces.
- Dashboard requests are now cancelled when no longer needed, improving responsiveness when switching sessions or closing trace views during loading.
- Reworked the "emotional pressure" detection layer: added a Chinese and voice-input dictionary (no word boundaries and no punctuation reliance, since Chinese input often comes from speech transcription and profanity frequently appears as homophones), added emphasis signals (full-width exclamation runs, repeated characters, repeated words) for judging anger, and added a cross-language signal — **an entire message repeating the previous one**. It no longer relies on emoji (users barely type them; only models emit them); the English dictionary is unchanged. The judging prompt is now language-neutral and tolerates mixed Chinese/English within a single message.

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 临时目录过滤保持（测试垃圾不入库）；stats-cli 摘要测试种子适配非 temp 编码目录。

## [1.1.22] - 2026-09-30

- CLI bin 命名(zeta-c)相关提示文案对齐;`zetacode stats` 面板不受影响。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:统计聚合遍历熔断(withStatsSyncLock 文件锁重写)。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步,内部修复。

## [1.1.12] - 2026-09-10

- 同步 worker 选择器与主 CLI 的 `__zeta_worker_*` 家族对齐,修复 stats 子系统无法启动的问题。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline (stats tracking panel updates).

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: `/trace` tracking panel, compaction summary persistence, and stats-sync worker alignment.

## [1.1.5] - 2026-08-26

- 随 1.1.5 版本线对齐发布：OMP v18.0.6 同步未触及本包，无独立功能变更。
