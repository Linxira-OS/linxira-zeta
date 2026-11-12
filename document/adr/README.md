# Architecture Decision Records

`document/adr/` is Zeta's durable decision record and the long-term tracking
surface for contract-level choices. An ADR explains **why** a choice was made
and what it costs. It is not a changelog, a plan, or a design doc: code, schemas,
and the linked docs remain the source of truth for current behavior.

## Statuses

| Status         | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **Proposed**   | Under discussion and not decided. The ADR must say what evidence or decision would settle it.               |
| **Accepted**   | Committed. The decision is binding until a later ADR supersedes it.                                          |
| **Superseded** | Replaced by a later ADR. The old body stays intact; its status and links point at the replacement.           |
| **Deprecated** | No longer followed, but not replaced by a single decision (for example the whole surface was retired).       |

An **Accepted ADR is immutable**. Do not rewrite its context or decision to match
a newer choice. Change the decision by writing a new ADR that supersedes it, then
update only the old ADR's status and links.

## When an ADR is required

Write one when a decision changes:

- architecture layering or process/runtime boundaries;
- a public API, tool schema, CLI, or wire/HTTP contract;
- a data model, persistence format, or cross-system data ownership;
- a security or authorization boundary (trust levels, credentials, admin scope);
- a dependency, license, or attribution obligation that becomes a product commitment;
- an irreversible or hard-to-reverse migration;
- release scope: what ships, what is deferred, or what becomes a compatibility promise.

Do not write one for bug fixes, renames, formatting/style changes, or behavior-preserving
refactors. A refactor needs an ADR only when it changes one of the contracts above.

## Index

| ID   | Title | Status | Date | Supersedes / superseded by | Links |
| --- | --- | --- | --- | --- | --- |
| [0001](0001-runtime-layering.md) | Split the desktop runtime into an Electron shell, a Bun backend, and a Chromium renderer | Accepted | 2026-11-11 | — | [desktop editions](../../docs/desktop-app.md), [code locations](../agents/surface/code-locations.md) |
| [0002](0002-four-data-store-boundaries.md) | Four data-store boundaries: Zeta state and three external stores | Proposed | 2026-11-11 | — | [local Team DB](../../docs/team.md) |
| [0003](0003-team-core-vs-pi-messenger.md) | Team core owns Team mode; `pi-messenger` owns only Crew and Mesh | Accepted | 2026-11-11 | — | [Team foundation](../../docs/team.md), [pi-messenger](../../docs/plugins/pi-messenger.md) |
| [0004](0004-desktop-shell-electron-tauri.md) | Ship the Electron desktop shell; defer Tauri without rejecting it | Accepted | 2026-11-11 | — | [desktop editions](../../docs/desktop-app.md), [desktop README](../../desktop/README.md) |
| [0005](0005-adr-and-release-traceability.md) | Record contract decisions as ADRs and trace them through release | Accepted | 2026-11-11 | — | [release process](../release.md), [index guard](../../scripts/check-adr-index.ts) |
| [0007](0007-agent-profile-runtime.md) | Agent profile as the per-runtime tool/memory admission boundary | Accepted | 2026-11-11 | — | [agent-profile contract](../../packages/coding-agent/src/agent-profile) |
| [0008](0008-native-only-foreign-sources.md) | Native-only foreign project sources and tool exposure tiers | Accepted | 2026-11-11 | — | [external sources](../../document/external-sources-and-tool-exposure.md) |
| [0006](0006-release-freeze-internal-line.md) | Freeze publishing on the 1.5 internal build line; 1.6.0 is the next public release | Superseded | 2026-11-11 | [0033](0033-1.5.2-owner-asset-review.md) | [release process](../release.md), [policy](../../scripts/release-policy.ts), [guard test](../../scripts/release-freeze.test.ts) |
| [0009](0009-team-bootstrap-live-delivery.md) | Team bootstrap journal, live room delivery, and task workers | Proposed | 2026-11-11 | — | [Team foundation](../../docs/team.md), [task queue](../team-task-queue.md) |
| [0011](0011-studio-workspace-selection.md) | Studio workspace identity and selection | Accepted | 2026-11-11 | — | [Studio surfaces](../../docs/studio-surfaces.md) |
| [0015](0015-local-super-repo-main-rooms.md) | Local Super/Repo/Main rooms are a durable log independent of Team DB rooms | Proposed | 2026-11-12 | — | [design](../super-agent-rooms.md), [runtime docs](../../docs/rooms.md) |
| [0020](0020-memory-pressure-shed-and-retention-bounds.md) | Memory pressure sheds derived render caches only; retention is bounded by measured consumer bytes | Proposed | 2026-11-11 | — | [roadmap](../roadmap.md) |
| [0025](0025-analysis-mcp-precedence.md) | Analysis MCP is recognized, never auto-installed; one capability mounts | Proposed | 2026-11-11 | — | [external sources §8](../external-sources-and-tool-exposure.md#8-mcp-与内置重复), [MCP config](../../docs/mcp-config.md), [MCP runtime](../../docs/mcp-runtime-lifecycle.md) |
| [0026](0026-agent-authored-plugins.md) | Session-scoped agent-authored plugins and a versioned page host | Proposed | 2026-11-12 | — | [design](../agent-authored-plugins.md), [plugins docs](../../docs/plugins.md) |
| [0027](0027-dictation-audio-bridge.md) | Host-owned draft dictation over a desktop-only ordered audio bridge | Proposed | 2026-11-12 | — | [REQ-075](../requirements-ledger.md), [Studio surfaces](../../docs/studio-surfaces.md), [desktop](../../docs/desktop-app.md) |
| [0028](0028-release-preconditions.md) | Release preconditions are mechanical: scope, evidence, ADRs, and CI verdict | Proposed | 2026-11-11 | — | [release process](../release.md), [scope gate](../../scripts/release-scope.ts) |
| [0029](0029-im-switch-gateway.md) | IM switch handshake gateway wire | Accepted | 2026-11-12 | — | [Team Studio](../../docs/team-studio.md), [session router](../../packages/coding-agent/src/channels/session-router.ts), [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts) |
| [0030](0030-im-secret-storage.md) | IM credentials use the local web.yml permission boundary | Accepted | 2026-11-12 | — | [IM runtime UI](../../docs/im-runtime-ui.md), [channels docs](../../docs/channels.md) |
| [0031](0031-team-hub-headless-parity.md) | Team Hub headless/ACP/IM parity uses the existing Team read model | Accepted | 2026-11-12 | — | [Team foundation](../../docs/team.md), [team hub data](../../packages/coding-agent/src/team/hub-data.ts), [slash commands](../../packages/coding-agent/src/slash-commands/builtin-zeta.ts), [Team CLI](../../packages/coding-agent/src/cli/team-cli.ts) |
| [0032](0032-lead-headless-parity.md) | Lead mode is reachable from headless/ACP/IM slash dispatch | Accepted | 2026-11-12 | — | [Team foundation](../../docs/team.md), [mode service](../../packages/coding-agent/src/session/agent-session.ts), [slash modes](../../packages/coding-agent/src/slash-commands/builtin-modes.ts) |
| [0033](0033-1-5-2-owner-asset-review.md) | One exact 1.5.2 owner-review GitHub-assets release; npm and 1.6 stay closed | Accepted | 2026-11-12 | Supersedes [0006](0006-release-freeze-internal-line.md) for this version only | [Release policy](../../scripts/release-policy.ts), [scope gate](../../scripts/release-scope.ts), [freeze tests](../../scripts/release-freeze.test.ts), [workflow](../../.github/workflows/ci.yml) |
| [0034](0034-owner-scope-holds-2026-11-12.md) | Owner holds: Android, desktop, audio, and the multi-terminal manager are paused pending explicit re-entry | Accepted | 2026-11-12 | — | [Roadmap](../roadmap.md), [requirements ledger](../requirements-ledger.md), [Studio surfaces](../../docs/studio-surfaces.md), [Android Tier 1](../../docs/android-tier1.md), [ADR 0033](0033-1-5-2-owner-asset-review.md) |
| [0035](0035-pause-qq-wecom-channels.md) | Pause QQ and WeCom channel work; retain OneBot source without a support commitment | Accepted | 2026-11-12 | — | [channels](../../docs/channels.md), [GUI IM channels](../../docs/gui-im-channels.md), [roadmap](../roadmap.md), [requirements ledger](../requirements-ledger.md), [ADR 0034](0034-owner-scope-holds-2026-11-12.md) |

## File and numbering rules

- One decision per file: `NNNN-<lowercase-kebab-slug>.md`, zero-padded to four digits.
- Numbering is a stable identifier, not a dense sequence. Choose an ID greater
  than every existing ID; gaps are allowed and MUST NOT be backfilled with a
  placeholder ADR. Never reuse, renumber, or delete an ID, including an Accepted
  one.
- Every ADR carries `Status`, `Date`, `Deciders`, and `Links` metadata, plus
  `Context`, `Decision`, `Consequences`, `Alternatives`, and `Links` sections.
- Add the index row in the same change as the ADR. The guard rejects an ADR
  without an index row, an index row without a file, duplicate IDs or filenames,
  a non-increasing or reserved ID, a malformed filename, and an empty
  placeholder. It does not require contiguous numbering: `0001, 0002, 0005`
  passes.
- Link real PRs, docs, tests, and assets. Never invent a SHA, PR number, or
  external repository detail. If a fact is unknown, say so in the ADR and keep
  the status **Proposed**.

The template is [template.md](template.md). Run `bun run check:adr` after editing.
