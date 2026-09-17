# Remote Workspaces & IM Relay

When IM channels are enabled (`zeta serve`, desktop app, or `--channels`), the
**coordinator** session of the default workspace receives every inbound chat
message. From an ordinary IM chat (WeChat / Feishu / Telegram — plain text
only) you drive Zeta with the `!` command grammar below.

## Roles

- **Coordinator / Relay** (alias `main`, session name "Zeta Bot (Relay)") — the
  default workspace's agent. It is the shared relay: unbound messages land
  here, it may delegate subtasks to other workspaces with the `workspace_run`
  tool, and it can push to you via `channel_send`. Its conversation is a
  **persistent session** (`~/.zeta/agent/sessions/<cwd>/zeta-bot.jsonl`) that
  shows up in the web session list and survives restarts. It is registered in
  `web.yml` as the `relay` bot session and can never be deleted.
- **Bot sessions** — additional default-space sessions (tags `bot` / `draft`)
  created with `!session new`. Each has its own transcript and context. The
  relay session is shared by every unbound chat; a bot session is what one
  chat uses while it is pointed at it (`!session use`).
- **Workspaces** — other repositories registered with an alias. Each runs its
  own agent session in its own directory. They never message you directly;
  their replies return to the coordinator (unless the chat is bound direct).

## Routing

Every inbound message resolves to a target:

1. A runtime override from `@workspace use <alias>` / `*<alias>` (this chat),
2. A persisted per-chat binding from `@workspace bind <alias>`,
3. A channel default workspace (`channels.<id>.workspaceRoot` in `web.yml`),
4. the chat's active bot session (`!session use <id>`),
5. otherwise the relay coordinator (`main`).

A bound chat is **direct mode**: messages go straight to the bound workspace
and its reply returns to you. A chat pointed at a bot session talks to that
session's own context. Everything else is **relay mode**: the coordinator
decides (reply directly or delegate via `workspace_run`).

## Command reference

Both `@workspace` and `!workspace` prefixes work. **On Feishu use `!workspace`**
— `@` is reserved for user mentions there. Full-width punctuation from Chinese
input methods (`！`/`＠`/`＊`/full-width space) is auto-normalized, so grammar
is IME-independent.

### System commands (no tokens)

```
!hello / !helo              — verify binding: replies with the platform name
!help                       — full categorized reference
!status                     — channels, current routing, workspaces, language, model
!lang <zh|en>               — set this chat's reply language
!session list               — list default-space sessions ({n} [id])
!session new <name>         — create a new default-space session (draft)
!session use {n}|[id]       — switch this chat to a session (relay goes back to relay)
!session rename {n}|[id] <name>
!session delete {n}|[id]    — delete a session (the relay session is protected)
!model                      — list available models by number ({p-m})
!model {p-m}                — switch this chat's model (e.g. !model {1-1})
!workspace list             — workspaces + their sessions, numbered ({n} [alias], {n-m} [session])
```

### Workspace management

```
!workspace help (or @workspace)   — usage
!workspace list                   — workspaces + this chat's binding + each workspace's sessions
!workspace open <path> [alias]    — register a directory (alias = folder name by default)
!workspace create <path> [alias]  — mkdir -p + register
!workspace close <alias>          — unregister + stop the session
!workspace rename <old> <new>     — rename an alias
!workspace use <alias>            — direct mode: talk to that workspace now
!workspace relay                  — switch back to the relay coordinator
!workspace bind <alias>           — persist this chat → workspace binding
!workspace unbind                 — remove this chat's binding (back to relay)
!workspace bindings               — list bindings for this platform
*<alias>                          — shorthand for !workspace use <alias>
*relay / *back / *main            — shorthand for !workspace relay
```

### AI commands

```
!work workspace:<alias> <task>   — run a task directly in that workspace
!work <task>                     — run a task in the current bound workspace (or relay)
!plan <task>                     — produce a plan; reply 1-4 to approve
!draft <task>                    — run a one-off task in a fresh draft session
```

Listings use `{n}` numbers and `[name]` names — pass them back verbatim in
follow-up commands (e.g. `!session use {2}`, `!model {1-1}`).

## Natural-language control

The coordinator (and each bot session) exposes the `im_control` tool: when you
ask — in any language — to manage workspaces / sessions / language / model
(e.g. "把语言改成英文", "用 web 仓库干活", "新建一个会话叫 test", "列出所有模型",
"切到会话 2"), the agent calls it and relays the result. It reuses the same
`{n}`/`[name]` listings and the same operations as the `!` commands; no special
syntax needed, and ordinary task messages are never treated as control
intents.

## Models (`!model`)

`!model` prints available models grouped by provider with stable numbering
(`{p-m}`); `!model {1-1}` switches this chat's target session (bot session, or
the relay) to that model. Provider and model ids render as `[provider]` /
`[model]`. Numbering is alphabetical and can shift after the model registry
refreshes — always check the latest `!model` output.

## Default-space sessions

`!session` manages extra default-space conversations beyond the shared relay.
Each session has its own `.jsonl` transcript under
`~/.zeta/agent/sessions/<cwd>/<name>-<id>.jsonl`; switching (`!session use {n}`)
changes where that chat's messages go — history stays on the machine, per
session. Deleting a session removes its transcript and any chat referencing it
falls back to the relay. The `relay` session is the coordinator's transcript
and **cannot be deleted**.

Session files are tagged (`relay` / `bot` / `draft`) in the web session list.
The web sidebar hides relay/bot sessions by default; toggle **Show hidden bot
sessions** in the Web settings tab (saved to `web.yml remote.showBotSessions`)
to show and label them.

## Language (`!lang`)

`!lang zh|en` sets a per-chat reply language. For a bot session the directive
is appended to that session's system prompt; for the shared relay session it
is injected as a `[Language: zh-CN]` / `[Language: en]` prefix on the message.

## Models (`!model`)

`!model` prints available models grouped by provider with stable numbering
(`<provider>-<model>`); `!model 1-1` switches this chat's target session
(bot session, or the relay) to that model. Numbering is alphabetical and can
shift after the model registry refreshes — always check the latest `!model`
output.

## Relay delegation (coordinator tools)

- `workspace_run { workspace: "<alias>", task: "…" }` — the coordinator
  injects the task into the target workspace's session (same IRC path as an
  inbound IM message), waits for that session's final reply, and returns it
  prefixed with `[<alias>]`. Delegation is **sequential**: one `workspace_run`
  at a time, so the coordinator can delegate to A, then B, then C and
  summarize — it never fans out concurrently.
- `channel_send { text, to?, channel? }` — the coordinator pushes a message
  to you; `channel`/`to` default to the chat the current turn came from, and
  can target another platform explicitly.

## Plan approval (`!plan`)

`!plan <task>` starts plan mode on the chat's target session (a bot session if
one is active, else the relay coordinator). The finished plan is delivered as
an image (text fallback) with instructions `回复 1 执行 / 2 压缩后执行 / 3 新会话
执行 / 4 取消`. A 1-4 reply approves against **the session that produced the
plan**, with a 30-minute expiry. The same plan also appears in the web UI's
PlanApproval card for the session — approving there uses the same
`plan_approve` path.

## Persistence

`web.yml` stores registered workspaces (`remote.workspaces: [{alias, path}]`),
per-chat bindings (`remote.sessionMappings: [{platform, chatId,
workspaceAlias, mode}]`), the default-space bot-session registry
(`remote.botSessions: [{id, name, tag, sessionFile, …}]`), and the sidebar
toggle (`remote.showBotSessions`), so all of it survives restarts.
`@workspace use` is a runtime-only override; `@workspace bind` and `!session`
operations persist.

## Remote access

The serve process binds `127.0.0.1` by default. Binding to a non-loopback
address (via `ZETA_SERVE_HOSTNAME`) logs a prominent warning: you **must**
configure `remote.token` in `web.yml`, or every API request from a
non-loopback host is rejected by the access gate.
