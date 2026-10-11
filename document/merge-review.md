# Zeta Merge Review Rules

Single-page rules for reviewing an OMP release merge before it can leave a
`sync/omp-release/<tag>` branch. The AGENTS.md damage-class table is the
taxonomy; this page is the operating procedure a reviewer executes. The
machine checks referenced here are enforced in CI (`check` job) so prose-only
compliance cannot drift.

## Scope

Applies to every merge that brings upstream code into a Zeta product branch:

- OMP release merges (`sync/omp-release/<tag>`, complete official tag only)
- Pi semantic ports (`port/pi/<scope>`, `port/pi-web/<scope>`)
- Any hand-carried upstream patch that touches a shared file

## Pre-merge checklist (read, don't copy)

Order is mandatory. Each step links its authoritative source — do not
duplicate the content here; the link target is merge-protected:

1. **Baseline & tag verification** — `document/upstream-sync.md` (release
   sync policy, tag verification, ledger) and `AGENTS.md` (OMP Release Sync
   Policy section).
2. **Damage classes** — `AGENTS.md` post-merge release-surface checklist
   (8 classes) and `document/release.md` damage table. Triage fingerprints
   live there; do not re-derive them.
3. **Procedure** — `document/merge-playbook.md` six-stage pipeline.
4. **Brand surface** — `AGENTS.md` Brand Surface Registry + `scripts/brand/`
   guards (`brand-check.ts`, `brand-overlay.ts`).
5. **Zeta-only sentinels** — `scripts/brand/zeta-sentinels.ts` +
   `bun scripts/check-zeta-sentinels.ts` (this is the mechanical form of
   damage class #4; the registry is merge-protected data, the checker enforces
   the registry floor of 40 and the AGENTS.md link to this file).

## Conflict-resolution decision record

Every file resolved by hand or with `--theirs`/`--ours` in an OMP release
merge gets a row here (append, never rewrite history rows). A merge reaching
`main` with a conflict file not recorded here is invalid.

| Merge (tag) | File | Resolution | Reason |
|---|---|---|---|
| v18.1.10 | `packages/coding-agent/src/cli/update-cli.ts` | kept Zeta constants (`REPO`/`HOMEBREW_FORMULA`/`MISE_TOOL`) | upstream GH release + brew tap are the shared distribution infrastructure; renaming breaks the update chain (plan decision B6) |
| v18.1.10 | `.github/workflows/ci.yml` | kept Zeta CI (GitHub-hosted runners, Zeta job graph) | upstream `runs-on: omp-kata` never resolves in this repo; artifact names follow `zeta-cli-*` |
| v18.1.10 | `desktop/` | restored Zeta desktop CI references | merge-commit 50c5414846 dropped 4 desktop_linux references; desktop CI must survive every merge |

## Guard matrix

| Check | Command | Gate | CI job |
|---|---|---|---|
| Version line (packages, catalog, Cargo, natives sentinel, desktop, README badge) | `bun scripts/check-version-consistency.ts` | every push | `check` |
| Brand residue — token bans, MUST_CONTAIN pins, and product-policy gates | `bun scripts/brand/brand-check.ts` | every push | `check` |
| Zeta-only sentinels + AGENTS.md link | `bun scripts/check-zeta-sentinels.ts` | every push | `check` |
| CI release surface (job inventory + needs edges + artifact names — damage classes 7+10; registry `scripts/brand/ci-surface-registry.ts`) | `bun scripts/check-ci-surface.ts` | every push | `check` |
| Type check | `bun run ci:check:full` | every push | `check` |
| Rust format | `cargo fmt --all --check` | when `crates/` touched | `rust_validate` |
| **Upstream merge lineage** (tag-to-tag only) | `bun scripts/check-merge-lineage.ts --tag <tag>` | **before every upstream merge** | `sync/omp-release/*`, `port/*` |
| Native pipeline smoke | desktop smoke | release runs | `desktop_*` |

## The lineage gate — why it exists and how to use it

The rule this repo is built on is one sentence: **only the difference between two
upstream tags is ever merged; our own differences never enter the merge
computation.** Git enforces that automatically *provided the merge-base is
exactly the previously integrated upstream tag*. That precondition was prose
until `scripts/check-merge-lineage.ts` made it executable.

The failure it prevents is the most expensive in this repo's history: lineage
breakage (squash rewrite / force-push / skipped tag) degrades `merge-base` to a
remote ancestor, the theirs side inflates into a full catch-up window, and
v18.2.1→v18.2.4 produced 1300+ conflicts plus several rounds of CI damage. One
forgotten command was all that separated normal operation from that.

**Before merging any upstream tag, run it:**

```bash
git fetch omp-upstream --no-filter tag <tag>     # partial clone needs --no-filter
bun scripts/check-merge-lineage.ts --tag <tag>    # exit 1 = do not merge
```

It refuses the merge unless all of the following hold, and prints the size of
the tag-to-tag window you are about to merge so you see the *increment*, never a
whole-tree diff:

| Check | Refuses when |
|---|---|
| baseline recorded in `document/upstream-sync.md` | the ledger has no `**Baseline**: vX.Y.Z` entry — the written history and the machine gate would otherwise drift apart |
| baseline tag resolves | the baseline object was never fetched |
| baseline is an ancestor of HEAD | 谱系受损: squash, force-push, or a skipped tag |
| candidate is a release tag | a branch (`omp-upstream/main`) or raw SHA was passed |
| local tag matches remote's peeled SHA | a release tag was force-moved — escalate, never accept |
| `merge-base(HEAD, <tag>)` == baseline peeled SHA | our own diff is entering the merge computation |

Run it with no `--tag` to audit the standing lineage on any branch (CI does this
on every push, so damage is visible before someone attempts a merge).

A violation is **not** something to work around by passing a different baseline.
Repair the lineage, or escalate to the maintainer.

## Product-policy gates (non-brand invariants)

Some Zeta surfaces are not brand strings but deliberate policy decisions. They
look like ordinary upstream code, so a merge silently reverts them and nothing
in the brand registry objects. Each one is pinned in `brand-rules.ts`
(`MUST_CONTAIN` for the value, `MUST_NOT_CONTAIN` for the surface that must
never come back) so `brand-check` fails on the merge that breaks it.

| Policy | Canonical | Pinned by | Why a merge reverts it |
|---|---|---|---|
| OTLP telemetry export | hard-off (`TELEMETRY_EXPORT_ENABLED = false`, no setting exists) | MUST_CONTAIN ×2 + MUST_NOT_CONTAIN on the setting id | upstream ships the opt-in setting with `default: true`; a merge restores both the setting and the call site |
| OTLP `service.name` fallback | `zeta` | registry row in AGENTS.md | upstream literal is `oh-my-pi` |
| Tokio install export name | `omp_install_tokio_runtime` (**upstream name on purpose**) | MUST_CONTAIN | sweeping it to `__zeta*` made Tokio silently fail to install (v18.0.10) — the guard exists to stop a well-meaning sweep |
| External identity (OS/browser visible) | `dev.zeta.oauth-callback.*`, `Zeta OAuth Callback`, `zeta-auth`, `zeta-descriptor://`, `zeta-file-lock-`, `zeta.ida.*`, `zeta-plugins.lock.json`, `.zetacast` | MUST_CONTAIN ×7 + MUST_NOT_CONTAIN ×7 | these names are registered with the OS and read by our own peers; nothing in a source-only review notices, and the product silently reintroduces itself as `omp` at the platform level |

### Scanner scope rule

The 2026-10-10 sweep missed an entire tree (`sdk/`) because the inventory
script's root list was written by hand and `sdk/` was not in it; the brand guard
caught it instead. **Any future rename sweep must derive its scan roots from
`git ls-files`, never from a hand-maintained list**, and must finish with
`brand-check` at zero rather than by inspecting the diff.

### Producer/consumer rename rule

A partial rename is worse than none: it compiles, then fails at runtime. The
`bin: "omp"` fixture incident (2026-10-10) is the worked example — expected help
output was rewritten to `$ zetacode bench` while the `bin: "omp"` input that
produced it was not matched by any rule. When renaming a token that is both an
input and an expected output:

1. Search for the **bare** form too (`bin: "omp"`), not only command-position
   forms (`omp <cmd>`, `omp --`). Word-boundary rules anchored on a following
   character will not match a closing quote.
2. Re-run the affected tests immediately; do not batch renames across a whole
   tree and verify at the end.

Restoring a policy gate by hand after a merge breaks it:

1. `bun scripts/brand/brand-check.ts` — read the reported `rule` text. It names
   the file, the missing token, and the reason; that is the specification, not
   a suggestion.
2. Restore the pinned value at the reported file. Do not "fix" the guard to make
   it pass — if the policy itself is changing, that is a maintainer decision
   recorded in `document/upstream-sync.md`, with the guard row deleted in the
   same commit (registry rows are never removed as merge-conflict convenience).
3. If the merge also resurrected a deleted opt-in surface (the telemetry
   setting), delete it again: `git rm` the file, drop its import and
   registration from `config/all-settings.ts`, and drop its localized entry from
   `config/settings-zh.ts`. `MUST_NOT_CONTAIN` covers the resurrection; the
   dead wiring does not.
4. Re-run `bun run check:ts` plus the affected bucket, then `brand-check`.

## Sentinels maintenance rule

Any PR that deletes or renames a listed symbol must update
`scripts/brand/zeta-sentinels.ts` in the same PR. A review that finds a
Zeta-only surface not yet in the registry should add it in the same PR.
Deletion of registry rows is a red flag: registry rows are removed only when
the underlying Zeta surface is deliberately removed (e.g. Track B cutover),
never as a merge-conflict resolution convenience.
