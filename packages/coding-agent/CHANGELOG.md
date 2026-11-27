## [Unreleased]

### Fixed

- Restored backend attach for the TUI: bare `/resume` opens the host session picker, cwd/settings follow the backend workspace, and `zeta update` restarts live backends. Read pagination, approval policy keys, shell worker child reaping, and the 19.2 native contracts are restored.
## [1.5.14] - 2026-11-22

### Fixed

- A TUI launch again ensures or reuses the machine-wide Host, so `/resume`, identity/IM settings and Work Studio do not require a separately started `zetacode serve`.
- In-session `/resume` uses Zeta's project → workspace → conversation resume tree again instead of the flat upstream session list.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@0d1952571415](https://github.com/Linxira-OS/linxira-zeta/blob/0d1952571415c72cca38cd02ff3728cbbd3d3584/packages/coding-agent/CHANGELOG.md).
