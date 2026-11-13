# Team in Work Studio

The Work Studio Team pane is the browser surface over the same Team database the
CLI and TUI use. It never keeps a second store: onboarding, PM/engineer/repo
state, rooms, events, tasks, leases, bootstrap runs, and doctor checks are real
`~/.zeta/data/zeta.db` rows read through the Team service.

## Entry

Work Studio's **Team** navigation route opens this workspace page; its Graph tab
is the existing `team.graph.get` view. There is no second Team page.

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

## IM chat

The IM chat tab reads the IM backend selector's candidate rows
(`GET /api/im/sessions`) while the tab is open; that selector is the single
authority for the stable `NN-NNNNN` number, the display name, and the latest
completed-task summary (so `!session list` and this tab cannot drift). The pane
does not re-derive a number from last activity, renumber after the three-day
window changes, scan transcripts per render, or show a raw session id. A
missing latest completed-task summary stays empty (an incomplete candidate
may say "in progress"); the first user message is never substituted. PM
candidates are hidden from the ordinary list by the selector; an explicit PM
binding stays a valid target because the pane renders whatever the backend
sent, including the `isPm` flag, and never filters by its own rule.

The selector already limits the list to the last three days. An empty list
says so and points earlier chats to desktop or remote Studio history; there is
no in-pane paging into older sessions.

Selecting a candidate reads its canonical persisted transcript
(`GET /api/sessions/:id`). Bubbles render the IM ingress's immutable
per-message route snapshot from `messageMetadata` (workspace, agent, binding),
so a reply that arrives after a `!workspace` switch still names the repo/agent
it was delivered to; messages without metadata render without an origin label.
`controlEvents` render the `switch_request` / `switch_confirm` / `switch_cancel`
handshakes recorded in the transcript. No second transcript store exists.

Binding/source display and switch confirmation call the IM router directly. The
pane resolves the selected candidate's `bindingId` through
`GET /api/im/bindings`, reads the live pending handshake from
`GET /api/im/switch` (router memory or the persisted `im_control` restore path),
and sends `POST /api/im/switch/confirm` / `POST /api/im/switch/cancel` with the
same chat identity and the router's `requestId`. It keeps no pending store of
its own and applies nothing optimistically: a confirmation is only shown
pending after a real switch request, and a failed confirm/cancel shows the
router's error. The tab displays the current and pending target plus the owner's
control-record id; a real switch needs a second confirmation, and cancel is
separate. Before confirmation ordinary messages still go to the old target;
after it they go direct to the new target. Context is not moved. This pane does
not add a second approval system, copy a transcript, or decide private/group
capability — the IM owner does.

Integration dependency: the candidate route, the per-message
`messageMetadata`/`controlEvents` transcript fields, and the
bindings/switch routes are owned by the IM integration. Until they are merged,
the Team tab reports the selector as not connected, hides binding controls it
cannot source, and never falls back to a locally derived number or a local
pending state. The candidate row shape currently has no `channel`; when the
selector adds it, the pane shows it.

## Boundary

This is local single-user collaboration. There are no accounts, passwords,
tokens, or auth checks: a PM/engineer id is a Team row, not a credential. IM
binding and chat are a separate product surface; an IM chat subpage must read
the canonical session history and existing bindings, not a copied transcript.
