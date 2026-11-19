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
| [0006](0006-release-freeze-internal-line.md) | Freeze publishing on the 1.5 internal build line; 1.6.0 is the next public release | Superseded | 2026-11-11 | [0033](0033-1-5-2-owner-asset-review.md) | [release process](../release.md), [policy](../../scripts/release-policy.ts), [guard test](../../scripts/release-freeze.test.ts) |
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
| [0036](0036-upstream-interface-alignment.md) | Align to upstream interfaces before extending; never blanket-allowlist Zeta losses | Accepted | 2026-11-12 | — | [merge damage classes](../agents/merge/damage-classes.md), [maintenance protocol](../maintenance-ownership.md), [upstream sync](../upstream-sync.md) |
| [0037](0037-team-runtime-governance.md) | `/team` reuses Vibe workers with project governance; legacy PM/Lead is hidden as Super Team | Accepted | 2026-11-14 | — | [Team mode](../../packages/coding-agent/src/session/agent-session.ts), [Vibe](../../packages/coding-agent/src/vibe/runtime.ts), [tracking](../../packages/coding-agent/src/tools/tracking.ts) |
| [0038](0038-two-lane-agent-hierarchy.md) | Reuse the Vibe worker tree for governed Team mode; hide the legacy Super Team surface | Accepted | 2026-11-14 | — | [Vibe](../../packages/coding-agent/src/vibe/runtime.ts), [local protocol](../../packages/coding-agent/src/internal-urls/local-protocol.ts), [Team docs](../../docs/team.md) |
| [0039](0039-background-work-source-binding.md) | Background work survives /resume by staying bound to its source transcript | Accepted | 2026-11-14 | — | [Vibe mode](../../docs/vibe-mode.md), [AgentSession switch](../../packages/coding-agent/src/session/agent-session.ts), [async delivery](../../packages/coding-agent/src/async/job-manager.ts), [tests](../../packages/coding-agent/test/agent-session-async-delivery.test.ts) |
| [0043](0043-studio-conversation-contexts.md) | Studio Conversation Contexts | Proposed | 2026-11-14 | — | [browser transport](../../web-app/src/vendor/transport-web/src/browser-client.ts), [Studio host](../../packages/coding-agent/src/server/studio-host/server.ts) |
| [0044](0044-studio-tag-sync-automation.md) | Studio tag sync automation | Proposed | 2026-11-14 | — | [Studio sync](../../scripts/studio-sync.ts), [gate profiles](../../scripts/studio-gate.ts) |
| [0045](0045-studio-command-terminal-workspace.md) | Studio command terminals retain their workspace | Proposed | 2026-11-15 | — | [terminal gateway](../../packages/coding-agent/src/server/web-gateway/terminal.ts), [REQ-099](../requirements-ledger.md) |
| [0046](0046-studio-workspace-file-resources.md) | Studio workspace file resources use the existing Host authority | Proposed | 2026-11-15 | — | [files family](../../packages/coding-agent/src/server/studio-host/ops/files.ts), [REQ-099](../requirements-ledger.md) |
| [0047](0047-studio-runtime-private-resources.md) | Studio runtime resources retain Zeta serve ownership | Proposed | 2026-11-15 | — | [serve registry](../../packages/coding-agent/src/server/serve-registry.ts), [REQ-099](../requirements-ledger.md) |
| [0048](0048-studio-memory-private-credentials.md) | Desktop memory credentials supplement the existing Zeta runtime authority | Proposed | 2026-11-15 | — | [Host](../../packages/coding-agent/src/server/studio-host/server.ts), [REQ-099](../requirements-ledger.md) |
| [0049](0049-studio-native-evaluations.md) | Studio evaluations execute through the existing native session | Proposed | 2026-11-15 | — | [evaluation operations](../../packages/coding-agent/src/server/studio-host/ops/evaluations.ts), [REQ-099](../requirements-ledger.md) |
| [0050](0050-studio-time-travel.md) | Time Travel snapshots belong to the native Host and session tree | Proposed | 2026-11-15 | — | [native session](../../packages/coding-agent/src/session/agent-session.ts), [REQ-099](../requirements-ledger.md) |
| [0051](0051-studio-project-services.md) | Studio services use the existing workspace broker and exact launch instances | Proposed | 2026-11-15 | — | [broker](../../packages/coding-agent/src/launch/broker.ts), [REQ-099](../requirements-ledger.md) |
| [0052](0052-studio-input-validation-authority.md) | Studio validates operations at the existing Zeta Host boundary | Proposed | 2026-11-16 | — | [Host registry](../../packages/coding-agent/src/server/studio-host/registry.ts), [REQ-099](../requirements-ledger.md) |
| [0053](0053-studio-private-prediction.md) | Studio prediction reuses native engines through view-owned private channels | Proposed | 2026-11-16 | — | [native prediction](../../packages/coding-agent/src/predict/client.ts), [REQ-099](../requirements-ledger.md) |
| [0054](0054-desktop-webmcp-feature-switch.md) | Desktop enables Chromium WebMCP for typed page tools | Proposed | 2026-11-16 | — | [headless launcher](../../packages/coding-agent/src/tools/browser/launch.ts), [REQ-099](../requirements-ledger.md) |
| [0055](0055-studio-session-compaction.md) | Conversation compaction and queued maintenance use native session ownership | Proposed | 2026-11-16 | — | [native session](../../packages/coding-agent/src/session/agent-session.ts), [REQ-099](../requirements-ledger.md) |
| [0056](0056-studio-session-media-artifacts.md) | Studio image and video jobs publish into native session artifacts | Proposed | 2026-11-16 | — | [session artifacts](../../packages/coding-agent/src/server/web-gateway/artifacts.ts), [REQ-099](../requirements-ledger.md) |
| [0057](0057-studio-native-worktree-lifetime.md) | Studio session worktrees retain native ownership through turns and shutdown | Proposed | 2026-11-16 | — | [native boundary](../../packages/coding-agent/src/server/studio-host/services/time-travel-boundary.ts), [REQ-099](../requirements-ledger.md) |
| [0058](0058-studio-ida-worker-reviews.md) | Studio IDA reviews fence the existing native worker identity and version | Proposed | 2026-11-16 | — | [native worker](../../packages/coding-agent/src/ida/worker.py), [REQ-099](../requirements-ledger.md) |
| [0059](0059-vendored-sheetjs-tarball.md) | Studio pins the authoritative SheetJS tarball as a local dependency | Proposed | 2026-11-16 | — | [renderer dependency](../../web-app/package.json), [REQ-099](../requirements-ledger.md) |
| [0060](0060-two-factor-failure-and-grant-lifetime.md) | Two-factor storage failures deny remote writes and factor changes revoke grants | Accepted | 2026-11-16 | — | [TOTP authority](../../packages/coding-agent/src/server/auth/two-factor-auth.ts), [REQ-102](../requirements-ledger.md) |
| [0061](0061-explicit-shared-im-conversation.md) | Multiple IM entrances may explicitly share one Agent conversation | Accepted | 2026-11-16 | — | [IM router](../../packages/coding-agent/src/channels/session-router.ts), [REQ-110](../requirements-ledger.md) |
| [0062](0062-generated-name-language.md) | Automatically generated names follow the selected language without translating identity | Proposed | 2026-11-16 | — | [title generator](../../packages/coding-agent/src/utils/title-generator.ts), [REQ-111](../requirements-ledger.md) |
| [0063](0063-message-source-and-active-team-projections.md) | Preserve message-level ingress attribution and project active Team facts | Accepted | 2026-11-14 | — | [Team surfaces](../../docs/team-studio.md), [message projection](../../packages/coding-agent/src/server/studio-host/conversation-projector.ts), [REQ-100](../requirements-ledger.md) |
| [0064](0064-robomp-read-only-running-verification.md) | Robomp running verification reports only the behavior it exercises | Proposed | 2026-11-14 | — | [robomp workflow](../agents/workflow/robomp.md), [operator reference](../../python/robomp/README.md), [REQ-060](../requirements-ledger.md) |
| [0065](0065-feishu-bounded-inbound-resources.md) | Feishu inbound image and file resources use the shared bounded inbox | Proposed | 2026-11-14 | — | [Channels reference](../../packages/channels/README.md), [ADR 0030](0030-im-secret-storage.md), [REQ-040](../requirements-ledger.md) |
| [0066](0066-model-visibility-fallback-slots.md) | Model visibility and fixed three-level fallback slots | Proposed | 2026-11-11 | — | [PR #321](https://github.com/Linxira-OS/linxira-zeta/pull/321), [REQ-028/029/076](../requirements-ledger.md) |
| [0067](0067-tui-runtime-settings.md) | TUI runtime settings reuse the existing serve authority | Accepted | 2026-11-17 | — | [IM runtime](../../docs/im-runtime-ui.md), [REQ-124](../requirements-ledger.md) |
| [0068](0068-omp-18-22-runtime-alignment.md) | Align Zeta consumers to the OMP 18.22 runtime contracts | Accepted | 2026-11-17 | — | [REQ-125](../requirements-ledger.md), [ADR 0036](0036-upstream-interface-alignment.md), [sync ledger](../upstream-sync.md) |
| [0069](0069-zeta-1-6-0-release-scope.md) | Zeta 1.6.0 targets OMP v18.22.2 and keeps Android on hold | Superseded | 2026-11-18 | Superseded by [0070](0070-zeta-1-6-0-stable-upstream-baseline.md) | [Release readiness](../release.md#160-public-release-readiness), [REQ-136](../requirements-ledger.md) |
| [0070](0070-zeta-1-6-0-stable-upstream-baseline.md) | Release Zeta 1.6.0 from OMP v18.22.0 | Superseded | 2026-11-18 | Supersedes [0069](0069-zeta-1-6-0-release-scope.md); superseded by [0071](0071-zeta-1-5-10-public-release.md) | [REQ-136](../requirements-ledger.md) |
| [0071](0071-zeta-1-5-10-public-release.md) | Publish Zeta 1.5.10 from OMP v18.22.0 | Superseded | 2026-11-18 | Superseded by [0072](0072-restore-normal-public-releases.md) | [REQ-141](../requirements-ledger.md) |
| [0072](0072-restore-normal-public-releases.md) | Restore normal public releases | Accepted | 2026-11-18 | Supersedes the ongoing freeze in [0006](0006-release-freeze-internal-line.md) and override in [0071](0071-zeta-1-5-10-public-release.md) | [Release readiness](../release.md#1510-public-release-readiness), [REQ-142](../requirements-ledger.md) |

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
