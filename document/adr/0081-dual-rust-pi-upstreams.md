# 0081. Aggregate two Rust Pi reference upstreams; do not fork either one

- **Status:** Proposed (deferred 2026-11-21; no code import)
- **Date:** 2026-11-21
- **Deciders:** Zeta owner
- **Links:** [bigfish1913/pi-rust](https://github.com/bigfish1913/pi-rust), [yannelli/pi-rust](https://github.com/yannelli/pi-rust), [ADR-0080](0080-repository-path-governance.md), [Requirements ledger](../requirements-ledger.md)

## Context

Zeta's Rust runtime direction has two independent Rust ports of Pi. They are
different implementations with complementary strengths, not two branches of one
project. The owner's 2026-11-21 survey (approximate size, not a CI measurement)
recorded the following.

| Layer | `bigfish1913/pi-rust` | `yannelli/pi-rust` | Current read |
| --- | --- | --- | --- |
| Agent loop | ✅ `rpi-agent`, ~14k (strongest) | ✅ `pi-agent`, ~6.7k (usable, needs an outer wrapper) | Bigfish is the better loop base. |
| Provider layer | ✅ `rpi-ai`, ~23k | ✅ `pi-ai`, ~57k (more than double) | Yannelli has the broader provider surface. |
| Session persistence | ✅ `rpi-durable`, ~6.7k | ✅ `pi-durable`, ~95k | Yannelli is far deeper; Bigfish is thinner. |
| TypeScript plugin host | ❌ structurally absent; cdylib C ABI, never supported | ✅ `pi-js`, ~28k (QuickJS; unique) | Only Yannelli can host TS plugins this way. |
| Rust MCP client | ❌ absent | ✅ `pi-mcp`, ~19k | Yannelli provides a Rust MCP path. |
| RPC protocol stack | ⚠️ only an in-product JSON mode | ✅ `pi-protocol` + schema + client + server | Yannelli is the WebUI bus reference. |
| Benchmarks / evals | ❌ essentially absent | ✅ `pi-evals`, ~4k | Yannelli has an evaluation base. |
| Engineering maturity | ✅ visibly higher | ⚠️ younger, thin documentation | Bigfish is the maturity anchor. |

Both repositories are MIT-licensed and active. No source tree from either
project is tracked in Zeta today. The ignored reference copy under
`temp/pi-rust-main/` is investigation material only; `main/` is reserved for a
future import and is not populated now.

The owner's position is that Zeta will **not** present itself as maintaining
either upstream. The planned work is a **new aggregated upstream** assembled
from both reference sources, with explicit component provenance. Both projects
are candidates for migration; this ADR only records that direction and defers
the migration.

## Decision

1. **Both projects are reference upstreams.** Zeta may consume both
   `bigfish1913/pi-rust` and `yannelli/pi-rust` as named, verified tag sources.
   It does not claim to maintain, rebrand, or silently replace either project.
2. **No single-repository merge.** When the migration resumes, Zeta builds a
   new aggregated Rust runtime under the future `main/` path. It must not be a
   straight fork of either repository, and must not merge either repository's
   branch history into Zeta.
3. **Component-level provenance.** Every imported or adapted component records
   its source repository, source tag, source commit, license, and Zeta changes.
   Upstream MIT notices and a Zeta maintenance notice travel with each
   component.
4. **Tag-to-tag sync per source.** Each reference source is synced only by an
   explicitly named release tag, with live tag verification and a tag-to-tag
   diff. There is no automatic “latest” sync and no branch merge/cherry-pick.
5. **Defers now.** No Rust Pi source, npm package, binary, or release asset is
   added by this ADR. Rust Pi is not in `main/`, not in the active npm release,
   and not in the 1.5.13 scope.
6. **`main/` stays reserved.** The retired Zetawork tree is in
   `retired/zetawork/`; `web-ui/` is in `retired/web-ui/`. An aggregated Rust
   runtime may later occupy `main/`, but only after a new import decision and
   the license/provenance review below.

### Evidence status

Observed live tags on 2026-11-21:

- `bigfish1913/pi-rust`: latest stable candidate `v0.27.0`; the local reference
  copy is `0.26.1`, so any later import must not start from `0.26.1`.
- `yannelli/pi-rust`: latest observed tag `v0.12.21`; its release/tag status and
  intended stable baseline still require explicit verification before import.

The sizes in the table are the owner's survey figures, not independently
measured by this repository. Re-measure and record exact file/line counts
before choosing a component.

## Consequences

- Zeta gets one place to compare both Rust ports and can take the stronger
  component from each instead of inheriting one project's gaps.
- The runtime will have a mixed provenance and a larger license/attribution
  surface than a single fork. Per-component notices and an SBOM-style map are
  mandatory.
- Two tag-sync mechanisms and two upstream review queues will exist when work
  resumes. They must share the same ownership/asset-overlay policy as Studio
  and OMP.
- No release or npm surface changes now. 1.5.13 remains independent of this
  ADR.

## Alternatives

- **Fork only `bigfish1913/pi-rust`.** Rejected as the sole source: its durable
  session layer, TS plugin host, MCP client, RPC stack and evals are absent or
  thin.
- **Fork only `yannelli/pi-rust`.** Rejected as the sole source: its agent loop
  is thinner and its maturity/documentation are weaker.
- **Maintain both upstream projects under Zeta.** Rejected: Zeta would inherit
  two maintenance queues and two identities instead of owning one aggregated
  runtime.
- **Do nothing.** Valid for now and is the current deferred state; it leaves
  the Rust runtime direction unresolved.

## Open points

- The exact component ownership map: which layer comes from which source, and
  which parts remain Zeta-owned.
- npm identity and version mapping for the future aggregated runtime
  (`@linxiraos/main` vs a new package name).
- Whether the QuickJS plugin host is adopted as the primary TS host or as a
  separate runtime profile.
- The per-component MIT/NOTICE layout and the future import gate.

## Links

- [bigfish1913/pi-rust](https://github.com/bigfish1913/pi-rust)
- [yannelli/pi-rust](https://github.com/yannelli/pi-rust)
- [ADR-0080 repository layout](0080-repository-path-governance.md)
- [Rust Pi reference copy](../../temp/pi-rust-main) (ignored; not tracked)
