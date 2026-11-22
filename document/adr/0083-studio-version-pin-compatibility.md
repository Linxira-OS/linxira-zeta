# 0083. Studio v0.2.4 compatibility is a Zeta Host adapter, not an OMP downgrade

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Zeta owner
- **Links:** [Studio v0.2.4](https://github.com/the-snowpear/omp-studio/releases/tag/v0.2.4), [OMP v18.22.0](https://github.com/can1357/oh-my-pi), [upstream baselines](../upstream-baselines.md), [ADR-0051](0051-studio-project-services.md)

## Context

Studio v0.2.4 is built against **OMP `18.20.2-studio.14`**. Zeta's current
runtime baseline is **OMP `18.22.0`**. The two versions are close, but Studio
also carries a Host-side `omp-patch/overlay` for the older runtime and a
renderer/shared-package contract set. Zeta already maintains an adapted Studio
Host from the v0.2.1 integration.

The owner reports that opening Zeta and using the Studio surface does not
work correctly today. The upstream author's version pin is part of the
compatibility problem: copying the v0.2.4 renderer alone is not enough, and
replacing Zeta's OMP 18.22.0 runtime with 18.20.2 would regress the product.

## Decision

1. **Keep OMP `18.22.0` as the runtime baseline.** Studio v0.2.4 runs against
   it through an explicit Zeta compatibility adapter.
2. **Separate renderer and Host ownership.** The renderer/contracts are
   upstream v0.2.4 semantics with Zeta naming and local product extensions.
   The Host adapter lives in `packages/coding-agent/src/server/studio-host/`
   and exposes only operations Zeta can actually serve.
3. **Port the v0.2.4 `omp-patch/overlay` semantically, not by copy.** The
   overlay targets OMP 18.20.2. New producers must be mapped onto Zeta's
   existing session, service, browser, computer, Team and model authorities.
   A copied overlay file that creates a second authority is rejected.
4. **Version-gate new fields and operations.** A renderer field or query that
   OMP 18.22.0 cannot provide gets either a Zeta adapter or an explicit
   unsupported result; it must not be silently undefined.
5. **Release gate.** Studio v0.2.4 must pass the Studio quick/behavior/final
   gates and the Zeta compatibility checks before it can be part of a 1.5.13
   release. Renderer typecheck alone is not acceptance.

## Consequences

- Studio can be upgraded on Zeta's runtime without downgrading OMP.
- The compatibility surface is visible and testable: operation manifests,
  unsupported results, and version-pinned adapter tests.
- Studio sync is slower than a copy because the 195 Host overlay files need
  semantic review.
- If an upstream Studio feature depends on an OMP 18.20.2-only producer that
  Zeta does not have, it stays unavailable until a Zeta producer exists.

## Alternatives

- **Downgrade Zeta to OMP 18.20.2.** Rejected: it discards Zeta's 18.22.0
  runtime work and moves the whole product backwards for one UI.
- **Copy the v0.2.4 overlay wholesale.** Rejected: it would introduce a second
  Host authority and duplicate session/service/credential handling.
- **Ship the renderer without Host adaptation.** Rejected: it produces a UI
  that opens but cannot execute the operations it advertises, which is the
  current broken state.
- **Keep Studio at v0.2.1 indefinitely.** Rejected: it blocks the requested
  Studio feature and compatibility work.

## Links

- [Studio v0.2.4 release](https://github.com/the-snowpear/omp-studio/releases/tag/v0.2.4)
- [Studio v0.2.4 tag](https://github.com/the-snowpear/omp-studio/tree/v0.2.4)
- [OMP baseline](../upstream-baselines.md)
- [Studio Host](../../packages/coding-agent/src/server/studio-host/index.ts)
