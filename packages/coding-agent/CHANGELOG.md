## [Unreleased]

### Changed

- Resuming a session whose saved model disappeared now keeps the current or first credentialed model, records it on the session, and warns instead of refusing to resume.

## [1.5.15] - 2026-11-27

### Fixed

- Restored backend attach for the TUI: bare `/resume` opens the host session picker, cwd/settings follow the backend workspace, and `zeta update` restarts live backends. Read pagination, approval policy keys, shell worker child reaping, and the 19.2 native contracts are restored.

## [1.5.13] - 2026-11-21

### Changed

- Z Work Studio advances to the Studio v0.2.4 renderer/shared packages through the Zeta Host adapter, without downgrading the OMP 18.22 runtime.
- Plan mode is no longer armed from guessed wording. It requires a visible Ask confirmation (`plan_mode=yes`, any language) or the user's `/plan` / `/ultra plan` command; timeouts and simple proposal/方案 requests do not count. Writing `local://<slug>-plan.md` outside active plan mode is rejected.
- Backend mode is on by default. A TUI connects to a reachable machine-wide backend without starting one, and falls back to its own local process when none is running; explicit `--backend`/`--attach` still fails closed. The Desktop install owns the login item by default; npm keeps the bundled-only OS autostart gate.
- BTW answers can be sent back to the working main agent: `C` sends only the latest answer, the panel menu can send the full question/answer conversation or multiple space-selected topics, and the complete transcript can be copied. Escape stops only the current BTW lane; Backspace returns to the coding-agent page.
- Settings no longer adds a top-level Runtime page; identity and IM remain child pages of the existing Interaction settings.
- The composer's More Models flyout links to model visibility, where exact `provider/model` entries can be hidden without hiding an entire provider.
- The Windows desktop installer now repairs the Start Menu and desktop shortcut AppUserModelID, so the taskbar associates the running window with the Zeta icon.
- Sidebar project names are explicitly left-aligned instead of inheriting the button's centered text alignment.
- Release notes now start with a user-facing summary; technical traceability is folded at the end.

## [1.5.12] - 2026-11-20

### Added

- A bare `zetacode` launch now starts or reuses one shared Host instead of racing a second daemon; `zetacode web` serves `web-app` directly.
- Studio Team opens the full workspace: Team tabs, tasks, rooms, direct-message rooms, Board, Calendar, Mail and IM chat.
- Team Board reads the Team root's `.zeta/board` cards; Calendar reads `.zeta/calendar/events`; Mail reads `mail/*.eml` with a bounded text parser.
- Settings -> General adds an Emoji labels switch; team tabs fall back to text-only labels when it is off.

### Fixed

- Resuming a session keeps background jobs running and delivers their results to the transcript that owned them.

## [1.5.11] - 2026-11-20

### Fixed

- Fixed a 1.5.10 startup crash when `web.yml` contained IM instances created by the instance editor with an empty peer allowlist; empty peers remain deny-by-default but are valid config.
- Fixed a disassembler connection race where a reference closed just before disconnect could issue one request into the destroyed host and report its exit instead of `dsm.open`.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@0d1952571415](https://github.com/Linxira-OS/linxira-zeta/blob/0d1952571415c72cca38cd02ff3728cbbd3d3584/packages/coding-agent/CHANGELOG.md).
