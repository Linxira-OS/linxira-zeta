# Remote Workspaces & IM Relay

When IM channels are enabled (`zetacode serve`, desktop app, or `--channels`), the
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
plan**, with a 30-minute expiry. Any attached surface (the deferred Web UI
once it ships, or a companion client) can show the same plan; approving there
uses the same `plan_approve` path.

## Persistence

`web.yml` stores registered workspaces (`remote.workspaces: [{alias, path}]`),
per-chat bindings (`remote.sessionMappings: [{platform, chatId,
workspaceAlias, mode}]`), the default-space bot-session registry
(`remote.botSessions: [{id, name, tag, sessionFile, …}]`), and the sidebar
toggle (`remote.showBotSessions`), so all of it survives restarts.
`@workspace use` is a runtime-only override; `@workspace bind` and `!session`
operations persist.

## Remote access

Phone-first access is served by the same `zetacode serve` process. Nothing
leaves your machine except the requests your phone makes to the endpoint you
choose — bring your own port mapping, tunnel (frp, Tailscale, Cloudflare
Tunnel), or reverse proxy.

```bash
# loopback only (default): open http://127.0.0.1:30141
zetacode serve

# LAN/WAN bind — requires a remote token, and TLS unless you opt out:
zetacode serve --host 0.0.0.0 --tls-cert ./cert.pem --tls-key ./key.pem

# behind a TLS reverse proxy (proxy terminates TLS, zeta stays plaintext on
# a private interface — the proxy recipe below is the secure path):
zetacode serve --host 127.0.0.1
```

### Bind source order

`--host` → `remote.host` (`web.yml`) → `ZETA_SERVE_HOSTNAME` → `127.0.0.1`.
The same value is printed in the startup banner and recorded in
`~/.zeta/serve.json`; discovery/reuse compares that URL, so a plaintext and a
TLS instance of the same port are distinct.

### TLS

`--tls-cert` / `--tls-key` (or `remote.tls.cert` / `remote.tls.key` in
`web.yml`, or `ZETA_SERVE_TLS_CERT` / `ZETA_SERVE_TLS_KEY`) turn the main
listener into `Bun.serve({ tls })`. Both files must exist or serve refuses to
start. `--tls` / `remote.tls.enabled` force TLS and refuse to start without a
certificate/key pair — useful to catch a missing mount in a service unit.

A non-loopback bind is **refused** when it would be plaintext, unless you pass
`--allow-plain-http` (or set `remote.allowPlainHttp: true`). That is the "never
silent plain HTTP beyond the LAN" rule: the token travels in a header, so
plaintext exposure is a deliberate own-network choice. The startup banner
warns when it is used.

`remote.publicUrl` (e.g. `https://zeta.example.com`) names the URL phones
should use when you are behind a proxy or tunnel; the pairing QR uses it.
It is never used for binding.

### Pairing a phone

Settings → Web → **Remote Access** → **Show QR**. The gateway builds
`https://<reachable host>:<port>/#zeta-token=<token>` and renders it with the
dependency-free QR encoder. Scanning it opens a browser surface for the
gateway; while the Web UI's development is deferred, the web port answers the
placeholder page, and the token flow applies once a Web UI build is present.
The token is stored in `localStorage` and removed from the address bar before
the first API call.
The QR is only shown to an authenticated caller (loopback or a valid token)
and the response is `no-store`.

- **Rotate token** mints a new 32-byte token, writes it to `web.yml`, and
  records the old one's SHA-256 in `remote.revokedTokens`. The old token is
  rejected immediately (401) — every paired device must scan the new code.
- **Revoke token** disables remote access: it adds the hash to
  `remote.revokedTokens` and clears `remote.token`, so non-loopback callers
  get 401 until a new token is configured.

Token checks are hash-compared against the revoked list as well as the active
token, so a config file that still shows an old value cannot re-enable it.

### Access gate and rate limiting

The gate keys on the **socket peer address**, never the client-supplied `Host`
header:

| Caller | Result |
| --- | --- |
| loopback (`127.0.0.1`, `::1`, `localhost`) | passes, local UI/desktop |
| non-loopback + valid, non-revoked token | passes |
| non-loopback + missing/wrong/revoked token | **401** + `WWW-Authenticate: Bearer` |
| cross-site `Origin` from an unauthenticated loopback browser | **403** (CSRF guard) |
| peer with ≥10 failed attempts in 60 s | **429** + `Retry-After: 60` |

The limiter is per-peer, in-memory (a serve restart clears it), and blocks
even a correct token while active — brute-forcing cannot use the rate limit
as an oracle. A successful authentication clears that peer's history.

### Reverse-proxy recipes

Caddy (automatic certificates, WebSocket/SSE pass through):

```caddyfile
zeta.example.com {
	reverse_proxy 127.0.0.1:30141
}
```

nginx:

```nginx
server {
	listen 443 ssl http2;
	server_name zeta.example.com;

	ssl_certificate     /etc/letsencrypt/live/zeta.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/zeta.example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:30141;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_buffering off;        # SSE: /api/agent/:id/events
		proxy_read_timeout 1h;
	}
}
```

SSE (`/api/agent/:id/events`, `/api/tracking/events`) requires buffering off
and a long read timeout; do not enable gzip on `text/event-stream`. Leave
`remote.token` configured even behind a proxy: the proxy adds TLS, not
authentication.

### Mobile behavior

- History loads send `?deferMedia`, so screenshots arrive as
  `/api/blobs/<sha256>` URLs and are fetched per image only when they scroll
  near the viewport (through authenticated `fetch`, then rendered from an
  object URL). The SSE stream stays text-first; images the agent generates
  during a turn render as they arrive.
- A Web UI build (deferred; not shipped today) carries a manifest + service
  worker: installable to the home screen with an offline shell page. `/api/*`
  is never cached. Registration only happens in a production build over HTTPS
  (or localhost).
- Voice input uses the phone's own IME; no extra permission is requested.

