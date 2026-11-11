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
| [0006](0006-release-freeze-internal-line.md) | Freeze publishing on the 1.5 internal build line; 1.6.0 is the next public release | Accepted | 2026-11-11 | — | [release process](../release.md), [policy](../../scripts/release-policy.ts), [guard test](../../scripts/release-freeze.test.ts) |

### Report completion reservations

These numbers are reserved for one integration owner. They are allocations, not
ADR records or Accepted decisions. Add a linked index row only with its real
decision file; do not fill sequence gaps with placeholder decisions.

| Reserved ID | Decision scope | Draft owner |
| --- | --- | --- |
| 0007 | Team bootstrap journal and room live delivery | team-vibe-hardening |
| 0008 | IM instances, Agent Profiles and binding isolation | im-platform-expansion |
| 0009 | Model visibility and fixed three-level fallback | model-visibility-audit |
| 0010 | Remote credentials, device sessions, 2FA and SSH trust | device-account-ux |
| 0011 | Studio workspace-selection read-model contract | jcode-cite-finish |
| 0012 | Electron runtime and desktop host boundary | electron-upgrade-audit |
| 0013 | Android Tier 1 security and distribution boundary | android-research |
| 0014 | TUI input hardening, IME and relay lifecycle | tui-shake-research |
| 0015 | Local Super agent Rooms | queued |
| 0016 | Compaction service and fidelity | runtime-strategy |
| 0017 | Official/custom command metadata | report-commands |
| 0018 | Context and prompt reload | startup-latency2 |
| 0019 | Offline automation and replay | automation lane |


## File and numbering rules

- One decision per file: `NNNN-<lowercase-kebab-slug>.md`, zero-padded to four digits.
- Number sequentially from the highest existing ID. Never reuse or renumber an ID.
- Every ADR carries `Status`, `Date`, `Deciders`, and `Links` metadata, plus
  `Context`, `Decision`, `Consequences`, `Alternatives`, and `Links` sections.
- Add the index row in the same change as the ADR. The guard rejects an ADR
  without an index row, an index row without a file, duplicate IDs, and gaps in
  the sequence.
- Link real PRs, docs, tests, and assets. Never invent a SHA, PR number, or
  external repository detail. If a fact is unknown, say so in the ADR and keep
  the status **Proposed**.

The template is [template.md](template.md). Run `bun run check:adr` after editing.
