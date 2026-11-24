# Zeta Terminal (Wave fork)

Read `ZETA-FORK.md` before changing anything here.

- Apache-2.0. Keep `LICENSE` and `NOTICE`; record material modifications.
- Report every problem to Zeta maintainers first. Never open upstream issues,
  pull requests, discussions, or security reports for Zeta-specific work.
- This directory is independent: it is not a root workspace member. It has a
  root CI entry (`.github/workflows/terminal-ci.yml`) for its own tests, but is
  not wired into release, packaging, npm, or publish workflows yet.
- Do not run a global `omp|wave -> zeta` text sweep. Name changes belong with
  resources, i18n, and build metadata changes that are reviewed together.
- User-visible strings go through `frontend/i18n` (`en` is the source of truth;
  `zh-CN` must define every key). Do not add new inline UI copy.
- User-visible external links point at Zeta: GitHub
  `Linxira-OS/linxira-zeta`, site `https://linxira-os.github.io/zh/`, docs
  `https://linxira-os.github.io/zh/docs/`. Never link users to Wave upstream.
- Current product build scope is Linux + Windows; macOS is deferred. Shell
  policy: Nushell recommended; PowerShell 7+ only; no Windows PowerShell 5.1
  or `cmd.exe` fallback.
- Preserve upstream third-party notices and dependency licenses.
