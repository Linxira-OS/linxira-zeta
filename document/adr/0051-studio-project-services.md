# 0051. Studio services use the existing workspace broker and exact launch instances

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md), [official Studio v0.2.1](https://github.com/the-snowpear/omp-studio/tree/v0.2.1)

## Context

The v0.2.1 renderer calls `services.list/start/stop/restart/mode.set/send/logs`. Zeta's Host declares these operations but has no service family. Its existing project launch broker already owns processes, completion delivery, persistence and PTYs. The official seam adds broker capabilities, exact instance fencing and explicitly declared web preview URLs. A name alone can address a replacement process after a restart.

## Decision

Register the seven service operations in the existing Zeta Host. Resolve the selected resident AgentSession and its native ToolSession, require the same registered workspace and live authenticated view, and recheck that binding before dispatch and before returning. Continue to use the existing cookie/CSRF/device/2FA authority and shared project broker. Service rows expose the canonical owner ID, PID and an optional declared preview URL; launch commands, environment and private paths stay internal.

Port the official broker protocol extensions: `instanceFencing` and `previewUrls` capabilities, and optional `expectedInstanceId` on named operations. The instance is the broker UUID plus a strictly increasing launch timestamp. Serialize start/send/stop/restart/mode per service name, but wait for start readiness outside that queue so stop remains possible. Reject stale requests at execution and after asynchronous reads. Existing native callers may omit a fence; Studio always supplies one and refuses an older broker before controlling a service.

Project service inventory and controls span owners in one workspace. Conversation-bound device credentials remain denied these operations by the existing binding classifier; a selected conversation does not expand device scope to the whole broker.

Studio starts never replace an existing service and return after launch. Its relative working directory must resolve within the selected workspace, including symlink resolution. Preserve existing native launch persistence defaults; an explicit Studio mode overrides them. Session/persist/detached keep their existing broker lifetime behavior. The project-shared browser cannot be detached through either surface.

Named bash services may declare an absolute HTTP(S) `previewUrl` without embedded credentials. The broker validates and canonicalizes it before changing an existing process and persists it across restart/recovery. Never infer preview URLs from output or probe arbitrary ports to manufacture one. An older broker that cannot retain preview metadata is rejected before launching or replacing the service. Renderer service-start specifications do not gain a separate preview-association flow.

## Consequences

Studio and CLI operate on the same processes and completion lifecycle. Stale browser tabs cannot stop or write to a replacement launch. Old resident brokers need an explicit restart before Studio control or declared preview launches; listing remains readable. This decision does not change the held dedicated multi-terminal manager or introduce another runtime listener. Acceptance of this Proposed ADR requires the integrated service tests and actual scoped Host/UI lifecycle evidence; local source tests alone do not establish official source ancestry.

## Alternatives

- A separate Studio process supervisor: rejected because it splits process, session and completion ownership.
- Name-only controls: rejected because restart/replacement races target a different process.
- Parse URLs from output: rejected because output is untrusted and does not declare a preview contract.

## Links

- [Broker](../../packages/coding-agent/src/launch/broker.ts)
- [Service API](../../packages/coding-agent/src/launch/services.ts)
- [Studio operations](../../packages/coding-agent/src/server/studio-host/ops/services.ts)
- [Studio surfaces](../../docs/studio-surfaces.md)
