# OMP Studio v0.2.4 → v0.2.8 delta (inventory, not acceptance)

Date: 2026-11-22. No Studio renderer was merged or copied.

Current Zeta Studio source: `v0.2.4` (`64170f9a5791`), OMP 18.22.0.
Latest upstream release observed: `v0.2.8`, built-in Runtime `19.0.1-studio.1`.

## Runtime boundary

| Studio | Built-in Runtime | Zeta consequence |
| --- | --- | --- |
| v0.2.4 | 18.20.2-studio.14 | Current Zeta Host adapter, OMP 18.22.0 |
| v0.2.5–v0.2.6 | 18.20.2-studio.15 | Runtime older than Zeta's 18.22 baseline; not a drop-in |
| v0.2.7–v0.2.8 | **19.0.1-studio.1** | Requires the held OMP v19 integration |

Studio v0.2.7+ cannot be integrated on the current 18.22 tree without lying
about the Host contract. It is blocked on ADR-0089.

## Feature delta

### v0.2.5

- WSL 2 workspace selection, agent/toolchain routing, Explorer and VS Code WSL
  opening, reconnect after distro restart.
- Mobile LAN access with pairing, existing conversations, send/stop, single
  approval handling, revocation.
- Advisor review ordering and persistence.
- Project grouping fix for sessions; file-link resolution; Ask form paging;
  OpenCode Go/Zen credential configuration.

### v0.2.6

- Desktop startup fix for `ERR_MODULE_NOT_FOUND`; HTTPS certificate dependency
  for mobile access.

### v0.2.7

- Built on OMP 19.0.1.
- Plan review editing: source/preview synchronization, find/replace, section
  and document comments, draft/cursor/undo preservation, save-before-decision.
- `/local` session-file and full-output windows with Markdown source/preview,
  find/line jump/wrapping/font size.
- Unified disassembler workbench (IDA, Ghidra, auto/header-only, quick cards).
- Ask folding and image notes; `?` BTW; daemon/agent-wait/worktree/Kiro/Claude/
  Live synchronization; provider filter and `provider/model` search.
- Performance work and removal of the retired Seance entry.

### v0.2.8

- Composer session references: paste a session ID, disambiguate source, select
  up to six saved messages as excerpts, or send the ID alone.
- Batch deletion of archived sessions with per-session results; managed
  artifacts retained.
- Conversation activity row and grouped Advisor batches.
- `.xlsm`, `.xlsb`, `.ods` spreadsheet preview; optional Office formats.
- SSH/WSL connection preparation with staged download/upload/install/verify,
  size and SHA-256 checks.

## Zeta conflicts to classify before any sync

| Upstream area | Zeta owner/contract | Conflict to resolve |
| --- | --- | --- |
| WSL/mobile/SSH remote | Zeta remote and pairing surfaces; server authority | Do not expose a second remote authority or bypass existing auth |
| Plan editor | Zeta plan Ask consent gate (ADR-0086) | Editing a plan must not become plan-entry consent |
| Local files/output windows | Zeta artifact/local URL contracts | Host-owned file access and redaction must stay authoritative |
| Disassembler workbench | Zeta `dsm`/IDA boundary | No second native database owner |
| Ask/BTW | Zeta BTW steering (ADR-0085) | Keep C/Backspace/ESC semantics and no hidden turn |
| Session references | Zeta session identity/provenance | Same session id must not create a second task |
| Batch archive deletion | Zeta artifact retention | Managed artifacts retained; no silent deletion |
| Office/SSH prep | Zeta security and external-source gates | Verify checksums, no auto-load of foreign config |
| v0.2.7+ Runtime | OMP v19 hold | Cannot advance before ADR-0089 is executable |

## Required next artifact

A per-file Studio sync decision matrix (upstream path, Zeta path, owner, accept/
reject/adapt, test evidence) analogous to
[`studio-v0.2.4-sync-decisions.json`](studio-v0.2.4-sync-decisions.json). Do not
start with a mechanical overlay.
