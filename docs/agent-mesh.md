# Cross-workspace agent messaging (the mesh)

Zeta agents mostly talk to each other inside one process: a session's main
agent messages its subagents over the in-process bus, and `agent://<id>`
addresses them by id. The **mesh** extends that same model across processes on
one machine, so the main agent of workspace A can message the main agent of
workspace B even when B is a different `zetacode serve` process.

It is one data model, not a second messaging system: `hub send`, `agent://`
writes, `ctx.messaging`, and the IM commands all resolve through the same
address, and offline messages land in the same per-agent inbox.

## Addressing

A cross-process address is `<workspace>/<agent>`:

| Form | Example | Resolves by |
|---|---|---|
| Workspace id | `3f9c2a1b7d4e/Main` | `sha1(realpath(workspaceRoot))[:12]` |
| Workspace alias | `zeta/Main` | alias from `web.yml` `workspaces`, or the alias a live process advertises |
| Directory name | `zeta-repo/Main` | basename of the workspace root |

- A bare id such as `Main` is **in-process only**, exactly as before.
- `agent://main` (any case) names the main agent of *the caller's own
  workspace*: the workspace's first root session, which keeps `Main` in a lone
  process. Additional top-level sessions in one process each own a distinct id
  (their session id), so they no longer displace each other. A caller that is
  itself that main gets a self-send error; a workspace whose main lives in
  another process resolves `<workspace-id>/main` over the mesh.
- Several workspaces can share a directory name. Addressing by that name then
  fails with an explicit *ambiguous* error listing the candidates — the mesh
  never picks one.
- Unknown workspaces report the workspaces/agents it can see.

The sending agent's address is qualified automatically, so the recipient can
reply to the address it received in `from`.

## Sending

Everything that already sends peer messages works unchanged:

```text
hub(op="send", to="zeta/Main", message="where is the build script?")
hub(op="wait", from="zeta/Main", ...)          # reply arrives as a normal message
write(path="agent://zeta/Main", content="...")
```

`send` returns one of:

- `injected` / `woken` / `revived` — the peer process accepted the message over
  its loopback endpoint (same meanings as in-process delivery);
- `queued` — the peer is offline (its process exited, or the agent is parked).
  The message is written atomically into its mailbox and a wake is attempted;
  it is injected when that agent next starts or is woken.

`queued` is not lost mail. It is durable: one file per message, injected in
`sentAt` order, then moved to `delivered/`. A message id is injected at most
once even if delivery is retried. Mail for a workspace whose process has been
gone for more than 30 days is evicted and the eviction is logged.

A workspace hosted by the **same process** (for example a `serve` process that
opened a second repository) is delivered locally, even when the address carries
its workspace prefix. It is not an offline peer, so nothing is queued into a
mailbox.

## Messaging rules

### Subagents message only their spawning main

A subagent may message exactly one peer: the main agent that spawned it
(nested subagents walk up the parent chain to that root main). It can never
message another main, another subagent, or an address in another workspace.
Broadcast is not available to subagents. The delivery path enforces this, so
the restriction is not just a tool-prompt convention.

A subagent message to its spawning main is always delivered, even when that
workspace's gears are `closed`: the rule above is the only permission a
subagent has.

### Workspace gears

Main agents have two independent gears, stored **per workspace** in the project
settings layer (`.zeta/settings.json` or `.zeta/config.yml`):

```yaml
mesh:
  inboundGear: closed   # may others call me?
  outboundGear: closed  # may I call others?
```

The gears, from closed to open:

| Gear | Outbound: may call | Inbound: accepts |
|---|---|---|
| `closed` | nothing outside the workspace | nobody outside the workspace |
| `repo-main-agents` | the default workspace's main agent | the default workspace's main agent |
| `repo-all` | main agents of any workspace | main agents of any workspace |
| `cross-repo-except-default` | any agent of another repository, except the default workspace's subagents | any agent of another repository, except the default workspace's subagents |
| `open` | every workspace, including the default workspace's subagents | every workspace, including the default workspace's subagents |

Both directions must permit a call: the sender's outbound gear **and** the
target's inbound gear. A permissive sender therefore cannot bypass a `closed`
target. Same-workspace messaging is structural — a main may always reach its
own subagents, and a subagent may always reach its spawning main.

Every repository starts `closed` in both directions. The **default workspace**
(`~/.zeta/workspace`) runs `open` in both directions, so it may call everyone
and everyone may call it. A repository that only accepts `repo-main-agents`
still accepts the default workspace's main agent; a `closed` repository accepts
nobody.

Gears are advertised in the workspace's mesh directory record, so a sender can
fail fast with a clear error. The receiving process re-checks its own settings
on every direct delivery and every mailbox drain: tightening the inbound gear
drops mail that was queued under the old setting instead of injecting it later.

## IM bridge

From a bound chat (Feishu/WeChat/Telegram):

| Command | Effect |
|---|---|
| `@agent list` | Agents visible here — this workspace and every live peer — with role and status |
| `@agent use <id>` | Route this chat's later messages to that agent (wins over the workspace binding); no id clears the override |
| `@team <name>` | Route this chat to a team's host agent; an unknown team replies with the available teams |

The override follows the same precedence as `@workspace use`: runtime override
first, then the persisted chat binding, then the channel's default workspace.
`@agent use zeta/Main`, `@agent use zeta-main` (alias), and a bare local id are
all accepted; ambiguous or unknown ids are rejected with candidates.

## Files and lifecycle

The runtime plane lives under the config root, so processes that share a config
root discover each other automatically:

```
<config>/run/mesh-<workspaceId>.sock      # POSIX; Windows uses a named pipe
<config>/run/mesh/<workspaceId>.json      # directory record + heartbeat (10s)
<config>/run/mesh/<workspaceId>.token     # 0600 handshake token
<config>/mailboxes/<workspaceId>/<agent>/ # offline mail + delivered/
```

- Endpoints are loopback-only; POSIX sockets are `0600`. On Windows named pipes
  are machine-global, so the pipe name includes a digest of the mesh root and
  the handshake token (readable only by the owner) is the access control.
- A process writes its record at start, refreshes it every 10 s, and removes it
  on clean exit. A record whose heartbeat is older than 60 s, or whose pid is
  gone, is reported `gone` and deleted during the next enumeration.
- Envelopes are capped at 1 MiB and carry a protocol version; `to` addresses
  containing path fragments are rejected.
- Two `serve` installs with **different** config roots can share one plane by
  setting `ZETA_MESH_ROOT` to a common directory.

## Mutual waiting

If A waits for a message from B while B waits for a message from A, blocking
both would deadlock. The wait returns `peer-waiting-on-you` instead: answer the
peer, then wait again. Both agents stay usable.

## Limits

- Single machine only. Cross-machine tunnels are out of scope; a remote
  workspace may only use a `tcp://` endpoint in a later release, and only when
  `remote.token` is configured.
- No agent migration and no per-agent permissions — gears are per workspace, and
  the existing YOLO default applies unchanged inside a workspace.
- A process that does not join the mesh keeps exactly the old single-process
  behavior; no message path changes when the mesh is absent.
