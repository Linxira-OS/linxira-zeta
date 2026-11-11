# 0006. Freeze publishing on the 1.5 internal build line; 1.6.0 is the next public release

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta owner (release-scope ruling; corrected the same day to keep code-only 1.5 tags)
- **Links:** [release process](../release.md), [npm publish surface](../agents/workflow/release-publish.md), policy [code](../../scripts/release-policy.ts), [guard test](../../scripts/release-freeze.test.ts)

## Context

Zeta is iterating on the 1.5 line faster than it wants to publish. The current
public version is **1.5.1**; users install it through npm and the GitHub
Releases page. Every tagged release run currently builds binaries/installers and
then publishes `@linxiraos/*` packages plus a GitHub Release (`release_npm`,
`release_native_leaves`, `release_github`, the vendored editor/ide/web-ui/plugin
legs). A 1.5.x minor build therefore becomes visible to users the moment it is
tagged, even though the code is not ready for a public release.

The release chain is a single workflow (`.github/workflows/ci.yml`), with
standalone republish workflows (`main-publish.yml`, `ide-publish.yml`,
`editor-publish.yml`) that can publish without a tag. `scripts/release-v2.ts`
cuts the tag, and `scripts/ci-release-publish.ts` performs every npm publish.
Nothing between them implements a version-scoped "tag but do not ship" mode, so
the only current control is remembering not to tag.

## Decision

The 1.5 line is an **internal build line**, defined in one place —
`scripts/release-policy.ts`:

- **1.5.1 stays the public version.** It is not re-tagged or republished.
- **1.5.2 … 1.5.10 may be tagged normally**, but the tag is **code-only**. The
  annotated tag is the only release artifact; its annotation must carry the
  marker `高速迭代 / 内部构建 / 不发布资产` and say that no npm packages,
  installers, binaries, or GitHub Release assets are produced. CI may still
  build, package, and test artifacts, and it may upload Actions artifacts.
- **1.5.11+ and retired lines are neither taggable nor publishable.** The train
  jumps from 1.5.10 to 1.6.0.
- **1.6.0 is the next public release.** Tagging, uploading assets, and npm
  publishing for 1.6.0 require an explicit, auditable owner override that names
  exactly that version and carries a reason. Without it, every action fails
  closed — including 1.6.0.
- No version publishes by default. `evaluatePublishPolicy` returns
  `publishAllowed: false` / `assetsAllowed: false` unless the override applies;
  1.5.x is never overridable.

Enforcement is layered so a single missed condition cannot publish:

1. `scripts/release-v2.ts` refuses an out-of-policy tag, and creates an
   annotated tag with the code-only marker for internal builds.
2. `release_metadata` evaluates the policy for the tag at HEAD and exposes
   `publish-allowed` / `assets-allowed` job outputs. Every publish job
   (`release_npm`, `release_native_leaves`, editor/ide/web-ui/main/plugin legs)
   and the `release_github` asset upload add the corresponding condition; the
   default is `false`.
3. `scripts/ci-release-publish.ts` asserts the policy before touching npm, so
   the standalone publish workflows and local invocations fail closed too.
4. The standalone workflows declare `override_version` / `override_reason`
   dispatch inputs (default empty) and run an explicit freeze-guard step.
5. `scripts/release-freeze.test.ts` parses the workflows and fails if a publish
   job loses its policy condition, if an input defaults to anything but empty,
   or if the 1.5 policy regresses.

The owner override is set through the `release_override_version` /
`release_override_reason` dispatch inputs or the repository variables
`RELEASE_FREEZE_OVERRIDE_VERSION` / `RELEASE_FREEZE_OVERRIDE_REASON` (variable
edits are recorded in the organization audit log); locally the release script
reads the same values from `ZETA_RELEASE_OVERRIDE_VERSION` /
`ZETA_RELEASE_OVERRIDE_REASON`. An emergency public release uses this override
for the approved version; it cannot unlock a 1.5.x build.

## Consequences

- 1.5.2–1.5.10 stay internally consumable through tags and changelogs without
  exposing users to unfinished installers or npm packages.
- Public users remain on 1.5.1 until an owner-approved 1.6.0 release. The
  GitHub Releases page and npm `latest` dist-tag are no longer moved by routine
  internal tags.
- Release runs for internal tags still spend CI time building/packaging; that
  is deliberate — artifacts remain available for verification without being
  published.
- Publishing now has two independent gates (job `if:` + publisher assertion),
  so a workflow edit that drops one condition still fails closed.
- The override is intentionally a manual, documented step: there is no
  automatic path from "version reached 1.6.0" to a public release.
- Cutting a 1.6.0 release requires the owner to set the override and to run
  `scripts/release-v2.ts`; forgetting it aborts before any bump work.

## Alternatives

- **Do nothing / rely on operator discipline.** Rejected: the current chain
  publishes on every tag, and an accidental 1.5.x tag would ship installers and
  npm packages with no gate.
- **Delete the release/publish jobs during the freeze.** Rejected: it removes
  the working recovery path (`publish_plugins`, republish workflows) and the
  documented trusted-publishing handshake; the freeze must guard capability,
  not delete it.
- **Publish prereleases (`1.5.2-alpha.1`) instead of freezing.** Rejected: the
  publisher is stable-line-only (`validateExplicitVersion` rejects
  prereleases) and a prerelease still occupies npm metadata; the owner wants
  normal 1.5.x tags with code only.
- **Use a GitHub Environment with required reviewers only.** Deferred as the
  sole control: it does not cover every job, the standalone workflows, or
  local script runs, and it is not visible in the repository. It can be added
  later as an extra approval layer on top of this policy.

## Links

- Policy: [`scripts/release-policy.ts`](../../scripts/release-policy.ts)
- Guard test: [`scripts/release-freeze.test.ts`](../../scripts/release-freeze.test.ts)
- Release process: [`document/release.md`](../release.md)
- npm publish surface: [`document/agents/workflow/release-publish.md`](../agents/workflow/release-publish.md)
- Tag driver: [`scripts/release-v2.ts`](../../scripts/release-v2.ts)
- Publisher: [`scripts/ci-release-publish.ts`](../../scripts/ci-release-publish.ts)
