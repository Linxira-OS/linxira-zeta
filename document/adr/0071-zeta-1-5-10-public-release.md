# 0071. Publish Zeta 1.5.10 from OMP v18.22.0

- **Status:** Superseded
- **Date:** 2026-11-18
- **Deciders:** Zeta owner
- **Supersedes:** [ADR-0070](0070-zeta-1-6-0-stable-upstream-baseline.md); the [ADR-0006](0006-release-freeze-internal-line.md) rule for exact `1.5.10` only
- **Superseded by:** [ADR-0072](0072-restore-normal-public-releases.md)
- **Links:** [Release readiness](../release.md#1510-public-release-readiness), [Requirements ledger](../requirements-ledger.md)

## Context

The owner chose `v1.5.10` instead of `v1.6.0` and requested a complete public release of the OMP `v18.22.0` integration. The project board and calendar tools exist; their Work Studio pages are not ready.

## Decision

Exact `1.5.10` uses the public release path with a matching stable version and non-empty owner audit reason. Keep the existing scope, source CI, artifact, and OIDC checks. Publish the supported GitHub assets and npm package set, then verify discovery and installation from npm `1.5.1`. The `1.5.2` assets-only exception and the remaining frozen versions are unchanged.

Keep `board` and `calendar` in the release scope as tools. Separate Work Studio pages, user editing in those pages, and external calendar imports including Outlook are outside this release. Android stays held; supported-client pairing, 2FA and real-target SSH remain in scope. No `v1.6.0` tag is requested.

## Consequences

The release is cut only from the verified `v18.22.0` merge. A code-only tag or assets-only release does not satisfy this decision. The page work can be scheduled without delaying the existing tool release.

## Alternatives

The owner declined `v1.6.0` for this release and asked not to delay shipment for the missing pages.

## Links

- [Release policy and tests](../../scripts/release-policy.ts), [freeze tests](../../scripts/release-freeze.test.ts)
- [Project board](../../docs/tools/board.md), [calendar](../../docs/tools/calendar.md)
