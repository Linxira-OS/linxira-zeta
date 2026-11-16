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

**Last checked: 2026-11-16**

| Upstream | Tag / pin | Commit | Prior baseline | Status | Security-relevant fixes |
|---|---|---|---|---|---|
| [OMP](https://github.com/can1357/oh-my-pi) | `v18.20.0` | `c308970263ae13744ea15ab67302e3dac840e266` | `v18.19.0` (`04cd1a7549d`) | Integrated into `sync/studio-release/v0.2.0` as a real merge (`c74a5ea4612` + follow-ups `36b1dfff4d4`, `6a762ba05af`); `git merge-base --is-ancestor v18.20.0 HEAD` passed. Latest upstream tag observed 2026-11-16: `v18.20.3`; not integrated. | Follow the v18.20.0 release notes; no separate security claim recorded here. |
| [TermIDE](https://github.com/termide/termide) | `0.49.0` (annotated `4cc014fb…`, released 2026-11-05) | `057eb55e0a7c4ee969982fab62dc83bde028e052` | `0.46.0` (`a027ca78…`) | Vendored under `termide/` by this sync (`vendor/termide-0.49.0`); per-deviation replay in `termide/VENDOR.md`. | 0.47.1: zip 9.0.0–9.0.4 local/central header mismatch → path traversal, now `zip 9.1.3`. 0.49.0: `russh 0.65.0` past the 0.64 SSH/SFTP advisories (agent signing without confirmation, crafted `EXT_INFO`/`CONSTRAIN_CONFIRM` allocations, zero max-packet channel stall, Pageant frame buffering); agent commands judged in the real shell's syntax and look-only bypasses closed (`${ cmd; }`, `test -v` subscripts, quoted `find -del''ete`); variable values no longer run as code unasked. 0.47.0: SFTP `known_hosts` verification + `ssh_config`/`ProxyJump`; archive extraction keeps symlinks inside the destination; control characters in shell names escaped. |
| [OMP Studio](https://github.com/the-snowpear/omp-studio) | `v0.2.1` (`6d0b764b…`) | `6d0b764bb9eac88c1671c0380229823c5630cc74` | `v0.1.17` (`4e2cdc77…`) | `v0.2.1` is the latest upstream tag (probe 2026-11-16) and the current integration target; the tree still contains the `v0.1.17` port plus Zeta changes, and no official source-parent merge exists yet. Renderer fork lives in `web-app/`; accounting in `temp/studio-review-main-20261116-verified/report.json`. | None verified. |
| OMP Web ([`17380936778/omp-web`](https://github.com/17380936778/omp-web)) | frozen snapshot `c71edcb2…` | `c71edcb2…` (absorbed `f09920e`) | `c71edcb2…` | `web-ui/` is frozen; no merge source. Upstream dead since 2026-08-04; manual cherry-picks only, as recorded in `document/upstream-sync.md`. | None verified. |
| Pi / Pi Web (pi-mono) | see `document/upstream-sync.md` | see `document/upstream-sync.md` | — | No verified tag pin is recorded in local docs for this check; semantic ports are `port/pi/<scope>` / `port/pi-web/<scope>`, not a vendored tree. | See `document/upstream-sync.md`. |

**Notes**

- TermIDE's leaf binaries must carry the vendor tag in their stamp
  (`termide 0.49.0 (…)`); a binary built from an older target fails that check.
- The OMP row names the tag the integration branch actually contains; it does not claim `main` has received the integration branch.
