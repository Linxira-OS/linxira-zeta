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

**Last checked: 2026-11-22**

| Upstream | Tag / pin | Commit | Prior baseline | Status | Security-relevant fixes |
|---|---|---|---|---|---|
| [OMP](https://github.com/can1357/oh-my-pi) | `v18.22.0` | `3e8cff3b7ce19a805c11a26a6dd1703066435851` | `v18.20.0` (`c308970263ae13744ea15ab67302e3dac840e266`) | Integrated in `main`; **target v19.0.0 is held** on `sync/omp-release/v19.0.0` (`579992ddd2e`) and PR #325 is `CONFLICTING` (30-file conflict audit). Latest observed release: `v19.1.0` (2026-11-21); not fetched or merged. | The intervening upstream releases report private-host trailing-dot approval handling and session-deletion ordering fixes. Zeta-specific security acceptance remains open. |
| [TermIDE](https://github.com/termide/termide) | `0.49.0` (annotated `4cc014fb…`, released 2026-11-05) | `057eb55e0a7c4ee969982fab62dc83bde028e052` | `0.46.0` (`a027ca78…`) | Vendored under `termide/`; latest observed tag `0.50.0` is not integrated (separate sync branch required). Per-deviation replay in `termide/VENDOR.md`. | 0.47.1: zip 9.0.0-9.0.4 local/central header mismatch -> path traversal, now `zip 9.1.3`. 0.49.0: `russh 0.65.0` past the 0.64 SSH/SFTP advisories; retain the recorded acceptance. |
| [OMP Studio](https://github.com/the-snowpear/omp-studio) | `v0.2.4` (`64170f9a…`) | `64170f9a5791b4711a0385129254fd26dea38772` | `v0.2.1` (`6d0b764bb9e…`) | Integrated through the Zeta Host adapter with 978 accepted sync decisions. Latest observed releases: `v0.2.5`–`v0.2.8` (2026-11-21); `v0.2.7`/`v0.2.8` require OMP `19.0.1`, so they are held with the v19 baseline. Delta inventory: [`studio-v0.2.8-delta.md`](./agents/merge/studio-v0.2.8-delta.md). | None independently verified for the newer releases in this inspection. |
| OMP Web ([`17380936778/omp-web`](https://github.com/17380936778/omp-web)) | frozen snapshot `c71edcb2…` | `c71edcb2…` (absorbed `f09920e`) | `c71edcb2…` | `web-ui/` is frozen; no merge source. Upstream dead since 2026-08-04; manual cherry-picks only, as recorded in `document/upstream-sync.md`. | None verified. |
| Pi / Pi Web (pi-mono) | see `document/upstream-sync.md` | see `document/upstream-sync.md` | — | No verified tag pin is recorded in local docs for this check; semantic ports are `port/pi/<scope>` / `port/pi-web/<scope>`, not a vendored tree. | See `document/upstream-sync.md`. |

**Notes**

- TermIDE's leaf binaries must carry the vendor tag in their stamp
  (`termide 0.49.0 (…)`); a binary built from an older target fails that check.
- The baseline rows give exact source pins and integration status. Observing a newer release does not authorize or perform a sync. The 2026-11-17 release bodies and capped comparison responses remain in `local://upstream-release-inspection-20261117.json`.
- Owner steering after this inspection: keep Studio at the integrated `v0.2.1` baseline; do not schedule `v0.2.2` as an automatic step after OMP. Assess OMP's concrete lifecycle and capability changes individually; an integration still requires an explicitly named release tag. Existing Zeta Host producer and acceptance debt is retained.
