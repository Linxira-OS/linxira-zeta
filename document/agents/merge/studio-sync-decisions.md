# Studio v0.2.4 sync decisions

Evidence for `bun scripts/studio-gate.ts --profile final`:

- `studio-v0.2.4-sync-report.json` — official tag `v0.2.4`
  (`64170f9a…`), baseline `v0.2.1`, generated online.
- `studio-v0.2.4-sync-decisions.json` — one decision for every unresolved
  row. Local renderer/contract rows land on their mapped Zeta file and its
  current SHA-256. Upstream-only desktop, host, repository, CI, and documentation
  rows land on ADR-0083 because Zeta owns those boundaries and does not vendor
  the upstream shell or repository front door.

The uniform decision classes are:

| Status | Decision |
|---|---|
| conflict / contract-review / adapted-addition / ready-merge | Zeta local adaptation, reviewed against ADR-0083 |
| host-adaptation | upstream desktop/host file intentionally not vendored; Zeta desktop + studio-host own it |
| repository-review | upstream repository/CI/docs file intentionally not vendored |
| configuration-review | Zeta owns package/build configuration |
| missing-review | upstream test absent locally; behavior covered by Zeta suite or intentionally not vendored |

Regenerate after any further Studio source change: run `studio-sync` online,
then recreate decisions with current local hashes, then run
`check-studio-sync --require-complete --require-ancestry`.
