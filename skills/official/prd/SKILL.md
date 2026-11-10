---
name: prd
description: "Write a Product Requirements Document at a new project or feature kickoff when requirements are under-specified. Interviews the user with the grill-me skill one question at a time, then records users, problem, scope, success metrics, flows, data, constraints, and rollout in docs/prd/<slug>.md. Use before implementation planning; route architecture and contract decisions to the adr skill instead of putting them in the PRD."
---

# Product Requirements Document

A PRD fixes **product intent** while it is still cheap to change: who the feature is for, what problem it solves, what is in and out of scope, and how success is measured. It is not an implementation plan, a design document, or a task list.

Use this skill at kickoff for a new project or feature, or when a request has no agreed scope and success criteria. Skip it for a bug fix with a known cause, a mechanical refactor, or a change whose requirements are already written down.

## Workflow

1. **Load `grill-me` and use it.** Read `skill://grill-me` and follow that interview discipline:
   - one question per `ask` call, never batch;
   - give the recommended answer with each question;
   - ask the question no other open decision blocks (dependency order);
   - resolve facts from the repository with `grep`/`read`/`glob`/`scout` instead of asking;
   - stop when no open decision still changes the plan. "Just decide" ends the interview: take the recommended defaults and list them as assumptions.
2. **Cover these areas**, in this order unless a dependency says otherwise:
   - **Users and jobs** — who has the problem, in what situation, and what they do today;
   - **Problem** — the concrete pain and why it is worth solving now;
   - **Scope and non-goals** — what this version does, and explicitly what it will not do;
   - **Success metrics** — observable outcomes and how they are measured; avoid vanity metrics;
   - **User flows** — the primary path, key branches, and failure states;
   - **Data and integrations** — inputs, outputs, storage, external systems, permissions;
   - **Constraints and risks** — platform, compatibility, privacy/security, performance, deadlines;
   - **Rollout** — how it reaches users, feature flags, migration, rollback, and support.
3. **Write the PRD** to `docs/prd/<slug>.md` (lowercase kebab-case slug), or a path the user names. If the repository already has a PRD/requirements directory or template, use that instead of creating a parallel convention.
4. **Separate product intent from implementation.** The PRD may state constraints and required behavior; it must not choose libraries, schemas, internal APIs, or module layout. Those are architecture decisions: hand them to the `adr` skill.
5. **Confirm before treating it as agreed.** Present the draft and the list of assumptions; the user's acceptance makes it the current requirements baseline.

## Template

```markdown
# <Feature or product name> — PRD

- **Status:** Draft | In review | Accepted
- **Owner:** <name>
- **Date:** YYYY-MM-DD
- **Links:** <epics, issues, designs, related PRDs/ADRs>

## 1. Summary

Two or three sentences: what this is, who it serves, and why now.

## 2. Users and jobs

Who the users are, the situations they are in, and the jobs they are trying
to get done. Name the primary user; list secondary users separately.

## 3. Problem

The pain today, with evidence where it exists (support reports, usage data,
user quotes). State the cost of not solving it.

## 4. Goals and success metrics

- Goal: <outcome>
- Metric: <observable measure> — baseline <x>, target <y>, measured by <how>

## 5. Non-goals

What this explicitly does not do, so scope cannot drift silently.

## 6. Scope

### In scope

- <capability> — <user-visible behavior>

### Out of scope

- <capability> — <why deferred>

## 7. User flows

Primary flow, key branches, and the important failure/empty states.
Describe behavior, not screens; link designs instead of embedding them.

## 8. Data and integrations

Inputs, outputs, where data lives, external systems, and permissions.
Do not specify schemas or internal APIs here — record those as ADRs.

## 9. Constraints and risks

Platform, compatibility, privacy/security, performance, accessibility,
licensing, and scheduling constraints. For each risk: likelihood, impact,
and mitigation.

## 10. Rollout

Release path (flag, staged, direct), migration and compatibility notes,
rollback plan, and how success will be measured after launch.

## 11. Open questions

Decisions still unresolved, each with an owner and what would settle it.

## 12. Assumptions

Defaults taken when the user said "just decide", so they can be challenged.
```

Keep it as short as the decision allows. A PRD that restates the feature name in five sections is noise; every section should change what gets built or how success is judged.

## Rules

- **Interview before writing.** A PRD produced without the `grill-me` pass is a guess with headings.
- **No implementation content.** No file paths, schemas, dependency choices, or estimates. Route those to `adr`; link the ADR from the PRD's Links section.
- **No invented requirements.** If the user did not say it, it is an assumption or an open question — label it as such.
- **Non-goals are mandatory.** Without them, scope grows during implementation.
- **Update, do not fork.** When requirements change, edit the PRD and record the change in its Links/history; do not create `prd-v2.md` unless the user asks for a separate document.
- **One PRD per product or feature.** Split unrelated initiatives instead of building a catch-all document.

## Related skills

- `grill-me` — the interview method this skill runs on.
- `adr` — architecture and contract decisions discovered during the interview. The PRD owns product intent; the ADR owns the technical commitment.
