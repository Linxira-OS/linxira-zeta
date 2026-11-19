# 0079. External skill packs enter through a pinned, conflict-checked initialization step, not a bulk install

- **Status:** Proposed
- **Date:** 2026-11-19
- **Deciders:** Zeta owner (pending)
- **Links:** [mattpocock/skills](https://github.com/mattpocock/skills), [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude), [skills runtime](../skills.md), [ADR-0037](0037-team-runtime-governance.md), [agent-session mode injection](../../packages/coding-agent/src/session/agent-session.ts)

## Context

Three public MIT skill packs were evaluated as references for Zeta's skill
lifecycle, Team-mode governance and tracking prompts. They are separate
projects with different owners and release models; the evaluated revisions are
pinned below. The owner's test of installing all three at once produced skill
conflicts, so a bulk install is not the product shape under consideration.

| Pack | Pinned revision | Archive | Role |
| --- | --- | --- | --- |
| Matt Pocock — `mattpocock/skills` | `49dd158d1076134a641b33efb035946536778336` | 253 KB tar.gz | Curated, lifecycle-governed personal collection |
| Addy Osmani — `addyosmani/agent-skills` | `aeac41d4d005999432bb7312f7ff06383a91d59d` | 353 KB tar.gz | Platform/evals-driven catalog |
| Michael Denyer — `michael-denyer/pstack-claude` | `7bad1ebc26faa268806bfbb84e5af55d178b68e4` | 3.7 MB tar.gz | Port/sync of Lauren Tan's Cursor `plugins/pstack`, generator-owned |

Two MIT documentation-localization repositories are also references for the
Chinese pages, not runtime inputs: `devcxl/mattpocock-skills-zh` pinned at
`1f4d8f6`, and `vinvcn/addyosmani-agent-skills-zh` pinned at `dda5311`.
The pstack page's nine Chinese files are site translations, not an upstream
repository.

The packs demonstrate three governance models Zeta does not yet have in one
place:

- **Curation with an explicit bar and rejection ledger.** Matt Pocock's
  `SCOPE.md` requires an observed real-session failure and no philosophy
  conflict; reactions and +1 do not count as votes. `.out-of-scope/` records
  nine rejected proposals. Skills live in lifecycle buckets
  (`engineering`, `productivity`, `misc`, `in-progress`, `deprecated`), with
  four synchronized registrations per promoted skill. Invocation authority is
  first-class: 23 of 38 skills set `disable-model-invocation: true`, and every
  skill has an `agents/openai.yaml` counterpart with
  `policy.allow_implicit_invocation: false`. Release notes come from changesets.
- **Catalog-level validation.** Addy Osmani's `evals/README.md` defines three
  layers — structural (frontmatter, naming, required sections, line budget,
  reference links, command consistency, manifest version), trigger/routing
  (positives in top-k, negatives not triggered, no near-duplicate descriptions
  between two skills), behavioral — and the repository runs `run-evals.js` in
  CI. New-skill proposals must check the catalog, open PRs, the rejection
  ledger (`evals/skill-impact.md`), and `skill-anatomy.md`, and must strip
  model-specific workarounds. Twenty-five of twenty-five skills keep only
  `name` + `description` frontmatter; repository-level checks carry the
  complexity.
- **Port provenance and a single generator source.** pstack-claude states that
  it owns the Cursor→Claude translation, not the skill content. `tools/forks.json`
  lists intentional forks, `tools/substitutions.json` requires a rationale per
  replacement, `tools/upstream.json` + `sync.mjs` own synchronization, and
  `tools/generate.mjs` owns model policy, manifest version, Codex prompt stubs
  and the per-skill Models section; pre-commit runs `generate.mjs --check`.
  Licensing is explicit (`LICENSE`, `LICENSE-cursor-team-kit`,
  `LICENSE-thermos`, `NOTICE-skills.md`, `NOTICE.md`), and the repository also
  carries TLA+/Lean models for its orchestrator.

Current Zeta facts that constrain adoption:

- `skills/official/` is a bundled provider (`zeta-official`, priority 10),
  shipped in binaries and seeded into the agent directory; it is removed by
  `skills.enableOfficial: false`.
- Other packs reach the session through the native `.zeta` skill roots, custom
  directories, plugin skill roots, or foreign providers. Name collisions are
  detected and the losing entry is namespaced with a warning; there is no
  trigger/description near-collision gate equivalent to Addy's eval layer.
- Team mode forces `tracking.enabled` for its scope, adds `tracking_update`,
  and injects the `adr` skill body once per session when a skill named `adr`
  exists (`agent-session.ts` `enterTeamMode` and `#buildTeamModeMessage`).
  Vibe mode and legacy Lead/PM mode inject neither the ADR skill nor a
  tracking directive. ADR-0037 requires an entry-time tracking skeleton and a
  canonical architecture summary with revision/hash; `docs/vibe-mode.md`
  records those as incomplete.

## Decision

Treat the three packs as pinned reference projects, not as an installable
bundle. Their governance models are adopted as design inputs for Zeta's own
skill lifecycle. Any runtime adoption goes through a per-project initialization
step:

1. Select individual skills, never a whole pack. Import copies into the
   project's native skill root under a stable `imported/<pack>/<skill>` path,
   leaving user-authored skills at the higher native priority.
2. Record provenance in a project manifest: repository URL, pinned commit,
   source path, sha256 of each imported file, license identifier, and import
   date. Update is an explicit re-import against a new pinned commit, never an
   implicit pull.
3. Preserve attribution: copy the pack's `LICENSE`/`NOTICE` obligations into
   the project's third-party notices and record the MIT terms in the license
   map.
4. Run a collision gate before writing: reject duplicate names, warn on
   near-duplicate or overlapping descriptions, report shadowed skills, and keep
   per-skill invocation policy (`disable-model-invocation` maps to `hide`).
   Playbook-only skills stay user-invoked; only genuinely model-invocable
   skills appear in the prompt catalog.
5. Add a rejection ledger for imported and proposed skills, carrying the
   source bar: a real observed failure, no philosophy conflict, and an explicit
   rationale. Bulk-import mode, if offered at all, is a diagnostic that emits a
   conflict report and never activates the pack.

This ADR is settled by the owner choosing whether skill-pack initialization is
in 1.6.0 release scope. Until that choice, no pack is installed by default and
the pinned revisions above are the only evaluated references.

## Consequences

- The three packs cannot silently shadow each other or Zeta's official skills;
  a user sees which entries lost a name/trigger conflict.
- Adopting a pack becomes a reviewable project change with pinned commits,
  hashes and licenses, instead of an opaque copy into `~/.zeta`.
- Zeta gains a rejection ledger and catalog checks that match the strongest
  observed practices, without importing either pack's repository-specific
  prose rules.
- Importing external skills adds maintenance: upstream revisions must be
  re-pinned deliberately and the license/NOTICE ledger must move with them.
- Team mode's ADR-skill injection remains conditional on an installed `adr`
  skill; a project that disables the official pack still has no ADR/tracking
  directive in Vibe or Lead mode. That gap is tracked separately under
  ADR-0037/0075 and is not closed by this ADR.

## Alternatives

- **Install all three packs into one skill root.** Rejected: the owner's test
  produced conflicts, the packs overlap on generic workflows, and priority
  shadowing would hide entries without a product-visible conflict report.
- **Reference-only, no import path.** Keeps the repositories as reading
  material but gives users no supported way to adopt a pinned workflow, which
  is the actual request behind the evaluation.
- **Ship each pack as a plugin or Skillshare package.** Rejected as the
  default: Skillshare retirement remains an explicit boundary (ADR-0047), and
  plugin packaging adds a second distribution surface for content that is
  mostly prose. Revisit only if packs need executable hooks.

## Links

- [Skill discovery and precedence](../skills.md)
- [Team runtime governance](0037-team-runtime-governance.md)
- [Agent session mode injection](../../packages/coding-agent/src/session/agent-session.ts)
- [Skill capability](../../packages/coding-agent/src/capability/skill.ts)
- [Official ADR skill](../../skills/official/adr/SKILL.md)
