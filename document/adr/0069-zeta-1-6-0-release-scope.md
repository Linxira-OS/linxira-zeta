# 0069. Zeta 1.6.0 targets OMP v18.22.2 and keeps Android on hold

- **Status:** Superseded
- **Date:** 2026-11-18
- **Deciders:** Zeta owner, explicit release preparation selection
- **Superseded by:** [ADR-0070](0070-zeta-1-6-0-stable-upstream-baseline.md)
- **Links:** [Release readiness](../release.md#160-public-release-readiness), [REQ-127 and REQ-136](../requirements-ledger.md), [ADR-0034](0034-owner-scope-holds-2026-11-12.md)

## Context

The owner selected OMP `v18.22.2` for Zeta `1.6.0` to include GPT‑6.2 Astra and Sol. The preceding `v18.22.0` source integration is the next step on the local merge path. Android native development and formal assets are held under ADR-0034. The previous public-release checklist required mobile delivery and physical-device acceptance.

## Decision

1. Finish the `v18.22.0` integration. Then integrate the official `v18.22.2` release as a complete two-parent merge. Verify catalog and routing for `gpt-6.2-astra` and `gpt-6.2-sol` on the resulting Zeta candidate.
2. Exclude mobile delivery and the mobile physical-device acceptance flow from `1.6.0`. Keep Android under the existing hold. Release acceptance includes pairing and 2FA on supported clients and SSH against a real target.
3. Use the existing versioned release scope to record included requirements, accepted contract decisions, and deferrals with their re-entry conditions. The owner's selection authorizes release preparation. Public release still requires approval for the exact version and the existing verification and publication gates.

## Consequences

The `v18.22.2` merge and model checks precede source freeze. Mobile resumes on an explicit owner decision under ADR-0034. Existing supported clients and platforms remain subject to their release checks.

## Alternatives

The owner declined releasing from `v18.22.0` with model support in a later update. The owner also declined keeping `1.6.0` queued behind mobile delivery.

## Links

- [OMP v18.22.2](https://github.com/Linxira-OS/linxira-zeta/releases/tag/v18.22.2)
- [OMP model catalog change](https://github.com/Linxira-OS/linxira-zeta/commit/2dedb850ac86e73aadc385e5b9cf08eac096e475)
- [Release scope manifest](../../release-scope.json)
