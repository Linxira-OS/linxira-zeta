# CLI reference

`zetacode` is invoked as:

```sh
zetacode [command] [flags] [messages...]
```

When the first positional argument is **not** a registered subcommand, `zetacode`
normally routes to the default [`launch`](#launch-the-default-command) command.
So `zetacode "fix the build"` launches a session with that message, while `zetacode models`
runs the `models` subcommand. Bare plugin-management words such as `marketplace`,
`uninstall`, or `extensions` instead produce a hint to use `zetacode plugin …`;
use `zetacode launch <word>` when such a word is the intended prompt.

A recognized subcommand can follow leading launch flags. Those flags are
forwarded to `launch` and `acp`, but recognized launch-only flags before other
subcommands are stripped, not applied (for example, `zetacode --cwd dir update`).

`--profile` is applied before subcommand routing, so it also scopes commands
such as `config`, `models`, and `update`.

Runtime help is also available:

- `zetacode --help` lists user-facing subcommands and common launch flags.
- `zetacode <command> --help` prints that command's public flags and examples.

This page is the consolidated reference for the shared **launch surface** (the
flags accepted by `zetacode` / `zetacode launch`) and every top-level **subcommand**.
Per-subcommand flags (for example `zetacode auth-broker --json`) are documented by
each command's `--help`.

## Launch (the default command)

`zetacode` and `zetacode launch` start a coding session. Positional arguments become the
initial message(s):

```sh
# Interactive session
zetacode

# Interactive session with an initial prompt
zetacode "List all .ts files in src/"

# Attach files/images to the initial message (prefix with @)
zetacode @prompt.md @image.png "What color is the sky?"

# Non-interactive: process the prompt and exit (headless / print mode)
zetacode -p "List all .ts files in src/"

# Continue the previous session
zetacode --continue "What did we discuss?"
```

Argument handling:

- `@<path>` attaches a file or image to the initial message.
- Outside protocol modes, non-TTY stdin is read to EOF automatically as prompt
  text; do not add a `-` marker. Piped input or a non-TTY stdin selects print mode
  when `--mode` is omitted. Without stdin text, an argv prompt or attachment is
  required.
- Stdin text, text attachments, and the first positional message are combined
  into the initial prompt; remaining positional messages are sent as later turns.
- `--` ends flag parsing; everything after it is literal message text, even if it
  looks like a flag.

### Launch flags

#### Session and workspace

| Flag | Description |
| --- | --- |
| `--cwd <dir>` | Directory to start in (overrides the launch cwd). |
| `--add-dir <dir>` | Add a workspace directory beyond the working directory (repeatable). |
| `--allow-home` | Allow starting in `~` without auto-switching to a temp dir. |
| `--profile <name>` | Use an isolated profile for auth, sessions, settings, and caches. |
| `--alias <name>` | Create a shell shortcut for a named profile and exit; requires `--profile` or `OMP_PROFILE`. |
| `--config <file>` | Load an extra `config.yml`-style overlay for this run (repeatable). |
| `--session-dir <dir>` | Directory for session storage and lookup. |
| `--no-session` | Don't save the session (ephemeral). |

#### Session history

| Flag | Description |
| --- | --- |
| `--continue`, `-c` | Continue the previous session. |
| `--resume [id]`, `-r`, `--session [id]` | Resume a session by ID prefix or path, or open the picker when no value is given. |
| `--restore [id]` | Resume a session as `--resume` does, then go on with what its last process left unfinished when it crashed or was killed: the interrupted turn and the subagents it was running. Interactive only; takes no prompt. See [session operations](./session-operations-export-share-fork-resume.md#cli---restore). |
| `--fork <session>` | Fork a saved session (by ID prefix or path) into a new session. See [session operations](./session-operations-export-share-fork-resume.md). |
| `--from-claude` | Import a Claude Code session into OMP. |
| `--from-codex` | Import a Codex session into OMP. |
| `--export <session>` | Export a session file to HTML and exit. |
| `--no-title` | Disable title auto-generation (equivalent to the `PI_NO_TITLE` [environment variable](./environment-variables.md)). |

`--continue`, `--resume`, `--restore`, `--fork`, and foreign-session imports require
persistence and cannot use `--no-session`. `--from-claude` and `--from-codex`
are mutually exclusive and cannot be combined with `--continue`, `--resume`,
or `--fork`.

#### Model selection

| Flag | Description |
| --- | --- |
| `--model <id-or-role>` | Model or configured role to use (role: `slow` or `@slow`; fuzzy model match: `opus`, `gpt-5.2`, or `openai/gpt-5.2`). |
| `--smol <id>` | Smol/fast model for lightweight tasks (or `PI_SMOL_MODEL`). |
| `--slow <id>` | Slow/reasoning model for thorough analysis (or `PI_SLOW_MODEL`). |
| `--plan <id>` | Plan model for architectural planning (or `PI_PLAN_MODEL`). |
| `--models <a,b,c>` | Comma-separated model patterns for `Ctrl+P` cycling. |
| `--provider <name>` | Provider to use (legacy; prefer `--model`). |
| `--api-key <key>` | API key (defaults to env vars). |
| `--provider-session-id <id>` | Reuse a specific provider-side session id for continuity and cache scoping. |
| `--prompt-cache-key <key>` | Override the provider prompt-cache key for this session. |
| `--service-tier <tier>` | OpenAI service tier: `none`, `auto`, `default`, `flex`, `scale`, `priority`, or `ultrafast` (`none` omits `service_tier`). |

See [providers](./providers.md) and [models](./models.md) for model resolution.

#### Thinking and reasoning

| Flag | Description |
| --- | --- |
| `--thinking <level>` | Set the thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `auto`. |
| `--hide-thinking` | Hide thinking blocks in TUI output (display only; does not disable model thinking). |
| `--print-thoughts` | Include thinking blocks in print-mode text output. |
| `--external-thinking` | Use a private scratchpad while disabling supported GPT/Claude/Gemini reasoning. Use at your own risk: providers have flagged this request shape as abuse. |

#### Prewalk and plan modes

| Flag | Description |
| --- | --- |
| `--prewalk` | Arm a one-shot handoff at the first eligible edit/write turn, gated on a successful todo call when `todo` is active (default off). See [prewalk](./prewalk.md). |
| `--no-prewalk` | Disable prewalk even if `prewalk.enabled` is set, and keep `prewalk.auto` out of the startup session; incompatible with `--prewalk`/`--prewalk-into`. |
| `--prewalk-into <id-or-role>` | Arm prewalk with this target instead of the `smol` role. |
| `--plan-yolo` | Start in read-only plan mode, auto-approve the model's plan proposal, then switch to the execution target to implement it. |
| `--plan-yolo-into <id-or-role>` | Target model for plan-yolo execution (default the `smol` role); requires `--plan-yolo`. |
| `--goal <objective>` | Start a fresh interactive session in goal mode and begin working on the objective, without typing `/goal`. Requires `goal.enabled`; interactive only. Bypasses `autoResume`, and is rejected with a positional prompt, `@file` or stdin input, `--resume`/`--continue`/`--fork`/imports, `--plan-yolo`, `--no-tools`, or startup plan mode (`plan.defaultOnStartup`). |

#### Tools, approvals, and runtime

| Flag | Description |
| --- | --- |
| `--tools <a,b,c>` | Comma-separated list of tools to enable (default: all). |
| `--no-tools` | Disable all built-in tools. |
| `--no-lsp` | Disable LSP tools, formatting, and diagnostics. |
| `--no-pty` | Disable PTY-based interactive bash execution. |
| `--approval-mode <mode>` | Override `tools.approvalMode` for this session (`always-ask`, `always-ask-cached`, `write`, or `yolo`). See [approval mode](./approval-mode.md). |
| `--auto-approve`, `--yolo` | Force yolo tier approval; explicit tool/user policies and provider safety checks still apply. |
| `--advisor` | Enable the advisor runtime (passively reviews each turn and injects notes). See [advisor / watchdog](./advisor-watchdog.md). |
| `--max-time <duration>` | Stop the session after this duration (e.g. `600`, `10m`, `1h`). |
| `--channels` | Host the IM channel runtime in this session; channels still need to be enabled in `web.yml`. See [IM channels](./channels.md). |

#### Extensions, hooks, skills, and rules

| Flag | Description |
| --- | --- |
| `--extension <path>`, `-e <path>` | Load an extension (repeatable). See [extensions](./extensions.md). |
| `--hook <path>` | Load a hook/extension file (repeatable). See [hooks](./hooks.md). |
| `--trusted-extension <abs-path>` | Exact allowlist of existing absolute module files (repeatable); disables ambient extension discovery and package-root sub-discovery. Cannot be combined with `--extension`/`-e`/`--hook`. |
| `--plugin-dir <dir>` | Add a local plugin directory to discovery (repeatable). |
| `--no-extensions` | Disable extension discovery (explicit `-e` paths still work). |
| `--skills <globs>` | Comma-separated glob patterns to filter [skills](./skills.md) (e.g. `git-*,docker`). |
| `--no-skills` | Disable skills discovery and loading. |
| `--no-rules` | Disable rules discovery and loading. See [context files](./context-files.md). |

#### System prompt

| Flag | Description |
| --- | --- |
| `--system-prompt <text\|file>` | Plain-text system prompt override (default: coding assistant prompt). See [system prompt customization](./system-prompt-customization.md). |
| `--system-prompt-template <path>` | Strictly read `<path>` as a Handlebars system-prompt template; mutually exclusive with `--system-prompt`. See [system prompt customization](./system-prompt-customization.md). |
| `--append-system-prompt <text\|file>` | Append plain text or file contents to the system prompt. |

#### Output mode

| Flag | Description |
| --- | --- |
| `--mode <mode>` | Output/transport mode: `text` (default), `json`, `rpc`, `acp`, or `rpc-ui`. See [output modes](#output-modes---mode). |
| `--print`, `-p` | Process prompts non-interactively and exit. |
| `--backend` | Force backend mode regardless of `backend.enabled`. An interactive launch creates a fresh backend session for this terminal (unless `--attach`/`--attach-session` joins one); print mode routes through the backend. In print mode, `--attach`, `--attach-session`, and `--attach-new` also force the backend route. |
| `--no-ui` | With `rpc`/`rpc-ui`, make extensions headless without disabling rpc-ui tool UI. |

#### Backend attach

`zetacode serve` hosts sessions for every gateway client — terminal attaches,
and the Web UI once a build is present (its development is currently
deferred; the package ships a placeholder page).

The two launch modes are explicit:

- **Bare `zetacode`** follows the machine-wide backend switch. With
  `backend.enabled` off (the default) it opens a pure local TUI: it owns its
  session in-process and never attaches to, or shuts down, a backend that
  happens to be running. With the switch on it becomes a client of the single
  default backend; if none is running, startup fails with a diagnostic.
- **`--attach` / `--attach-session` / `--attach-new` / `--backend`** explicitly
  select backend mode regardless of the switch. A matching backend is required:
  if none is reachable, startup fails instead of silently opening a second local
  session. `--backend-url <url>` also implies attach and pins discovery to that
  instance.
- **`--standalone`** forces a local process even when `backend.enabled` is on.
  It never registers, listens, or attaches, and can coexist with the backend.

A backend session is bound to the pair **(workspace directory, git branch)**:
`--attach` reuses the most recently modified session whose `cwd` and branch
match the current directory (creating one when that branch has none).
`--backend` is the direct-execution spelling: it creates a fresh backend
session for this terminal unless `--attach` or `--attach-session` explicitly
asks to join an existing one. `--attach-session <id>` may cross both; when its
branch differs from the current one the TUI warns which checkout the prompts
will edit.

Every live `serve` instance registers itself (the compatibility `serve.json`
plus a per-pid file under `~/.zeta/serve/`). Attach probes **every** registered
instance and refuses to guess:

- exactly one compatible instance → attach;
- an explicit `--backend-url` → only that instance;
- `--attach-session <id>` → the instance that owns the session;
- more than one compatible instance → the one that already owns a session for
  the current `(cwd, branch)` wins;
- still more than one (or none owns the workspace) → startup fails and lists
  the instances (`pid`, version, URL), asking for `--backend-url` or
  `--attach-session`.

| Flag | Description |
| --- | --- |
| `--attach` | Attach the TUI to this directory's newest backend session. |
| `--attach-session <id>` | Attach to a specific backend session, across all repositories. |
| `--attach-new` | Create and attach to a fresh backend session in this directory instead of reusing one. |
| `--backend` | Run this launch directly on the backend. Creates a fresh backend session per terminal unless `--attach`/`--attach-session` is also given. Print mode routes through the backend too. |
| `--backend-url <url>` | Attach to that gateway URL; implies `--attach` (default discovery: `ZETA_GATEWAY_URL`, `ZETA_WEB_GATEWAY_PORT`, every live serve registration, then `http://127.0.0.1:43143`). |
| `--standalone` / `--local` | Force a local process even when `backend.enabled` is on. Cannot be combined with backend flags. |

`zetacode attach --list` prints every backend session across repositories
(id, `cwd @ branch`, modified time, name/status), `zetacode attach <id>` attaches the
plain terminal client, and `zetacode attach --new` creates a session in the
current (or `--cwd`) directory. Builtin slash commands with a headless handler
(`/compact`, `/fast`, `/rename`, …) execute on the backend; TUI-only commands
print a hint to use the full TUI instead of being sent to the model as text.

The TUI keeps its renderer: the backend session is mirrored into a local
replica so transcript replay, the status line, and dialogs behave natively.
Prompts, aborts, extension dialogs (`select`/`confirm`/`input`/`editor`/
`ask`), and plan approval travel over the session's RPC WebSocket
(`/api/rpc/ws`, the protocol in [rpc.md](rpc.md#websocket-transport)); the SSE
stream keeps mirroring turns and dialogs are presented once, whichever surface
sees the request first wins. A backend without the socket falls back to its
HTTP command surface. Client-only actions such as opening files and clipboard
writes stay local and are not forwarded. Commands that only touch the client
(`/language`, `/theme`, `/settings`, `/hotkeys`, `/tool`, `/time`, `/tracking`,
`/changelog`, `/stats`, `/git`, `/copy`, `/export`, `/dump`, `/help`, `/agents`,
`/extensions`, `/hub`, `/pause`, `/record`, `/open`, `/debug`,
`/quit`, `/exit`) run in the attached TUI exactly as they do locally, and the
replica switches that the attach link mirrors — `/model`, `/modelpreset`,
`/switch`, `/effort`, `/plan`, `/plan-ultra`, `/plan-review`, `/goal`,
`/vibe` — open their usual pickers and then send the matching wire command.
`/fast` and `/slow` are forwarded to the backend's headless handlers;
`/guided-goal` runs in the backend session: the backend exposes the goal tool, sends the hidden interview kickoff, and the attached TUI mirrors the interview state so bare `c` stays an answer instead of a mode shortcut.
`/skills`, `/tools`, `/context`, `/usage` and `/jobs` are also forwarded
because they act on the backend session. `/skills` and `/share` are prompt-only
entry points: explicit invocation injects the built-in guide, and
`/skills` install/update asks the agent to install in its own workspace.
`/status` no longer exists; use `/extensions`.
Every other slash command is **forwarded and executed
by the backend** with its own session — builtins that have a headless handler
(`/compact`, `/handoff`, `/session`, `/retry`, `/rename`, `/move`,
`/fresh`, `/share`, `/mcp`, `/memory`, `/marketplace`, `/todo`, `/dirs`,
`/add-dir`, `/remove-dir`, `/pin`, `/prewalk`, `/security`, `/plugins`,
`/forget-approvals`, `/wt`, `/skillful`, `/advisor`, …) plus custom commands
and prompt templates; the command's output (`command_output`) is printed in
the attached status line. `/queue <text>` and the `->`/`=>` shorthands land in
the backend's follow-up queue, and `/btw <question>` opens a side context on
the backend. Session lifecycle runs on the backend and re-attaches this client:
`/new` (fresh session), `/resume <id>` (existing session), `/fork`, `/branch`
and `/tree` (entry picker over the mirrored transcript), `/clear` (drop the
context, keep the session) and `/delete yes`. `/login` and `/logout` drive the
backend's OAuth providers and accounts. `/restart` defaults to the backend
while attached and asks the serve host to re-exec its original argv (the
gateway exposes `POST /api/server/restart`); `/restart client` re-execs this
TUI with its launch flags, and `/restart backend` is the explicit host form.
The client stream drops and reconnects with backoff when the new instance
answers. `/omfg`, `/cleanse`, `/tan` and `/seance` run on the backend session
through their headless handlers. `/setup` and its `/providers` alias are
retired: `/login` (or first-run onboarding) owns provider credentials.
`/collab`, `/join` and `/leave` are opt-in legacy collaboration; fresh
installs hide all three until `collab.enabled` is turned on. `/live` is
currently disabled product-wide: its only transport is OpenAI Codex realtime,
and a provider-agnostic layer has not landed. `/loop` runs on the backend session: its
repetitions, `--while`/`--until` shell condition, and `loop.mode`
compact/reset actions execute against that session, a second `/loop` stops it,
and Esc pauses it. The status line mirrors the backend loop state; a loop
never falls back to the client's default workspace.
Model and thinking-level switches
made in the attached TUI (for example `/model`) are mirrored to the backend, so
the run and the status line never disagree. Detaching closes the socket and the
event stream and never stops the backend or its session.

#### Information

| Flag | Description |
| --- | --- |
| `--help`, `-h` | Show help for `zetacode` or a subcommand and exit. |
| `--version`, `-v` | Print the installed version and exit. |

### Headless / print mode

`--print` / `-p` runs `zetacode` non-interactively: it processes the prompts, writes
the last assistant response to stdout, and exits without entering the TUI. Text
output is emitted after the turn completes, not token-by-token; a `Working...`
indicator goes to stderr. This is the entry point for scripting and automation.

```sh
# Print the answer and exit
zetacode -p "Summarize the changes in the last commit"

# Include the model's thinking blocks in the printed text
zetacode -p --print-thoughts "Explain your reasoning for this refactor"

# Machine-readable output for pipelines
zetacode -p --mode json "List every TODO in src/" > todos.json

# Pipe a prompt via stdin
echo "review this diff" | zetacode -p
```

Related flags for headless runs:

- `--print-thoughts` — include thinking blocks in the printed text output.
- `--mode json` — emit structured events instead of rendered text.
- `--no-title` — skip title auto-generation (also `PI_NO_TITLE`).
- `--max-time <duration>` — bound the run.

`--mode json` emits a session header followed by events as JSON lines.
Incremental `message_update` events omit full partial-message snapshots; completed
messages arrive in `message_end`, and opaque provider replay payloads are omitted.
Terminal turn failures produce a nonzero exit status in both text and JSON modes.

`plan.defaultOnStartup` is ignored in print mode because there is no plan-review
UI. Use `--plan-yolo` for unattended planning and implementation.

The [advisor / watchdog](./advisor-watchdog.md#headless-runs) doc describes
print-mode disposal semantics when the advisor runtime is enabled.

### Output modes (`--mode`)

| Mode | Description |
| --- | --- |
| `text` | Rendered text. Omitting `--mode` allows the TUI; explicit `--mode text` selects non-interactive text output. |
| `json` | Newline-delimited JSON event stream for headless/machine consumption; `-p` is optional. |
| `rpc` | Line-delimited JSON command/response/event transport over stdio (not JSON-RPC 2.0). See [RPC](./rpc.md). |
| `rpc-ui` | RPC transport with UI extension events enabled. |
| `acp` | Agent Client Protocol server over stdio. Equivalent to the [`acp`](#subcommands) subcommand; see [approval mode → ACP sessions](./approval-mode.md#acp-sessions). |

`--no-ui` (with `--mode rpc` or `--mode rpc-ui`) runs extensions headless: `ctx.hasUI` is `false`, extension dialogs resolve to defaults, and extension presentation updates are dropped. In `rpc-ui`, tool UI such as `ask` still sends `extension_ui_request` frames for the host to answer. Host-issued `login` UI is unaffected. See [RPC startup](./rpc.md#startup).

## Subcommands

Run `zetacode <command> --help` for each command's own flags and examples.

| Command | Purpose | See also |
| --- | --- | --- |
| `launch` | Start a coding session (the default command). | [Launch flags](#launch-flags) |
| `acp` | Run zetacode as an ACP (Agent Client Protocol) server over stdio. | [approval mode](./approval-mode.md#acp-sessions) |
| `attach` | Attach a terminal to a running session over the web gateway (`--list`, `--new`, `<session-id>`). | this page → [Backend attach](#backend-attach) |
| `auth` | Export or import stored provider credentials (API keys and OAuth logins) as JSON: `auth export` prints the document, and `auth import <file\|->` merges it into `agent.db`. | [providers](./providers.md) |
| `auth-broker` | Manage the zetacode auth-broker (credential vault). | [auth broker / gateway](./auth-broker-gateway.md) |
| `auth-gateway` | Run an auth-gateway: an HTTP forward proxy backed by the configured broker (`serve`), or JSON lines on stdin/stdout for a parent process with your own credentials (`stdio`). | [auth broker / gateway](./auth-broker-gateway.md) |
| `agents` | Manage bundled task agents. | [task agent discovery](./task-agent-discovery.md) |
| `anonymize` | Write a shareable copy of a session and its subagents: turn contents redacted, metadata kept, paths and literals replaced by consistent mock tokens (`-o` chooses the output directory). | [session operations](./session-operations-export-share-fork-resume.md) |
| `bench` | Benchmark models: TTFT/prefill vs decode throughput with p50/p95 across chat, prefill, generation, and prompt-cache workloads, rendered in a live dashboard (`--prefill-bytes` sizes the synthetic prefill input). `--detailed` runs single-user, `--par`-way parallel (aggregate tok/s and scaling), and prefill phases per model. | |
| `browser-relay` | Run the local CDP relay used by Eval's browser API to drive your own Chrome tabs. | [computer use](./computer-use.md) |
| `channels` | Inspect, pair, and toggle IM channels (WeChat/Feishu/Telegram) without a browser: `status`, `login wechat` (terminal QR), `login feishu --app-id … --app-secret …` / `login telegram --token …` (validate then save), `logout`, `enable`, `disable`; `--json` on every subcommand. | [IM channels](./channels.md) |
| `cleanse` | Detect and fix project diagnostics with weighted parallel subagents. | |
| `collab` | List active local Collab hosts without exposing URLs; `collab link <instanceId\|pid>` retrieves a control link (`--view` for view-only). Requires `collab.enabled` and a relay you control. | [collab](./collab.md) |
| `clip` | Clip uploads are unavailable in Zeta: no upload server ships, so `/record --upload` and `zetacode clip` refuse and recordings stay local (`zetacode play`). | [stream](./stream.md#clips) |
| `commit` | Generate a commit message and update changelogs. | |
| `completions` | Print a shell completion script (bash, zsh, or fish). | |
| `compress` | Rewrite a text file into the dense prompt register, reporting what it drops. | |
| `config` | Manage configuration settings. | [config usage](./config-usage.md), [settings](./settings.md) |
| `backend` | Machine-wide backend mode: `status [--json]`, `on [--workspace <dir>]`, `off [--timeout <s>] [--force]`, `logs`. `on` enables the switch and starts the one hidden backend in the default workspace; `off` disables new clients, drains running turns, then stops it. | [daemon](./daemon.md#backend-mode) |
| `daemon` | Low-level background backend: `status [--json]`, `start`, `stop`, `restart`, `logs`, `install-autostart`, `uninstall-autostart`. `install-autostart` installs a real per-user OS component (systemd user service+timer / Task Scheduler task, three-minute delay) and is bundled-app only; npm/source installs are refused. `backend.autostart` **and** `backend.enabled` gate the installed component. `serve` itself stays a foreground command. | [daemon](./daemon.md) |
| `dry-balance` | Dry-run OAuth account balancing across random session ids. | |
| `find` | Semantic search for implementing files and line ranges. | |
| `gc` | Run storage garbage collection. | |
| `grep` | Test the grep tool from the CLI. (The [`grep` tool](./tools/grep.md) is a separate agent tool.) | |
| `gallery` | Preview tool, composer, and status-line renderers in a deterministic gallery. | |
| `git` | Interactive fullscreen git UI: split diff viewer, staging sidebar, and commit composer. | |
| `grievances` | View, clean, or push reported tool issues (auto-QA grievances). | |
| `if-bench` | Benchmark instruction following and working memory: one cached thread of glyph array actions with a cat-sound directive that moves through the prompt. | |
| `images`, `img` | Inspect, diagnose, probe, and purge image publication backends. | |
| `install` | Install or link an extension package (alias of `plugin install` / `plugin link`). | [extensions](./extensions.md) |
| `join` | Join a shared collab session (same as `/join`); refuses to start while `collab.enabled` is off. | [collab](./collab.md) |
| `login` | Log in to a model provider from the terminal (counterpart of `/login`). | |
| `models` | List, search, and refresh available models. | [models](./models.md) |
| `plugin`, `plugins` | Manage plugins (install, uninstall, list, etc.); `plugins panel <plugin> <panel>` prints one declarative panel's data as a native host draws it. | [plugins](./plugins.md), [writing a plugin](./writing-a-plugin.md), [extensions](./extensions.md), [marketplace](./marketplace.md) |
| `play` | Replay a `/record` recording in the terminal; Space pauses and `q` quits. | |
| `predict` | Compare word-completion engines' live ghost text for a prompt. | |
| `ps` | List and control daemon-supervised background processes (logs, stop, kill, restart). | |
| `say` | Synthesize text with the local TTS engine and play it through the speakers. | [tts tool](./tools/tts.md) |
| `share` | Share a saved session via an encrypted link (same as the `/share` slash command). | [session operations](./session-operations-export-share-fork-resume.md) |
| `session` | Hand a session to another machine: `pack <session> <out.tar>`, `unpack <archive.tar> --cwd <dir>` (prints the session file path), or `moved <session> --to <label>` so resuming the local copy later forks. | [session operations](./session-operations-export-share-fork-resume.md) |
| `setup` | Run onboarding setup or install dependencies for optional features. | |
| `shell` | Interactive shell console. | |
| `read` | Show what the read tool will return for a path, URL, or internal URI. (The [`read` tool](./tools/read.md) is a separate agent tool.) | |
| `render` | Draw a session's entire thread through the production transcript pipeline (with repaint timing). | |
| `skill`, `skills` | Install, search, publish, and manage skills; extra skills come from the npm package `@linxiraos/linxira-skills` (`npm i -g @linxiraos/linxira-skills`), or a configured registry URL. | [skills](./skills.md#extra-skills-from-npm) |
| `ssh` | Manage SSH host configurations. | |
| `stats` | View usage statistics. | |
| `stream` | Broadcast local zetacode session screens and chat to a live channel; no server ships, so set `stream.serverUrl` to your own compatible server. | [stream](./stream.md) |
| `serve`, `server` | Start the Stats Dashboard and Web Gateway services without opening a browser (the Web UI port answers a placeholder while its development is deferred). `--host`/`--tls-cert`/`--tls-key` expose them (a non-loopback plaintext bind needs `--allow-plain-http`), `--channels` hosts IM channels, and `--stats-only`/`--web-only` narrow the services. | [serve and web](./zeta-serve-web.md) |
| `update` | Check for and install updates; `--canary`/`--stable` switch release channels. `--desktop` targets the `zetawork` desktop app instead of the CLI: `zetacode update --desktop --check` prints one JSON line (`current`, `latest`, `available`, `asset`, `url`, `size`, `digest`), and `zetacode update --desktop` downloads the Windows setup executable, verifies its SHA-256, and runs it silently. | |
| `usage` | Show provider usage limits for every authenticated account, flagging saved resets close to expiry; `usage clients` breaks token burn down per client (with `--days`), `usage invalidate` drops cached reports, `usage accounts` lists each OAuth account's provider and identity key (the key `task.agentAccountPools` and broker account pools take; no tokens, `--json` supported), and `usage reset` lists each Codex and Claude account's saved rate-limit resets by `<provider>/<credential id>` (`--json`, `--redact`) and `usage reset <provider>/<credential id>` spends one, also from an auth-broker client. | [Task agent discovery](./task-agent-discovery.md#model-and-structured-output-precedence), [saved resets](./settings.md#saved-reset-auto-consumption) |
| `tiny-models` | Download tiny local models for session titles, memory, and word completion. | [local models](./local-models.md) |
| `token` | Get the API key or OAuth token for a provider. | [secrets](./secrets.md) |
| `toks` | Count file or text tokens with the embedded offline tokenizers. | |
| `ttsr` | Inspect and test Time-Traveling Stream Rules (TTSR). (Covers the CLI command; the [TTSR feature](./ttsr-injection-lifecycle.md) is documented separately.) | |
| `worktree`, `wt` | Add, list, or clear git worktrees; uses clone-first behavior when enabled. | |
| `search`, `q`, `web-search` | Test web search providers from the CLI. | [web_search tool](./tools/web_search.md) |
| `__complete` | **Internal.** Emit shell-completion candidates for the current argv; hidden from help. `zetacode completions` prints the script that calls it. | [completions](#subcommands) |

> `install`, `join`, `browser-relay`, `auth-gateway`, and `tiny-models` are also
> reachable through related mechanisms (the `plugin` command, the `/join` slash
> command, and so on). The table lists each as it is registered in
> `packages/coding-agent/src/cli-commands.ts`.

`__complete` is the internal, hidden subcommand behind the shell-completion scripts printed by `zetacode completions`; it is not part of the public CLI surface.
