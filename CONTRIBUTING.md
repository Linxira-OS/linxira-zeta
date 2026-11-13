# Contributing to Zeta

Zeta is a downstream runtime distribution maintained by Linxira. Pull requests
are welcome; keep them focused and be prepared to explain and maintain the
change.

## Before you start

### Where to report

Route a problem by where it reproduces. The full protocol is
[`document/maintenance-ownership.md`](document/maintenance-ownership.md).

| Area | Where to report |
| --- | --- |
| OMP runtime, tools, models, or TUI; upstream bot updates | <https://github.com/can1357/oh-my-pi/issues> |
| Renderer or host-contract defect that reproduces without the Zeta fork | Follow the ownership route in [`document/maintenance-ownership.md`](document/maintenance-ownership.md) |
| TermIDE terminal/editor/LSP/DAP | <https://github.com/termide/termide/issues> |
| Zeta-owned behavior: Work Studio, server/Studio host, IM, CLI/TUI product behavior, `zetaide` deviations, `desktop/`, `android/`, plugins, docs | This repository's issue tracker |
| Security vulnerability | Private advisory via [`SECURITY.md`](.github/SECURITY.md), never a public issue or pull request |

Upstream bot triage and release sync are maintainer workflows: syncs are
on-demand and enter Zeta only through a named official release tag, never an
upstream branch. OMP Web is frozen and is not a report or sync surface; Pi / Pi
Web are semantic port sources, not raw merge sources. Upstream should not be
asked to own Zeta product behavior or usage differences.

### Small changes

Bug fixes, documentation updates, and narrowly scoped improvements can go
straight to a pull request.

### Major changes

Open an issue before writing the implementation for a new subsystem, a large UI
change, a new dependency, or a change that spans several packages. Explain the
problem and the intended shape first. A pull request is not a substitute for
that discussion, and prior discussion does not guarantee a merge.

Do not open an issue and a pull request for the same work at the same time. Pick
one path: report the problem, or submit the reviewed change.

## AI-assisted contributions

AI agents are tools, not unattended contributors. Before opening a pull request
with agent-assisted work, you must:

- constrain the agent to the agreed scope and reject unrelated changes;
- review every changed file and understand the resulting behavior;
- run the relevant checks and exercise the changed behavior yourself; and
- submit only after that review, not by letting an agent publish autonomously.

You are responsible for the code regardless of who or what generated it.

## Pull request requirements

Every pull request body **MUST include at least one sentence written by you, in
your own words**, explaining what changed and why. A generated summary, pasted
agent transcript, or checklist alone does not satisfy this requirement.

You **MUST verify that the change works as intended**. `bun check` and automated
tests are expected where relevant, but they are not proof that the behavior
works. Exercise the changed path yourself and report the exact scenario and
result in the pull request:

- for a bug fix, reproduce the bug and confirm the same reproduction no longer
  fails;
- for a feature, launch the product and use the feature end to end; and
- for a UI change, interact with it and inspect the rendered result.

“`bun check` passes” by itself is not sufficient verification. Use
`bun run test:rs` for Rust changes; do not invoke `cargo test` directly. For
coding-agent development commands and repository structure, see
[`packages/coding-agent/DEVELOPMENT.md`](packages/coding-agent/DEVELOPMENT.md).

Keep each pull request to one logical change. Avoid unrelated cleanup,
drive-by refactors, generated noise, or features outside the agreed scope.
Do not delete tests, weaken assertions, or skip a check to get green.

## CI

GitHub CI is tiered: pull requests and non-main dispatches take the fast path
(no Rust/cross/native compilation), main pushes run the full gate, and release
runs skip the test fan-out after the source commit is green. The exact job map
is in [`document/ci-tiers.md`](document/ci-tiers.md). Contributors do not need
to reproduce every environment locally; they do need to run the checks relevant
to the changed paths.

The Gitea mirror is for the project's own Linux hosts. GitHub Actions is the
contribution gate.

## Coverage

Coverage is measured and reviewed, not enforced by a threshold. The current
baseline, package-by-package limits, and the loaded-file caveat are in
[`README.md`](README.md#coverage).

For runtime-behavior changes and release candidates, maintainers run the
**Coverage** workflow and attach the `coverage-lcov` artifact to the review or
release record. A drop larger than 0.5 percentage points in a package's line
coverage needs an explanation. Do not report the `coding-agent` core sample as
the whole package.

## Contribution licensing

Zeta uses a per-directory licence split: `main/` is AGPL-3.0, while
`packages/`, `crates/`, `sdk/`, `termide/`, `editor/`, `web-ui/`, and `desktop/`
are MIT. Submit work you have the right to licence under the terms that apply to
the files you change. Third-party or vendored code keeps its own licence and
attribution; do not relicense it.

## Review

Maintainers review the submitted behavior and the contributor's understanding of
it, not the volume of generated code. Respond to review feedback yourself, and
apply only suggestions you have checked.

Pull requests may be closed when they skip required discussion, lack the
human-written explanation, contain unreviewed agent output, or mix unrelated
changes.

Report security issues through the private channel in
[`SECURITY.md`](.github/SECURITY.md), not a public issue or pull request.
