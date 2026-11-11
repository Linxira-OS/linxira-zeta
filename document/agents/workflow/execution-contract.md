# Execution Contract

**Status:** normative for Zeta work. Applies to the main agent, direct workers,
Vibe workers, Team engineers, and subagents.

This contract closes four failures:

1. An ADR records decisions but does not stop requirements from being dropped.
2. The main agent tracks work in chat memory or an ephemeral todo list.
3. Vibe workers cannot see the main conversation and therefore cannot infer scope.
4. A new request causes an implicit switch away from the work already in flight.

The durable register is [`document/requirements-ledger.md`](../../requirements-ledger.md).
The decision register is [`document/adr/README.md`](../../adr/README.md). This file
defines how work moves between them.

## 1. Intake: everything enters the ledger

- Every user item MUST enter the ledger as a row before it is acted on, including
  an item mentioned in passing, a bug report, a review comment, and a request
  that arrives while other work is in progress.
- The row starts as `INBOX` and uses the next free `REQ-NNN` ID. Never reuse or
  renumber an ID.
- Requirement text MUST be captured verbatim. If only an audit restatement exists,
  quote the audit and say so in Evidence.
- Mentioned ≠ scoped. `INBOX` means "captured", not "accepted", "prioritised", or
  "being worked on".
- An explicit rejection is recorded as `DEFERRED` (with reason and re-entry
  trigger), not by deleting the row.
- If a request is too vague to scope, keep it `INBOX` or `TRIAGED` and record the
  open question. Do not invent a scope to make the row look complete.

State transitions are deliberate:

```text
INBOX -> TRIAGED -> SCOPED -> IN_PROGRESS -> IMPLEMENTED -> VERIFIED -> RELEASED
                                     \-> BLOCKED
any state -> DEFERRED (explicit approval)
```

- `TRIAGED` requires a lane and a reason the work matters.
- `SCOPED` requires scope, acceptance, files, dependencies, and the evidence plan.
- `IN_PROGRESS` requires a worker brief that names the REQ ID.
- `IMPLEMENTED` requires a file, commit, or PR pointer.
- `VERIFIED` requires independent verification evidence.
- `RELEASED` requires a release/tag pointer.
- `DEFERRED` requires an approval record and a re-entry trigger.
- `BLOCKED` requires the exact blocker and what was tried. "Not started" is not
  blocked.

## 2. WIP: append, do not replace

- A new request MUST be appended to the ledger. It MUST NOT replace, rename, or
  silently re-scope the work already in progress.
- An explicit switch MUST record three things in the interrupted row: that it is
  `IN_PROGRESS` with a WIP note, the reason for the switch, and the resume
  condition. The new row records the switch as its source.
- Keep one `IN_PROGRESS` requirement per worker per lane. Parallelism belongs to
  separate lanes, not to one worker juggling several half-built changes.
- The main agent MAY coordinate multiple lanes, but every active lane MUST name
  one owner and one REQ ID.
- Do not start work that has no scoped acceptance criteria. If the acceptance is
  unknown, the row is `TRIAGED`, not `IN_PROGRESS`.

## 3. Worker brief: what the worker must receive

A worker never sees the main conversation. Its brief MUST be self-contained and
MUST include:

1. **REQ IDs** — every requirement the worker is allowed to touch.
2. **Acceptance** — the observable result, including the checks that prove it.
3. **Files and boundaries** — files/directories in scope and explicit non-goals.
4. **Constraints** — interfaces, patterns, compatibility, migrations, and what
   must not change.
5. **Evidence to return** — the exact commands/tests the worker must run, if the
   contract requires the worker to run them.
6. **No scope creep** — the worker MUST NOT fix adjacent bugs, refactor, rename,
   or add validation, telemetry, or abstraction that the REQ does not require.
7. **New discoveries** — any new work discovered is returned as a proposed REQ,
   not implemented silently.

The brief MUST NOT say "see the chat" or rely on the worker inferring intent from
the parent transcript. If the brief is incomplete, the worker returns the missing
question instead of guessing.

## 4. Worker return: what must come back

A worker return MUST list:

- **Changed files** — every file created, edited, or deleted.
- **Passed evidence** — commands run with results, or an explicit statement that
  verification was not run and why.
- **Missing items** — acceptance criteria not met and the reason.
- **New risks / new REQs** — regressions, unknowns, follow-up work.
- **Scope check** — confirmation that no out-of-scope change was made.

A report without changed-file paths is not a return. A report that says "done"
without the evidence named in the brief is not a return.

## 5. Main-agent verification: read, run, then record

- The main agent MUST verify by reading the changed files and running the named
  checks. It MUST NOT mark a REQ `VERIFIED` from a worker's prose report.
- Verification MUST be independent of implementation. The implementer cannot
  self-mark `VERIFIED`; a different worker, a reviewer, or the user must verify.
- Verification evidence records what was read and what was executed, including
  the command and its result. "Looks correct" is not evidence.
- A reviewer finding creates a new `IN_PROGRESS` or `BLOCKED` state on the same
  REQ. It does not create a silent side fix.
- One worker owns one lane and one set of files. Shared-file edits need one
  integration owner; parallel workers must not race the same files.

## 6. Scope-creep rule

- The REQ is the boundary. Anything not named in its scope is out of scope.
- A discovered bug, cleanup, rename, or missing test becomes a new `INBOX` row.
  It is not fixed opportunistically inside the current REQ.
- A "while I was there" change is a contract violation even when it is correct.
- If the smallest correct fix requires a contract change, stop and write the ADR
  first, then update the REQ scope.

## 7. ADR boundary

Write an ADR before implementing a change that alters:

- architecture layering or process/runtime boundaries;
- a public API, tool schema, CLI, or wire/HTTP contract;
- a data model, persistence format, or cross-system data ownership;
- a security or authorization boundary;
- a dependency, licence, or attribution commitment;
- an irreversible or hard-to-reverse migration;
- release scope: what ships, what is deferred, or what becomes a compatibility
  promise.

Do **not** write an ADR for a bug fix, rename, formatting change, or
behaviour-preserving refactor. The normative rule and links live in
`AGENTS.md` §8; the process and index live in `document/adr/README.md`.

Every release-relevant ADR must link its PR, tests/checks, and release assets.
Release notes cite the ADR ID. A contract change with no ADR is an untraced
change: it does not ship until the ADR exists or the change is explicitly ruled
out of scope.

## 8. Release gate

A release is blocked unless all of the following are true:

1. Every REQ in the release scope is `VERIFIED` or `RELEASED`.
2. Every item not shipping is `DEFERRED` with an explicit approval record and a
   re-entry trigger. An unapproved deferral is not a deferral.
3. Every contract/architecture/data-model/release-scope change has an **Accepted**
   ADR, an index row, and links to PR/tests/assets. A `Proposed` ADR is not a
   decision and cannot satisfy this gate.
4. CI is green for the release source commit. Cancelled or skipped runs are not
   green.
5. Release notes cite the ADR IDs and the REQ IDs whose evidence is complete.
6. `RELEASED` rows point at the tag or release artifact. Merging is not releasing.

The release checklist in [`document/release.md`](../../release.md) is the operational
form of this gate.

## 9. Ledger and ADR hygiene

- Run `bun run check:reqs` and `bun run check:adr` after editing either register.
- The guards are structural. They catch duplicate IDs, unknown statuses, missing
  evidence on done states, missing/orphan index rows, illegal filenames, reserved
  0000 IDs, and empty placeholder records. ADR IDs must be monotonically
  increasing but may leave gaps: IDs are stable identifiers, not a dense sequence,
  and gaps are never backfilled with placeholders. The guards do not judge whether
  the evidence is honest; review does that.
- Keep the requirement text stable. Correct a typo, but do not rewrite a
  requirement to match what was implemented.
- If a REQ is split, keep the original ID and add child REQs with new IDs; record
  the split in both rows.
- If a REQ is superseded, mark it `DEFERRED` with a link to the replacement. Do
  not delete history.

## 10. Anti-patterns

| Anti-pattern                                              | Why it fails                                              | Required behaviour                                      |
| --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| "I'll remember it from the chat."                         | Chat is not durable; workers cannot see it.               | Append an `INBOX` row immediately.                      |
| A new request starts a new task and abandons the old one. | Work disappears without a decision.                       | Append; record WIP/reason/resume on the old row.        |
| "Scoped" means "started".                                 | Planning is mistaken for execution.                       | `SCOPED` only after acceptance and evidence plan exist. |
| Worker says "all tests pass".                             | Self-report is not evidence.                              | Return changed files, commands, results, gaps.          |
| Implementer marks `VERIFIED`.                             | No independent check.                                     | Separate verifier reads files and runs checks.          |
| Fixing a nearby bug "while there".                        | Scope creep and unreviewed risk.                          | New `INBOX` row; do not touch it in this REQ.           |
| Deferring without approval.                               | The release gate silently loses a requirement.            | Record approver, reason, re-entry trigger.              |
| "CI is green" from a single nix run.                      | Wrong workflow.                                           | Check the CI workflow name and the full job set.        |

## 11. Minimal example

```text
REQ-101  Add a dictation capability gate to the Studio composer.   INBOX
  -> TRIAGED  lane: studio
  -> SCOPED   acceptance: no dictation control when capability absent;
              manifest test asserts no dictation.* methods.
  -> IN_PROGRESS  worker brief names REQ-101 + files + no bridge work.
  -> IMPLEMENTED  worker returns changed files + test output.
  -> VERIFIED     reviewer reads the diff, reruns the manifest test.
  -> RELEASED     release notes cite REQ-101; row points at the tag.
```

If, while implementing REQ-101, the worker notices that the voice bridge is
missing, that becomes a new `INBOX` row. It is not added to REQ-101.
