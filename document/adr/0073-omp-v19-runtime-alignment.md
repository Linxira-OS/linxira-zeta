# 0073. OMP v19.0.0 runtime alignment keeps the Zeta broker and ports upstream runtime features selectively

- **Status:** Proposed
- **Date:** 2026-11-19
- **Deciders:** Zeta owner (pending)
- **Links:** [OMP v19.0.0](https://github.com/can1357/oh-my-pi/tree/v19.0.0), [merge playbook](../merge-playbook.md), [upstream ledger](../upstream-sync.md), [damage classes](../agents/merge/damage-classes.md)

## Context

Zeta `1.5.10` is on OMP `v18.22.0`. The `v19.0.0` release (`57771ae562b9345e0579bceb2d68d585e3e6927e`)
is a runtime remodel, not a feature-only bump. The true merge commit
`1c89d546d9` (parents `a84dda442f9` and `57771ae5…`) was created after
`git merge-base --is-ancestor 57771ae5 HEAD` passed. Reconciliation stopped
short of a green type check because upstream v19 and Zeta `1.5.10` contain two
generations of the same runtime boundaries.

Observed upstream changes:

- `crates/pi-*` became `crates/{ast,builtins,diff,edit,iso,natives,predict,shell,vcs,vfs,voice,xfs}`
  with `omp-*` package names; Zeta adopted the new directories and kept its
  `pi-*` package names/imports.
- A single per-user daemon (`src/daemon/protocol.ts`, `daemon/modules/*`) replaced
  several per-project brokers. Upstream deleted `launch/broker`, `blob-broker`,
  and parts of `launch/`; Zeta still ships the launch broker for Studio service
  management.
- Async notify, MCP eval namespaces, cache-bridge compaction, handoff/wake
  accessors, origin/client/memory-namespace provenance, and session title-card
  readers were added or moved under new signatures.
- Upstream reintroduced a live-collab subsystem and `packages/collab-web`.
  Zeta retired live-session collaboration and share upload on 2026-11-07.
- Browser `tern`/`webkit` additions, a metaharness package, and new native
  crates arrived; the browser additions are adopted, the collab surface is not.

The WIP branch `sync/omp-release/v19.0.0` currently restores Zeta product
surfaces (launch broker, Studio Host, channels, Vibe/Team, IRC/registry, stats,
predict) on top of the true merge, and removes the reintroduced collab/share
surface. `bun run check:ts` still reports cross-generation mismatches, so the
branch is not pushable.

## Decision

The merge keeps the Zeta launch broker and Studio Host as the service/observation
owner, and ports upstream v19 runtime features only where they do not replace
that owner. Per upstream surface:

| Upstream v19 surface | Zeta disposition | Reason |
| --- | --- | --- |
| `crates/*` rename and `crates/xfs` | Adopt directories; keep `pi-*` package names and Zeta addon names | Zeta's native package line and bazel/brand paths already key on `pi-*`; upstream names are internal, not a product contract |
| Per-user `daemon/` protocol and modules | Adopt alongside the Zeta broker; no new Zeta consumer switches to it in this round | Studio terminal/observation flow depends on the broker; the daemon is needed by upstream-only modules |
| `launch/broker`/`blob-broker` deletion | Keep Zeta files and their consumers | Zeta Studio services and browser observation use them; upstream removal is not a Zeta product remodel |
| Async notify, MCP eval namespace, cache-bridge methods | Port accessors into the session surface; keep Zeta behavior where the base runtime lacks the upstream subsystem | `sdk.ts` calls these; without accessors the session cannot hand tool events to eval or job widgets |
| Handoff/wake accessors (`isGeneratingHandoff`, `abortHandoff`, `hasPendingWake`, `hasWakeAfterTurn`) | Adopt; wire the Zeta handoff controller and wake sources | These are external-state contracts used by modes, Studio and thread views |
| Client/origin/memory-namespace provenance | Keep the Zeta `1.5.10` behavior | Zeta stamps CLI/IM/Team provenance; upstream dropped parts of the writer |
| Session title-card readers (`getSessionTitleCard`, `peekSessionTitle`) | Adopt in the session manager and Studio title service | Work Studio title rows depend on the Zeta card fields |
| Live-collab runtime and `packages/collab-web` | Do not re-enable; remove the newly imported surface from the branch | Owner retirement 2026-11-07; AGENTS.md forbids re-publishing relay endpoints |
| Browser `tern`/`webkit`, metaharness | Adopt files; adapt Zeta browser services to the new tab types | Upstream additions extend the existing browser tool, not a replacement |
| Team/Vibe/Lead and mode API | Keep the Zeta `1.5.10` files and sentinels | ADR-0037/0038 product behavior; upstream v19 has no equivalent |

The merge is not complete until the following are true: `bun run
check-version-consistency.ts`, `bun run check:ts`, `check-scope-imports`,
`check-license-map`, `brand-check`, `check-zeta-sentinels`,
`check-ci-surface`, and the sync bucket/Rust gates pass, and
`bun scripts/audit-merge-members.ts` reports no dropped Zeta members.

This ADR is settled by owner approval of the dual-stack boundary above; a
different choice (adopt the per-user daemon as the only service owner, or keep
the upstream collab surface) requires a new ADR and a new merge round.

## Consequences

- Zeta keeps a working Studio service/observation owner while gaining upstream
  daemon modules for upstream-only consumers.
- Two daemon generations coexist until a later ADR retires the Zeta broker;
  the boundary is explicit, not a compatibility alias.
- Zeta will not surface the reintroduced live-collab commands or relay
  endpoints; the files removed in the WIP commit stay out of the product.
- The sync branch remains blocked until the cross-generation accessors and the
  Zeta-only type fields are reconciled; the ledger records the partial state.

## Alternatives

- **Adopt upstream v19 wholesale, including the per-user daemon and collab.**
  Rejected for this round: it deletes Zeta Studio service/observation behavior
  and reverses the live-collab retirement without an owner decision.
- **Keep every Zeta `1.5.10` file and accept only the crate/package rename.**
  Rejected: it leaves the upstream `sdk.ts`/thread calls against removed session
  accessors and fails `check:ts`, so it is not a complete merge.
- **Land the merge without the sync gates.** Rejected by AGENTS.md §6 and the
  merge playbook; a branch that cannot type-check is not a completed sync.

## Links

- [Upstream sync ledger](../upstream-sync.md)
- [Merge playbook](../merge-playbook.md)
- [Zeta-only sentinels](../../scripts/brand/zeta-sentinels.ts)
- [Merge member audit](../../scripts/audit-merge-members.ts)
- [Release policy](../release.md)
