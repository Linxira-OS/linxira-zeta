---
name: grill-me
description: "Interview the user relentlessly about a plan, one question at a time, with a recommended answer for each, until you reach a shared understanding. Use before planning, or right after entering plan mode on an under-specified request; explore the code instead of asking anything the repository can answer."
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead.

## In Zeta

- **One question per `ask` call.** `questions` carries exactly one entry; put your answer in `recommended`. Never batch during the interview — the next question depends on the answer to the current one.
- **Order by dependency.** First name the decision branches (one line each). Ask the question no other open decision blocks; defer anything whose answer depends on it.
- **Facts come from the repository.** Paths, signatures, behavior, config keys: `grep`/`read`/`glob` (or `scout`) instead of asking. Ask only preferences, tradeoffs, scope edges, and product choices the code cannot settle.
- **Every question must change the plan.** If neither answer alters a step, a file, or verification, it is filler — drop it.
- **Stop at shared understanding.** When no open decision still changes the plan, write it (plan mode: `local://<slug>-plan.md`, then `xd://propose`). "Just decide" from the user ends the interview: pick the recommended defaults and record them under Assumptions.
