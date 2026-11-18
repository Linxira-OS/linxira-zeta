# 0072. Restore normal public releases

- **Status:** Accepted
- **Date:** 2026-11-18
- **Deciders:** Zeta owner
- **Supersedes:** The ongoing freeze in [ADR-0006](0006-release-freeze-internal-line.md) and the one-off override in [ADR-0071](0071-zeta-1-5-10-public-release.md)
- **Links:** [Release procedure](../release.md#1510-public-release-readiness), [Requirements ledger](../requirements-ledger.md)

## Context

The owner directed that development, Actions and releases resume normally, beginning with Zeta `1.5.10` from OMP `v18.22.0`.

## Decision

Stable versions at and above `1.5.10` use the normal public release path without a freeze override. Ordinary pushes validate source; a release tag on the approved version bump triggers publication. Keep the existing source CI, release scope, artifact and npm trusted publishing checks. Older tags keep their historical treatment, including the `1.5.2` assets-only exception.

The `1.5.10` scope in ADR-0071 still applies: ship the board and calendar tools, without their new pages or integration work. No `1.6.0` tag is requested.

## Consequences

There is no extra approval variable to set or clear for each normal release. Publication still requires the standard gates and must include the supported npm packages, native leaves and GitHub assets.

## Alternatives

A one-version exception would release this version but retain the internal freeze for future work. The owner superseded that approach.

## Links

- [Release policy](../../scripts/release-policy.ts)
- [Release policy tests](../../scripts/release-freeze.test.ts)
