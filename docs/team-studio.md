# Team in Work Studio

The Work Studio Team pane is the browser surface over the same Team database the
CLI and TUI use. It never keeps a second store: onboarding, PM/engineer/repo
state, rooms, events, tasks, leases, bootstrap runs, and doctor checks are real
`~/.zeta/data/zeta.db` rows read through the Team service.

## Entry

- The pane lists every registered Team by id/name. Selecting one loads
  `team.read` and `team.doctor`; no Team root is guessed from the browser's cwd.
- With no registered Team, the pane opens the onboarding form.
- Routine reads and mutations name a `teamId`. The Host resolves the registered
  root from that row, so the renderer cannot pass an arbitrary path. The one
  exception is creating a new Team: a bootstrap needs its target root.

## Onboarding

`team.bootstrap.plan` is a dry run. It reports ordered steps and preflight
checks and writes nothing. `team.bootstrap.apply` re-plans, journals every step,
and compensates only objects created by that run when a step fails. A failed run
can be resumed (`team.bootstrap.resume`) or rolled back
(`team.bootstrap.rollback`); success runs `team doctor` and returns its result.

The form accepts:

- Team name, display name, and root;
- PM names;
- repos as `name=clone:<url>`, `name=link:<path>`, or `name=<path>`;
- engineers as `name:pm:repo[:normal|vibe]`;
- rooms as `name=shared`, `name=pm:<pm>`, or `name`.

## Overview

- Add a PM (`team.pm.add`), bind a repo to a PM (`team.repo.bind`), and add an
  engineer (`team.engineer.add`) against the selected Team.
- Doctor shows every check with its real id/detail; errors and warnings stay
  visible.
- Bootstrap runs show status and step progress; resume/rollback act on the
  journal run id.

## Tasks

The queue is the durable Team work queue, not a per-session todo.

- Create a task with a key, title, PM, optional assignee, and `REQ-*` ids.
- The queue status decides the offered actions: `pending` → assign/claim/cancel;
  `claimed` → renew/release/submit/cancel; `review` → approve/reject/cancel.
- A claim is a compare-and-set lease. The lease expiry and remaining seconds are
  shown; an expired lease is visible, not hidden. Submit moves the task to
  `review`, approve moves it to `done`, reject returns it to `pending` with a
  reason.
- A wrong PM or engineer is rejected by the service; the pane shows the
  service message. Offline is a graph/liveness fact, not a task status: the task
  lease is the queue's only liveness signal.

## Rooms

- Create a room with a kind (`coordination`, `pm`, or `room`) and real members.
  A PM room keeps its owning PM; a coordination room can start with every
  PM/engineer the Team has.
- Add or remove members and switch kind after creation. The service keeps the
  PM owner rule.
- Events are read incrementally by host `seq`; posting appends a real
  `room_events` row and the pane merges only new sequences.
- A member subscription exposes `acceptedThrough` and `readThrough`; ack only
  advances the read cursor through an accepted sequence. Delivery to an offline
  member stays pending for its next start; the pane does not pretend it read.

## Graph

The Graph tab is the existing `team.graph.get` relationship view over the real
Team rows plus the live main-agent registry. The Team root is an ownerless
boundary; PM workspaces, repos, bindings, engineers, worktrees, DB rooms,
membership edges, and Secretary spawn edges are real producers. There is no
character, persona, or emotion node.

## Boundary

This is local single-user collaboration. There are no accounts, passwords,
tokens, or auth checks: a PM/engineer id is a Team row, not a credential. IM
binding and chat are a separate product surface; an IM chat subpage must read
the canonical session history and existing bindings, not a copied transcript.
