# 0033. One exact 1.5.2 owner-review GitHub-assets release; npm and 1.6 stay closed

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Zeta owner (explicit 1.5.x full-assets release request, 2026-11-12)
- **Links:** [release freeze 0006](0006-release-freeze-internal-line.md), [release process](../release.md), [release policy](../../scripts/release-policy.ts), [scope gate](../../scripts/release-scope.ts), [guard tests](../../scripts/release-freeze.test.ts), [published v1.5.1](https://github.com/Linxira-OS/linxira-zeta/releases/tag/v1.5.1)

## Context

ADR 0006 froze the whole 1.5 line: 1.5.2–1.5.10 could be annotated
code-only tags, but no GitHub Release assets and no npm publish were allowed.
The public GitHub release was **v1.5.1** with 18 assets; the remote tag list
observed on 2026-11-12 contains only `v1.5.0` and `v1.5.1`.

On 2026-11-12 the owner explicitly requested one **formal 1.5.x full-assets
GitHub Release for manual download and owner acceptance**. That instruction
supersedes ADR 0006 only for this named review release. It does not authorize
npm publication, a 1.6 stable claim, a tag rewrite, or any automatic upstream
sync. The existing `release-scope.json` remains empty; a real scope entry and
green CI are still required before tagging.

## Decision

The single review version is **1.5.2** (the smallest unused stable patch above
v1.5.1; no tag exists yet). The release exception is narrow and explicit:

- Default policy for 1.5.2 remains **code-only**: `tagAllowed=true`,
  `assetsAllowed=false`, `publishAllowed=false`; no override means no assets.
- An override is accepted **only** when `ZETA_RELEASE_OVERRIDE_VERSION` (or the
  existing dispatch/repository-variable input) names exactly `1.5.2` **and**
  `ZETA_RELEASE_OVERRIDE_REASON` is a non-empty audit reason. It yields
  `channel=public`, `tagAllowed=true`, `assetsAllowed=true`,
  `publishAllowed=false`.
- Wrong version, missing reason, a different 1.5.x patch, 1.5.1, or any
  prerequisite failure denies assets. 1.5.3–1.5.10 remain code-only. 1.6.0
  remains the owner-gated public line and is unchanged.
- `assetsAllowed` and `publishAllowed` are independent policy fields. A
  matching 1.5.2 override may upload GitHub assets but must never run npm
  publication. The standalone `skip_npm` dispatch input must not be the gate
  that blocks a policy-allowed GitHub asset upload; asset upload still requires
  the existing build, release-gate, release-scope, and CI-success conditions.
- The normal release-scope gate is not bypassed. This ADR does not create or
  approve a scope entry; `release-scope.json` must gain a real 1.5.2 entry with
  evidence and notes before the tag/asset path can complete.
- 1.5.1 is never re-tagged, rewritten, or republished. No npm package, install
  script, 1.6 stable claim, or upstream merge is authorized by this exception.

## Consequences

- The owner can manually download one reviewed 1.5.2 GitHub Release asset set.
  GitHub's stable release becomes the 1.5.2 asset review surface; npm remains
  on **1.5.1** because this exception keeps `publishAllowed=false`. This is not
  a 1.6 stable-readiness claim and does not move the npm `latest` tag.
- Publication is still fail-closed: an empty scope, red CI, wrong version, or
  missing reason stops before assets; npm publication remains false.
- 1.5.3–1.5.10 and 1.6.0 retain their prior release gates.
- The exception is auditable through the existing override version/reason
  inputs and independently testable at the policy level.

## Alternatives

- **Apply the exception to all 1.5.x versions.** Rejected: the owner named one
  review release; broad unlocks would recreate the original freeze risk.
- **Allow npm too.** Rejected: the request is a full-assets GitHub Release for
  manual owner testing, not a package publication.
- **Use `skip_npm` as the assets switch.** Rejected: it couples a dispatch
  convenience flag to a policy authorization, and it does not distinguish a
  policy-allowed asset-only release from npm publication.
- **Bypass the empty release scope.** Rejected: assets are a public surface;
  the existing scope gate and real evidence remain mandatory.

## Links

- [ADR 0006](0006-release-freeze-internal-line.md)
- [Release policy](../../scripts/release-policy.ts)
- [Release scope gate](../../scripts/release-scope.ts)
- [Freeze tests](../../scripts/release-freeze.test.ts)
- [Workflow](../../.github/workflows/ci.yml)
