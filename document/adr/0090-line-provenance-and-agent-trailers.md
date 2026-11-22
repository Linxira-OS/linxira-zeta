# 0090. Line provenance comes from git; agent commits carry an explicit trailer

- **Status:** Proposed
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [ADR template](template.md), [TermIDE blame](../../termide/crates/git/src/blame.rs), [ADR skill](../../skills/official/adr/SKILL.md)

## Context

An ADR must distinguish who **decided** from who **wrote** a line. Git already
records the commit author and timestamp. `zetaide`/TermIDE already renders an
inline blame annotation at the cursor line (`show_blame`, default on), using
`git blame --porcelain`. That annotation is trustworthy only when the commit
author is truthful.

AI edits currently land in commits whose author is the human user. Git blame
then shows the user for lines an agent wrote, which is exactly the opposite of
the required provenance. Rewriting author metadata after the fact is not an
acceptable fix: it makes history false and cannot distinguish manual edits from
agent edits inside one commit.

## Decision

- Git remains the canonical line-attribution source. Never fabricate or rewrite
  `Author`/`Committer` to make a line look human or agent-written.
- Agent-created commits carry an explicit, machine-readable trailer in the
  commit body. The proposed trailer is `Co-authored-by: Zeta Agent
  <zeta-agent@localhost>`; the human retains authorship and remains the commit
  owner. A separate agent-authored commit may use the agent as `Author` only
  when the owner explicitly requests it.
- TermIDE blame must display the commit author plus the agent trailer when
  present, so a cursor line reads as human-authored, agent-assisted, or
  agent-authored. A commit without the trailer stays human-only.
- ADR metadata continues to record `Deciders` as the decision owner. It does
  not claim line authorship; line authorship is read from git.
- The convention applies to local commits and is visible before push. It must
  not depend on GitHub co-author UI, which is not part of the local blame path.
- Existing history is not rewritten. Old commits without the trailer remain
  unclassified and must not be presented as agent-authored.

## Consequences

The trailer must be added by the commit tooling, not remembered manually. The
TermIDE blame parser and the commit helper need tests for: no trailer, one
agent trailer, multiple agents, and a human co-author. Until that implementation
lands, the editor still shows only the author; the limitation must be stated
rather than invented.

The convention does not establish which model wrote which character. It records
the committing agent at commit granularity; line-level attribution is exactly
git blame's line range plus that commit provenance.

## Alternatives

- **Set the agent as git author for all AI changes.** Rejected: it loses the
  human owner and conflicts with normal GitHub attribution.
- **Use `git notes` for line ranges.** Rejected for now: notes are not visible
  in a standard `git blame` annotation and add a second, unportable store.
- **Infer from commit message wording.** Rejected: attribution must be
  machine-readable and must not guess.

## Links

- [TermIDE inline blame](../../termide/crates/panel-editor/src/editor_rendering.rs)
- [TermIDE blame parser](../../termide/crates/git/src/blame.rs)
- [ADR skill](../../skills/official/adr/SKILL.md)
- [ADR template](template.md)
