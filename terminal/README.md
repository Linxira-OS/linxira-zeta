<!-- Zeta fork notice: read ZETA-FORK.md. Report all Zeta-specific issues to Zeta
maintainers first; do not open upstream issues, PRs, or security reports for this fork. -->

<p align="center">
  <a href="https://linxira-os.github.io/zh/">
    <img alt="Zeta Terminal" src="./assets/zeta/zeta-terminal-256.png" width="160">
  </a>
</p>

# Zeta Terminal

<div align="center">

[English](README.md) | [繁體中文](README.zh-TW.md)

</div>

Zeta Terminal is the first-party terminal of the Zeta project, forked from
[Wave Terminal](https://github.com/wavetermdev/waveterm) under Apache-2.0. It is
built as part of the Zeta product family, not as a separate upstream product.

**Current platform scope: Linux and Windows.** macOS is not built or released in
this phase; the target may return later. Linux x64 and Windows x64 are the default
builds; arm64 is manual/nightly.

## What is different in this fork

- Zeta branding, logo, icons, About window, and documentation links.
- Built-in Wave AI will be disabled; the agent surface moves to Zeta Code over
  ACP, with an optional TSP page on the right.
- Nushell is the recommended cross-platform default shell. Bash and Fish remain
  the common Linux choices. PowerShell 7+ is supported on Windows; Windows
  PowerShell 5.1 and `cmd.exe` are explicitly unsupported.
- Per-window shell selection and shell/CWD tracking are on the roadmap. The
  current `term:localshellpath` remains the low-level override.
- Chinese localization is being introduced through a typed i18n catalogue; the
  settings surface is being reorganized from raw config files into usable pages.

See [ZETA-FORK.md](./ZETA-FORK.md) for the fork policy and the change log.

## Build

```sh
# Linux / Windows, from this directory
go build ./cmd/wsh
task build
```

Build prerequisites and packaging details are in [BUILD.md](./BUILD.md). Zeta
Terminal is not a member of the root Zeta workspace and does not participate in
the root release or npm publish flows.

## Shell support

| Platform | Recommended | Also supported | Not supported |
|---|---|---|---|
| Linux | Nushell | Bash, Zsh, Fish | — |
| Windows | Nushell | PowerShell 7+ (`pwsh.exe`), WSL, Git Bash | Windows PowerShell 5.1, `cmd.exe` |

PowerShell 7 is detected as `pwsh.exe` and must report major version 7 or newer.
If it is missing, Zeta Terminal prompts for Nushell instead of falling back to
the legacy Windows shell.

## Links

- Zeta website — https://linxira-os.github.io/zh/
- Brand assets — https://linxira-os.github.io/zh/docs/brand-assets/
- Zeta repository — https://github.com/Linxira-OS/linxira-zeta
- This fork — https://github.com/Linxira-OS/linxira-zeta/tree/main/terminal

## License and attribution

Zeta Terminal is licensed under Apache-2.0. The original Wave Terminal copyright,
license, and NOTICE are preserved in [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
Third-party acknowledgements remain in [ACKNOWLEDGEMENTS.md](./ACKNOWLEDGEMENTS.md).

Wave Terminal is Copyright Command Line Inc. Zeta-specific changes are Copyright
Linxira OS contributors.
