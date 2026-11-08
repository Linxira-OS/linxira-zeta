# Stream: Livestream Your Terminal

`zetacode stream` broadcasts your Zeta sessions to a live page served by a compatible stream server you host and configure in `stream.serverUrl` — a Twitch-style page with the live terminal and a chat column. **No hosted stream service ships with Zeta, and there is no default URL**: without `stream.serverUrl` (or `--server`), `zetacode stream` refuses to start. Viewers see exactly what your terminal shows (minus secrets); they cannot type into the session.

Stream sends rendered screen rows, one way, to an audience; it does not replicate the session or let viewers drive the agent.

## Quick start

Streaming needs a compatible stream server and a bearer credential it accepts. Zeta ships no server implementation and no hosted service, so point `stream.serverUrl` (or `--server`) at a server you run. The current wire implementation authenticates with a Stencil bearer: sign in once from any Zeta session with `/login` → **Stencil (invite only)** if your server verifies Stencil tokens; the credential is stored with your other logins and refreshed automatically. For scripts and local development, `STENCIL_API_KEY=<token>` overrides the stored credential; `STENCIL_AUTH_URL` re-bases the sign-in (`auth.stencil.so`) and `STENCIL_BASE_URL` the Stencil API (`api.stencil.so`) at a local server.

Your Stencil username is the channel. The server derives it from the bearer token, so `zetacode stream` takes no channel argument.

In the directory you work in:

```
zetacode stream --title "Refactoring the parser"
```

prints

```
● https://stream.example.com/your_username  "Refactoring the parser"
  waiting for sessions in /work/proj …
```

Then start an interactive `zetacode` session in the same directory from another terminal (as many times as you like). Each interactive session started while `zetacode stream` runs attaches automatically and shows `● LIVE 3` in its footer (`3` = current viewers). The viewer page shows each session as its own pane; a pane disappears when its session exits. Ctrl-C in the streamer ends the broadcast and every attached session drops its badge.

Sessions that were already running before `zetacode stream` started are not attached — restart them.

Only one `zetacode stream` process can listen for a given directory, and the server rejects a second live host for the same channel. If the remote connection drops, the streamer reconnects and replays each pane's current viewport and bounded history; it does not replay missed chat.

### Streamer console

On a terminal, `zetacode stream` is a full-screen chat console: header with the live badge, channel, title, your stencil.so handle, viewer URL, viewer count and attached panes; a log of chat and events; and an input line at the bottom.

| Input            | Effect                                                 |
| ---------------- | ------------------------------------------------------ |
| `<text>` + Enter | Send a chat message as the channel owner               |
| `/title <text>`  | Change the stream title                                |
| `/quit`, Ctrl-C  | Stop streaming (sessions detach, channel goes offline) |
| Up / Down        | Recall previous messages                               |

`--no-tui` (or a non-TTY stdout/stdin) falls back to a line log where stdin lines are chat (`/title` is still recognized; `/quit` is TUI-only). Ctrl-C stops either console.

### Options and settings

| Flag / setting          | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| Channel                 | Your Stencil username, derived by the server from the bearer token       |
| `--title <text>`        | Stream title (default: directory name; maximum 120 characters)           |
| `--server <url>`        | Stream server base (default: `stream.serverUrl`)                         |
| `--no-tui`              | Line-log console instead of the full-screen chat                         |
| `STENCIL_API_KEY`       | Bearer token override; otherwise the `/login` Stencil credential is used |
| `stream.serverUrl`      | Base URL of your compatible stream server (required; empty by default — no hosted service ships) |
| `stream.redactPatterns` | Extra regular expressions masked from every streamed row                 |

## What leaves the machine

The screen feed contains terminal rows and pane metadata (title and dimensions), not session entries. Chat is a separate message channel. The session process:

1. Takes the rows the TUI just painted (scrollback commits and the live viewport).
2. Strips every escape except text styling (SGR) and hyperlinks (OSC 8); inline images become `[image]`.
3. **Redacts** the row (below).
4. Diffs against the last sent viewport and sends row patches — never session entries, prompts, tool arguments, or file contents as data.

Rows cross a private local Unix socket (`0600`, under the per-directory Zeta runtime dir; a named pipe on Windows) to the `zetacode stream` process, which multiplexes sessions into panes and forwards JSON screen frames to the server over WSS by default. Custom `http`/`ws` servers use unencrypted WS. The server keeps each pane's viewport and the last 2000 history rows in memory so late viewers get a snapshot; nothing is persisted.

### Redaction

Redaction is irreversible and intentionally over-matches. Any match replaces the run with `••••••`; a row with a match is sent unstyled. Sources:

- Values of environment variables whose names look secret (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*PASSWORD*`, …) and every value loaded from a `.env` file for the directory, regardless of name (8+ chars).
- `.zeta/secrets.yml` and `~/.zeta/agent/secrets.yml` entries.
- Credential shapes (GitHub/GitLab/OpenAI/Anthropic/AWS/Slack/Stripe/npm/HF tokens, JWTs, PEM blocks, `Bearer …`). Vendor prefixes are matched **without** a length gate so a token is masked while it is still being typed or streamed character by character.
- `NAME=value`, `NAME: value`, `"NAME": "value"` where `NAME` looks secret — the value is masked (covers `read .env` and config files on screen).
- Passwords in connection URLs (`scheme://user:password@host`).
- `stream.redactPatterns`.

Known plain values are also matched by prefix (6+ characters) so a partially typed secret is masked before it is complete.

Redaction cannot know about secrets it has never seen: a token pasted from elsewhere that matches no shape and no configured value is shown. Use `stream.redactPatterns` or `secrets.yml` for anything unusual. Editing `stream.redactPatterns` during a live session reloads the redactor and repaints its viewport; it cannot retract previously sent rows. Chat messages are sent separately and are not passed through terminal-row redaction.

## Recording

`/record` in any interactive session captures that one session's screen through the same pipeline — normalized, redacted rows, viewport patches, scrollback commits — into a local file instead of a socket. No account or streamer is needed, and it works alongside a live stream. The footer shows `● REC` while recording; `/record` again stops it and prints the path.

Recordings are written to `<tmpdir>/zeta-recordings/<utc-time>-<session>.zetacast`, a JSON Lines file similar to asciicast: a header line `{"zetacast":1,"cols":…,"rows":…,"title":…,"createdAt":…}`, then one `[ms, frame]` line per screen frame (`reset`, `history`, `resize`, `viewport`, `patch`).

```
zetacode play                      # newest recording
zetacode play <file> -s 2 -i 1     # 2× speed, pauses capped at 1s
```

Playback requires an interactive terminal and runs on the normal screen: the recorded viewport occupies the bottom of the terminal and recorded scrollback scrolls into your terminal's scrollback, so the output stays after playback ends. Space pauses/resumes; `q`, Esc, or Ctrl-C quits.

### Clips

```
zetacode clip                                          # newest recording
zetacode clip <file> -t "Streaming the lexer" -d "…"   # title and description
```

`zetacode clip` and `/record --upload` are unavailable in Zeta: no upload server ships, so recordings stay local for `zetacode play`. The command still resolves `stream.serverUrl` and a Stencil credential, but with neither a configured compatible server nor a hosting implementation it cannot send anything.

## Server

Zeta ships no stream server and no hosted page; `zetacode stream` is a client for a compatible server you run at `stream.serverUrl`. The wire shapes live in `@linxiraos/pi-wire/stream`: the client opens a host socket (`/ws/host` after the base URL), viewers connect to `/ws/watch/<channel>`, and the channel is derived from the bearer credential. Your server decides how channels are named, how viewers authenticate, and what the viewer page looks like; nothing is persisted by the client.

The current client authenticates with a Stencil bearer (`Authorization: Bearer …` on the host socket). A compatible server verifies it against the issuer's JWKS (`LIVE_ISSUER`, `LIVE_TOKEN_AUDIENCE`) or, for local development, a static `LIVE_DEBUG_TOKENS` list paired with `STENCIL_API_KEY`. Viewers stay anonymous.
