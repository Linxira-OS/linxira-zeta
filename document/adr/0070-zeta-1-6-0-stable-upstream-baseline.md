# 0070. Release Zeta 1.6.0 from OMP v18.22.0

- **Status:** Superseded
- **Date:** 2026-11-18
- **Deciders:** Zeta owner, latest release direction
- **Supersedes:** [ADR-0069](0069-zeta-1-6-0-release-scope.md)
- **Superseded by:** [ADR-0071](0071-zeta-1-5-10-public-release.md)
- **Links:** [Release readiness](../release.md#160-public-release-readiness), [Requirements ledger](../requirements-ledger.md), [ADR-0034](0034-owner-scope-holds-2026-11-12.md)

## Context

The owner asked to ship a stable release from the current OMP `v18.22.0` candidate and check its support for the new OpenAI model IDs. The official `v18.22.0` bundled catalog predates the GPT‑6.2 Astra and Sol entries.

## Decision

Use the verified complete official OMP `v18.22.0` merge as the Zeta `1.6.0` source baseline. Report the verified support level for Astra and Sol. Schedule full `v18.22.2` integration after this release.

Keep Android native development and formal assets held under ADR-0034. Mobile delivery and its physical-device acceptance flow are outside `1.6.0`. Pairing and 2FA on supported clients, real-target SSH, and all standard acceptance and publication gates apply.

## Consequences

Release notes identify the source tag and claim only verified model support. The versioned release scope records the included requirements and approved deferrals. The release workflow requires green CI for the selected source commit and the exact-version owner approval.

## Alternatives

The earlier `v18.22.2` baseline adds a second complete merge and gate cycle ahead of the first stable release. The owner moved that cycle after `1.6.0`.

## Links

- [OMP v18.22.0](https://github.com/can1357/oh-my-pi/releases/tag/v18.22.0)
- [OMP GPT‑6.2 catalog change](https://github.com/can1357/oh-my-pi/commit/2dedb850ac86e73aadc385e5b9cf08eac096e475)
