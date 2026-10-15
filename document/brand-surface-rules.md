# Brand Surface Decision Rules

The classification every rename must land in **before** an edit is made. It
exists because a bulk sweep that skips this step will eventually override a
decision somebody already made deliberately — which is exactly what happened on
2026-10-10 with the plugin lockfile (see "Overturned" below).

**Rule 0 — read this file before sweeping.** A token with an existing decision
recorded here, or a doc comment in the owning file saying "never rebrand" /
"stays upstream-compatible", is not a candidate. Find the owner first:

```bash
git grep -n "<token>" -- packages | grep -i "compat\|never rebrand\|upstream-compatible\|do not\|keep"
```

## The names — do not swap them

Zeta has a small, fixed set of names. They were separated on purpose
(2026-10-09; the command set was closed on 2026-10-15) and mixing them is a
defect, not a style preference. Three commands are user-visible — `zetawork`,
`zetacode`, `zetaide` — and hyphenated compatibility bins no longer exist in
any package:

| Name | Identity | Used for |
|---|---|---|
| **`zeta`** | product / app | config root `.zeta/`, log file names, UA product token `zeta/<v>`, splash, attribution headers, process-global product identity, homepage; as a bin, a bare `zeta` prints the suite index (help) |
| **`zetawork`** | workbench CLI | `@linxiraos/main`, bin `zetawork` (opens the workspace; `zetawork web` serves the Web UI) |
| **`zetacode`** | coding-agent CLI | `@linxiraos/zeta`, bin `zetacode` (no aliases), every "run this command" string, `--help` usage, process titles |
| **`zetaide`** | terminal IDE | `@linxiraos/ide`, bin `zetaide` (no aliases) |

The editor is no longer a command: `@linxiraos/editor` ships the vendored TTT
binary only, resolved by path (workbench/plugin surface). Release-asset **file
names** (`zeta-cli-*`, `zeta-work-*`, `zeta-ide-*`, `zeta-editor-*`) are
untouched by this registry.

The deciding question is *"is the user being told to run something, or is the
product naming itself?"* Command → the canonical bin (`zetawork` / `zetacode` /
`zetaide`). Identity → `zeta`.

A config path or UA token spelled `zetacode` points at a directory no install
creates; a command spelled `zeta` prints the suite index instead of running the
agent. Both are guarded mechanically (`brand-rules.ts` MUST_NOT_CONTAIN on
`.zetacode`, `XDG_*/zetacode`, `` USER_AGENT = `zetacode/ ``).

`CLI_BIN_NAME` and `APP_NAME` in `packages/utils/src/dirs.ts` are the two
constants that own this split; a merge that confuses them fails the guard.

## The three verdicts

| Verdict | Meaning | Action |
|---|---|---|
| **SUBSTITUTE** | Ours, no external contract, no persisted state | Replace with the canonical Zeta name; pin with `MUST_CONTAIN` |
| **COMPAT** | An existing install, a third party, or upstream's own tooling depends on the exact spelling | Leave the spelling; do not guard it as brand residue |
| **OVERTURN** | A recorded decision is now wrong on the merits | Change it **and** update the old decision's own text in the same commit, so the next sweep cannot re-derive it |

COMPAT and SUBSTITUTE are not a judgement call about taste: the test is
whether a persisted artifact, a user setting, a published package, or a third
party's registry carries the string.

## Recorded decisions

### SUBSTITUTE — replaced on 2026-10-10, merge-pinned

| Surface | Canonical | Guard | Why substitution is safe |
|---|---|---|---|
| macOS OAuth bundle id / app name | `dev.zeta.oauth-callback.*` / `Zeta OAuth Callback` | MUST_CONTAIN | Pure registration name; nothing reads it but us |
| Windows HKCU transaction name | `Zeta OAuth Callback Transaction` | MUST_CONTAIN | Same |
| Linux desktop entry / scheme | `dev.zeta.oauth-callback.*` / `zeta-auth` | — | Same |
| fd-passing URL scheme | `zeta-descriptor://` | MUST_CONTAIN | Both ends in this repo |
| advisory lock prefix | `zeta-file-lock-` | MUST_NOT_CONTAIN | Temp file, recreated per run |
| XDG state dir | `zeta` | — | Runtime state, regenerated |
| IDA daemon name | `zeta.ida.*` | MUST_CONTAIN | Display-only, ours |
| session-recording extension/header | `.zetacast` / `zetacast` | MUST_CONTAIN | Read-old shim keeps pre-rename files playable (see "Deliberate additions") |
| process titles | `zetacode lsp mux` | — | Display-only |
| AWS STS `RoleSessionName` | `zeta-<pid>` | — | Cosmetic label in CloudTrail |
| User-Agent / relay creator | `zeta-web`, `zeta-browser` | — | Ours |
| TUI semantic roles | `zeta.*` | — | Internal style keys |
| CLI invocation in prose/help | `zetacode <cmd>` | MUST_NOT_CONTAIN | There is no `omp` binary in this product |
| SDK paths & package names | `sdk/*/zeta-rpc`, `zeta_rpc`, `zetarpc` | — | Never published; 0.1.0 pre-1.0 |
| dev wrapper + linker | `scripts/zetacode`, `scripts/link-zetacode.sh` | — | Dev-only |

### COMPAT — do not touch, do not guard as residue

| Surface | Protects | Owner |
|---|---|---|
| Reading upstream npm release manifests (`omp.rename`, `omp.dist`) | Consuming the upstream ecosystem | `cli/update-cli.ts` |
| Reading upstream plugin packages (`pkg.zeta \|\| pkg.omp \|\| pkg.pi`) | Consuming the upstream ecosystem | `plugins/manager.ts` |
| `.omp-plugin` manifest dir | OMP/Claude compatibility | AGENTS registry |
| `my.omp.sh`（中继/分享） | Wire-grammar 常量与 collab-web 部署引用；**不再是任何默认端点**（`collab.enabled` 默认关、`collab.relayUrl` 默认空，见 §Collab gate） | AGENTS registry + `document/upstream-commercial-assets.md` |
| `live.omp.sh`, `skills.omp.sh`, `catalog.stencil.so`, `omp.sh/docs/...` … | Ledger-tracked upstream services (keep / replace per entry) | 台账 + `scripts/check-shared-infra.ts`（`replace-*`）。**品牌 sweep 不再豁免主机名**（2026-10-14 收窄）；`qa.omp.sh`、`scl.so`、`build.stencil.so`、`omp.sh/install` 已替换/移除，复活即红 |
| `__omp_*` cross-process symbols | Inter-process protocol between our own components | AGENTS damage class 9/11 |
| `omp/muxConnect`-style handshakes | Single in-repo constant (`MUX_CONNECT_METHOD`) — renaming both ends together is safe; a hand-rolled string on one side is not | `lsp/mux/protocol.ts` |
| `OMP_NUM_THREADS`, `OMP_THREAD_LIMIT`, `OMP_PCRE2_JIT`, `OMP_MINIMIZER_LEGACY_FILTERS` | GNU toolchain contract — external tools read them | `pi-builtins/nproc.rs`, `grep.rs` |
| `omp` as the Stencil OAuth client id | Registered client id at a third-party issuer; changing it breaks auth | `catalog/.../stencil.kdl` |
| `OMP_*` (174 vars) | Documented user configuration in `docs/environment-variables.md` | AGENTS registry |
| `python/robomp` | OMP-native upstream bot | `SKIP_PREFIXES` |
| `~/.omp/agent` read-only probe | Migration from OMP installs: `models.yml` + plaintext keys in `agent.db`. Never written. | `config/omp-compat.ts` |
| `omp_install_tokio_runtime` | Tokio install export; renaming made Tokio silently not install (v18.0.10) | AGENTS registry |

### DUAL — read both, write Zeta only

The plugin ecosystem needs a stable Zeta identity to grow around **now**, not
after we have diverged far enough to justify it. So these are not "never
change": they accept the upstream spelling forever and write only ours.

| Surface | Read | Write | Bridge |
|---|---|---|---|
| discovery provider id | `omp-plugins` and `zeta-plugins` | `zeta-plugins` | `canonicalProviderId()` in `capability/index.ts` normalizes at every read of a provider id (`isProviderEnabled`, `enableProvider`, `getDisabledProviders`) |
| plugin lockfile | `omp-plugins.lock.json`, `zeta-plugins.lock.json` | `zeta-plugins.lock.json` | read-old/write-new with first-run migration |

Reading upstream plugins is COMPAT and stays. **Publishing** ours under our own
name is SUBSTITUTE and happens immediately. The two are not in tension: one is
about consuming their ecosystem, the other about not being invisible inside our
own.

### OVERTURN — old decision reversed on 2026-10-10

| Surface | Old decision | New decision | Why |
|---|---|---|---|
| OTLP telemetry opt-in | Setting `telemetry.otlpExportEnabled`, **default `true`** | **Removed**; hard-off constant, no opt-in surface at all | We operate no collector, so there is nowhere for events to be processed. "Default off" would still leave a switch; the requirement is that export cannot be turned on. |

## Deliberate additions (not pure substitution)

Two places add behaviour rather than rename a token. Both are called out here
so a later reviewer does not "simplify" them away:

1. **Recording read-old shim** (`stream/recording.ts`): accepts the pre-rename
   `ompcast` header key and `.ompcast` extension, normalizes to the canonical
   field. Without it, an in-place upgrade orphans every recording the user has
   ever made — a silent data loss, not a cosmetic change. Pinned by
   `test/stream/recording-compat.test.ts`.
2. **`brand-check` `exempt` list**: lets a rule tolerate a specific file when the
   hit is a documented compat site rather than brand residue. Used for the
   recording shim, the Stencil client id, and released `CHANGELOG.md` entries.

If a future change needs a third addition, it needs a row here first.

## Data-affecting renames (require a migration note in the CHANGELOG)

These are SUBSTITUTE, but they change what a user finds on disk or in a store:

- Redis session key prefix `omp:sessions:` -> `zeta:sessions:`
- SQL session table `omp_session_files` -> `zeta_session_files`

Both are configurable defaults. A user who pinned the old value keeps working; a
user on the default must rename their existing keys/table.

## Guard rules for this file

- Adding a token to **COMPAT** requires a one-line `why` naming what breaks.
- Moving a token between verdicts requires editing the owning file's own
  doc comment in the same commit — a stale comment is how the lockfile incident
  happened.
- Every SUBSTITUTE row must have a corresponding `MUST_CONTAIN` or
  `MUST_NOT_CONTAIN` entry, so a merge that restores the upstream spelling fails
  `brand-check` instead of silently reintroducing it.