## [Unreleased]

## [1.4.0] - 2026-10-21

- Version line moves to 1.4.0 with the rest of the suite; no user-visible change in this package.

## [1.3.2] - 2026-10-19

- Version line moves to 1.3.2 with the rest of the suite; no user-visible change in this package.

## [1.3.1] - 2026-10-19
## [18.12.6] - 2026-10-21

### Added

- Added `RpcConnection.requestCancellable()` and `Client.requestPermission(params, { signal })`; client connections abort a handler and answer `-32800` when the peer sends `$/cancel_request`, while agent connections keep running the request and return its real result ([#15885](https://github.com/can1357/oh-my-pi/pull/15885) by [@marcintustin](https://github.com/marcintustin))

## [18.12.4] - 2026-10-20

### Breaking Changes

- `readTarEntriesFromBuffer()` in `@oh-my-pi/pi-utils/ar/tar` now returns `Promise<ArchiveIndexEntry[]>` instead of `ArchiveIndexEntry[]`; `await` its result ([#16394](https://github.com/can1357/oh-my-pi/pull/16394) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added `maxStreamSize` to `ArchiveLimits` (default 4 GB): the most a large `.tar.gz` or `.tar.zst` may decompress in one pass, so a decompression bomb fails instead of running without bound ([#16394](https://github.com/can1357/oh-my-pi/pull/16394) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed `bun test` runs writing their logs into your real `~/.omp/logs`: test processes now log to a per-user `omp-test-logs-<uid>/` under the OS temp dir ([#16386](https://github.com/can1357/oh-my-pi/pull/16386) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `.tar.gz` and `.tar.zst` archives that decompress past 256 MB failing to list or read with a raw `Cannot create a Buffer larger than …` error; a bare `.gz` or `.zst` that large now names the archive size limit ([#16394](https://github.com/can1357/oh-my-pi/pull/16394) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed frontmatter repair deleting HTML comments from document bodies and plain markdown; it now strips only leading comments ahead of the opening delimiter, so prompt bodies keep their comments ([#16481](https://github.com/can1357/oh-my-pi/pull/16481) by [@adi-IL](https://github.com/adi-IL)).

## [18.12.2] - 2026-10-18

### Added

- Added `readSalvageableRows()` to read the rows of a damaged SQLite table that are still readable, skipping only the damaged pages ([#15751](https://github.com/can1357/oh-my-pi/pull/15751) by [@Shadorain](https://github.com/Shadorain))

## [1.3.0] - 2026-10-18

### Added

- Added `sanitizeTextDeep()`, which applies `sanitizeText()` to every string in a JSON-shaped value without mutating it ([#15963](https://github.com/can1357/oh-my-pi/issues/15963))
- Exported `sqliteFileIdentity()`, so a caller holding a long-lived SQLite connection can tell when its path now names a different file (e.g. after a corrupt store was quarantined and replaced) ([#14361](https://github.com/can1357/oh-my-pi/pull/14361) by [@F0Rextasy](https://github.com/F0Rextasy))
- Added `slugify()`, the shared lowercase ASCII kebab-case helper with an optional `maxLength` ([#14283](https://github.com/can1357/oh-my-pi/pull/14283) by [@jaredlyon](https://github.com/jaredlyon))
- Added `getMnemopiEmbedRuntimeDir()` for the shared mnemopi embedding server endpoints and logs.

### Fixed

- Fixed Windows archive extraction overwriting existing files or following existing symlinks when copying a symlink entry without symlink privileges ([#15931](https://github.com/can1357/oh-my-pi/pull/15931) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed Markdown fence info-string parsing to keep backtick-containing backtick openers as paragraph text while accepting backticks in tilde info strings and Unicode line separators in either fence's info string ([#15928](https://github.com/can1357/oh-my-pi/pull/15928) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed `parseHTML` treating `<link>` in RSS/Atom documents as an HTML void element, which dropped the URL text of RSS `<link>…</link>` ([#15954](https://github.com/can1357/oh-my-pi/issues/15954))
- Fixed an unhandled rejection when a subprocess is spawned with an already-aborted signal ([#15750](https://github.com/can1357/oh-my-pi/pull/15750) by [@harshaygadekar](https://github.com/harshaygadekar))
- Fixed `ChildProcess.kill()` silently leaving the child running when the native process handle could not be resolved or used; it now signals the child directly and escalates to SIGKILL after the grace period.

## [1.2.0] - 2026-10-12

- Added `getNativeGrammarsDir()`, where the native addon loads downloaded tree-sitter grammars from (`~/.zeta/natives/grammars`).

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- v18.4.11 集成：dirs.ts XDG 解析增量（skill-descriptions/predict/global daemon）+ 插件存储契约（`pi.storage` 三目录、`adoptLegacyFileOnce` 公共化）；插件锁文件名保持上游兼容。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:JSON 与缓存逻辑流线化重构、which 缓存改字符串键重写。
- Optimized model configuration command execution by deduplicating requests and adding failure backoff
- Prevented unnecessary credential command execution when runtime API keys are configured
- Retained `readLines()` results no longer change when later chunks reuse the internal buffer.
- Long sleeps honor elapsed time and re-arm after premature timer wakes without overflowing native timer delays.
