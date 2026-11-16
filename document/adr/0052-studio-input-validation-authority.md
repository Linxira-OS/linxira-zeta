# 0052. Studio validates operations at the existing Zeta Host boundary

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [ADR 0036](0036-upstream-interface-alignment.md), [REQ-099](../requirements-ledger.md), [official validation refactor](https://github.com/the-snowpear/omp-studio/commit/1840cf6125404c0121714abc7d5f21275ae11e6a)

## Context

Official Studio v0.2.1 removes duplicated operation, result and event validators from shared protocol contracts. Its Runtime bridge owns operation parsing. Zeta does not use that bridge: authenticated `/api/v1/query` and `/api/v1/command` requests dispatch through `StudioOperations` to the existing Host families and gateway. The old `parseFoundationStudioRequest` table has no production caller. Keeping it does not validate these HTTP requests.

Some remaining checks do own a real boundary: service launch specifications before they reach the broker, browser and Computer operation inputs, browser input received on private sockets, native or paid evaluation specifications, runtime setting writes, persisted Computer metadata, and private Desktop IPC. Removing those because their names resemble upstream mirrors would remove the only check for those inputs.

## Decision

Adopt the official types-only shared protocol contracts and remove the unused foundation parser and its validator-only tests. Keep the official shared helpers for GUI setting values, annotation bundles, service specifications and artifact inputs. Preserve Zeta-specific configuration keys and ownership extensions.

Validate service, browser and Computer inputs at their actual Zeta Host operation or private-socket entry point. These checks are local to the owning boundary, not restored exports of the retired shared protocol API. Continue validating native or paid specifications and persisted/private payloads where they enter their owner. Do not validate an already typed in-process result again merely to match a shared result whitelist; construct public projections explicitly and retain authorization, liveness, exact-instance, workspace, path, NUL and URL checks.

Desktop private socket and IPC input checks remain independent trust boundaries. Their frame limits, sender/descriptor/lease identity and sequence checks remain in force. This decision does not install an upstream Runtime, alter cookie/CSRF/device/2FA authority, widen device bindings, or make a client-side precheck an authorization gate.

## Consequences

Shared contract changes no longer require updating an unused request table or output whitelist. Host and Desktop retain responsibility for the inputs they actually consume. Export removal requires migrating all local consumers and deleting dead validation implementations. Regression evidence must exercise Host operations, private input handling and public projections; a type-clean tree alone does not establish that boundary preservation. This ADR remains Proposed until the integrated review and affected behavioral checks are accepted.

## Alternatives

- Keep all old shared validators: rejected because they retain the removed upstream API and duplicate maintenance without protecting the actual HTTP dispatch path.
- Delete every validator: rejected because private socket, IPC, launch and native/paid input checks still own real boundaries.
- Import the upstream standalone Runtime bridge: rejected because it splits Zeta's existing Host and authentication authority.

## Links

- [Host registry](../../packages/coding-agent/src/server/studio-host/registry.ts)
- [Service operations](../../packages/coding-agent/src/server/studio-host/ops/services.ts)
- [Browser operations](../../packages/coding-agent/src/server/studio-host/ops/browser.ts)
- [Computer operations](../../packages/coding-agent/src/server/studio-host/ops/computer.ts)
- [Studio surfaces](../../docs/studio-surfaces.md)
