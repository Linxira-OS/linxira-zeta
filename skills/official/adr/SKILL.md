---
name: adr
description: "Record an architecture or contract decision in this repository as an Architecture Decision Record (ADR). Use when a decision changes a public API, data model, security or auth boundary, dependency or license, an irreversible migration, or release scope — and the user has made that decision. Skip bug fixes, renames, and style changes unless they change a contract; never write an ADR for a decision the user has not made."
---

# Architecture Decision Records

An ADR records **why** a durable, contract-level decision was made and what it costs. It is not a design doc, a changelog, or a plan. Write one only after the user has decided; recording an unmade decision as `Accepted` is fabrication.

## When to use

Write an ADR when the decision:

- changes a **public API**, tool schema, or wire/CLI contract;
- changes a **data model** or persistence format, especially when existing data must be read or migrated;
- moves a **security or auth boundary** (trust levels, credentials, permissions, sandboxing);
- adds, removes, or relicenses a **dependency**, or changes license/attribution obligations;
- commits to an **irreversible or hard-to-reverse migration**;
- fixes **release scope** (what ships, what is deferred, what becomes a compatibility promise).

Skip it for bug fixes, renames, formatting/style changes, refactors with identical behavior, and anything the repository's existing code and conventions already settle. A refactor becomes ADR-worthy only when it changes one of the contracts above.

## Workflow

1. **Find the existing convention before creating anything.** Search for prior decision records and their home: `docs/adr/`, `docs/decisions/`, `document/`, ADR references in `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md`, and README links. Use `grep`/`glob`/`read` — do not ask the user what the repository already shows. Follow the found template, filename scheme, numbering, and index style exactly.
2. **If no convention exists**, propose it before writing:
   - `docs/adr/README.md` — the index, one row per ADR;
   - `docs/adr/NNNN-<slug>.md` — zero-padded number, lowercase kebab-case slug;
   - optionally `docs/adr/template.md` — the template below.

   Ask for explicit consent, then create the structure. Only after that consent, append a **short** section (a heading, where ADRs live, the numbering rule, and when one is required) to the repository's agent instructions (`AGENTS.md`, or the equivalent file the repo actually uses). Do not rewrite the file or add a second convention.
3. **Do not invent history.** The first ADR records the decision being made now. Do not backfill earlier choices, and do not invent rationale, dates, authors, or alternatives. Mark what you do not know instead of guessing.
4. **Choose the status from what the user actually decided.**
   - **Proposed** — on the table, not decided. Include what would settle it.
   - **Accepted** — the user has committed to it.
   - **Superseded** — replaced by a later ADR; keep the body intact and link the replacement.
5. **Number and index.** Use the next number after the highest existing one; never reuse or renumber. Add the index row in the same change.
6. **Link it from the repository's entry point** (`AGENTS.md`, `README.md`, or the existing docs index) when the decision affects contributors. One link, not a duplicate of the content.
7. **Supersede instead of editing.** To change an accepted decision, write a new ADR that states what it replaces, and change the old ADR's status and links. Never rewrite the old context/decision to match the new choice.

## Template

```markdown
# NNNN. <Decision in one sentence>

- **Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-slug.md)
- **Date:** YYYY-MM-DD
- **Deciders:** <who actually decided>
- **Links:** <issue/PR/design doc/prior ADR>

## Context

The forces at play: the problem, the constraints, and what is true today.
Facts and measured behavior only; no invented background.

## Decision

What we will do, stated in the present tense. One decision per ADR.

## Consequences

What becomes easier and harder: costs, tradeoffs, follow-up work, and what
this forecloses. Include migration or compatibility impact when relevant.

## Alternatives

The options seriously considered and why they lost. "Do nothing" when it was
a real option.

## Links

Related ADRs, issues, PRs, and external references.
```

Short is correct: a one-page ADR that a newcomer can read in two minutes beats a design doc that restates the code.

## Rules

- **Never record a decision the user has not made.** Unresolved questions go in the ADR as open points, in `Proposed` state — not as a decision.
- One decision per record. Split independent choices into separate ADRs and link them.
- Write dates as real dates; use the current date only when the record is created or accepted, not when you are merely editing.
- Keep relative links valid. Prefer linking over copying; the ADR is the single home of the rationale.
- The ADR records intent and tradeoffs. The code, schema, and docs remain the source of truth for current behavior.

## Related skills

- `prd` — product intent and requirements. The PRD says *what* the product should do; ADRs say *how* the architecture commits to doing it. Do not duplicate either document into the other.
