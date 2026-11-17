# 0064. Robomp running verification reports only the behavior it exercises

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** Owner acceptance pending; proposal within the assigned J12 completion scope
- **Links:** [robomp workflow](../agents/workflow/robomp.md), [operator reference](../../python/robomp/README.md), REQ-060 / J12

## Context

Offline replay exercises a real SQLite queue and local git worktree without
starting an agent. The gated worker smoke starts a real agent but uses a fake
GitHub transport and local bare repository. Neither proves that a deployed bot
can write comments, labels, branches, or PRs to GitHub. Those external actions
need explicit authorization for the target and scope.

## Decision

Propose `robomp verify-running --url <base>` as a read-only operator command for
an already-running deployment. It reads health, readiness, runtime status, and
durable event/issue/release projections over HTTP. It refuses HTTP failures,
redirects, and malformed projections; it does not enqueue work, start a bot,
change configuration, or use local GitHub credentials.

Its JSON identifies the observed HTTP result and visible row counts. Agent
execution, container contracts, and GitHub-write acceptance remain explicitly
false. This proposal is settled when the integration owner accepts the CLI
contract; running it against a deployment still requires that deployment to
exist and be reachable.

## Consequences

Operators get a reproducible check of the real running HTTP surface without
triggering bot actions. The output intentionally cannot certify the model,
webhook-to-worker path, sidecar permissions, or external writes. A successful
local process replay or HTTP probe must not be recorded as production bot
acceptance. No persistence schema or credential-storage boundary changes.

## Alternatives

- Treat offline replay as production acceptance. Rejected: it starts neither
the real agent nor GitHub transport.
- Enqueue a live issue from the verifier. Rejected: that can cause comments,
labels, pushes, and PRs and exceeds the read-only command's authority.
- Return full event payloads. Rejected: identity, endpoint verdicts, and counts
are enough to record this check without copying issue content into evidence.

## Links

- [Read-only verifier](../../python/robomp/src/acceptance.py)
- [Real process regressions](../../python/robomp/tests/test_offline_replay.py)
- [HTTP verifier regressions](../../python/robomp/tests/test_acceptance.py)
