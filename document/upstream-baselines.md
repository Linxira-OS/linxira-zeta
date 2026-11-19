# Upstream baselines

One row per upstream we track or vendor, pinned to an exact release tag (never a
branch head, and never a tag another owner shares). This is the short index; the
long audits stay in [`upstream-sync.md`](./upstream-sync.md) and
`termide/VENDOR.md`.

**Policy**

- Tags only: a sync or vendor bump names the upstream's own release tag and its
  dereferenced commit; branch heads and unowned tags are not merge sources.
- One upstream per row; a row with two products is split before it can be synced.
- "Status" says what the tree actually contains now, not what was planned.
- Security-relevant fixes must be named here and in the owning ledger.

**Last checked: 2026-11-18**

| Upstream | Tag / pin | Commit | Prior baseline | Status | Security-relevant fixes |
|---|---|---|---|---|---|
| [OMP](https://github.com/Linxira-OS/linxira-zeta) | `v18.22.0` | `3e8cff3b7ce19a805c11a26a6dd1703066435851` | `v18.20.0` (`c308970263ae13744ea15ab67302e3dac840e266`) | Merged into `main` as `f0446a56f09` (PR #324); main push CI `44486728118` green. For the full record see [`upstream-sync.md`](./upstream-sync.md#v18220-source-integration-2026-11-18). | The intervening upstream releases report private-host trailing-dot approval handling and session-deletion ordering fixes. Zeta-specific security acceptance for these changes remains open. |
| [TermIDE](https://github.com/termide/termide) | `0.49.0` (annotated `4cc014fb…`, released 2026-11-05) | `057eb55e0a7c4ee969982fab62dc83bde028e052` | `0.46.0` (`a027ca78…`) | Vendored under `termide/` by this sync (`vendor/termide-0.49.0`); per-deviation replay in `termide/VENDOR.md`. | 0.47.1: zip 9.0.0–9.0.4 local/central header mismatch → path traversal, now `zip 9.1.3`. 0.49.0: `russh 0.65.0` past the 0.64 SSH/SFTP advisories (agent signing without confirmation, crafted `EXT_INFO`/`CONSTRAIN_CONFIRM` allocations, zero max-packet channel stall, Pageant frame buffering); agent commands judged in the real shell's syntax and look-only bypasses closed (`${ cmd; }`, `test -v` subscripts, quoted `find -del''ete`); variable values no longer run as code unasked. 0.47.0: SFTP `known_hosts` verification + `ssh_config`/`ProxyJump`; archive extraction keeps symlinks inside the destination; control characters in shell names escaped. |
| [OMP Studio](https://github.com/the-snowpear/omp-studio) | `v0.2.1` (`6d0b764b…`) | `6d0b764bb9eac88c1671c0380229823c5630cc74` | `v0.1.17` (`4e2cdc77…`) | Official source-parent merge `31f598f8a2e71f42c148d866eb530e596c056a32` and the Zeta Host/renderer adaptations are now on main. Latest stable release observed 2026-11-17: [`v0.2.2`](https://github.com/the-snowpear/omp-studio/releases/tag/v0.2.2), annotated tag object `ec8e60c6e8dde7cd4923023cb637e21e063f0f99`, dereferenced commit `abfb3d4796caf31ad12c4cad0c2b11f8e62e8816`, published 2026-11-16T14:55:15Z; not integrated. Comparison reports 62 commits; its 300-file list is capped. Full behavior/native/SSH/CI acceptance of the existing baseline remains open. | None independently verified in this inspection. |
| OMP Web ([`17380936778/omp-web`](https://github.com/17380936778/omp-web)) | frozen snapshot `c71edcb2…` | `c71edcb2…` (absorbed `f09920e`) | `c71edcb2…` | `web-ui/` is frozen; no merge source. Upstream dead since 2026-08-04; manual cherry-picks only, as recorded in `document/upstream-sync.md`. | None verified. |
| Pi / Pi Web (pi-mono) | see `document/upstream-sync.md` | see `document/upstream-sync.md` | — | No verified tag pin is recorded in local docs for this check; semantic ports are `port/pi/<scope>` / `port/pi-web/<scope>`, not a vendored tree. | See `document/upstream-sync.md`. |

**Notes**

- TermIDE's leaf binaries must carry the vendor tag in their stamp
  (`termide 0.49.0 (…)`); a binary built from an older target fails that check.
- The baseline rows give exact source pins and integration status. Observing a newer release does not authorize or perform a sync. The 2026-11-17 release bodies and capped comparison responses remain in `local://upstream-release-inspection-20261117.json`.
- Owner steering after this inspection: keep Studio at the integrated `v0.2.1` baseline; do not schedule `v0.2.2` as an automatic step after OMP. Assess OMP's concrete lifecycle and capability changes individually; an integration still requires an explicitly named release tag. Existing Zeta Host producer and acceptance debt is retained.
