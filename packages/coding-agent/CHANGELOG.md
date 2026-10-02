# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [1.1.22] - 2026-09-30
## [18.4.11] - 2026-10-02

### Added

- Added goal management for RPC hosts and optional automatic goal continuation via `goal.continuationModes: ["rpc"]`. RPC clients can create, inspect, pause, resume, and remove goals, and view the current goal in `get_state`.
- Added `--goal <objective>` for interactive launches to begin a new session in goal mode without requiring the `/goal` command.
- Added periodic completion estimates for running subagents, with configurable polling through `task.completionProbeMs` and progress displayed in wait and task views.

### Fixed

- Fixed skill-description and text-prediction data not respecting XDG directories; existing data is now migrated to `$XDG_DATA_HOME/omp` when applicable.
- Fixed subagent MCP calls ignoring the parent transport timeout, including configured `OMP_MCP_TIMEOUT_MS` and unlimited (`timeout: 0`) settings.
- Fixed fresh setups failing on the first turn when the automatically selected model did not support the configured thinking level.
- Fixed the `read` tool hanging and the TUI becoming unresponsive when asked to read standard input, FIFOs, or other non-regular files; these paths are now rejected.
- Fixed project configuration from `~/.omp` being incorrectly applied to unrelated working directories under the user's home directory.

## [18.4.10] - 2026-10-02

### Added

- Added global and per-advisor review cadence, including final-yield reviews and intervals that accumulate skipped transcript updates ([#12385](https://github.com/can1357/oh-my-pi/pull/12385) by [@olegpulatov](https://github.com/olegpulatov)).
- Added per-advisor catch-up policy and cancellable `strict` waiting, so asynchronous turn reviewers can run beside synchronous final reviewers ([#12385](https://github.com/can1357/oh-my-pi/pull/12385) by [@olegpulatov](https://github.com/olegpulatov)).
- Added `/jobs full` to show each background bash job's full command line; plain `/jobs` still shortens it to fit the terminal ([#13980](https://github.com/can1357/oh-my-pi/pull/13980) by [@rickythefox](https://github.com/rickythefox))

### Changed

- Advisor notes merge at final boundaries with age markers and at most one permitted continuation per batch; advisor continuations no longer trigger recursive reviews ([#12387](https://github.com/can1357/oh-my-pi/pull/12387) by [@olegpulatov](https://github.com/olegpulatov)).

### Fixed

- Fixed `read` of an executable and `ida` hanging indefinitely while IDA's initial analysis of a large binary runs; they now give up after two minutes with an error naming the still-analyzing host, which keeps analyzing for later calls
- Fixed `await completion(...)`, `await agent(...)` and `asyncio.gather(*handles)` in Python eval cells failing with `Missing session/run/name` ([#13999](https://github.com/can1357/oh-my-pi/pull/13999))
- Fixed isolated tasks picking up edits that other agents or merges made in the parent checkout while the task was starting, which put unrelated changes on task branches
- Fixed releasing a kept-alive isolated agent creating a duplicate `omp/task/*` branch for work that had already been merged
- Fixed isolated task branch capture leaving full-checkout temporary worktrees and empty `omp/task/*` branches behind when interrupted
- Fixed merging isolated task branches stashing the entire working tree, which rewrote every Git LFS file and left `omp-task-merge` stash entries; merges now touch only the picked files and combine them with your unstaged edits
- Fixed `openai-models-list` discovery to honor nested OpenAI model-list input/output token limits while preserving explicit top-level context precedence ([#13988](https://github.com/can1357/oh-my-pi/pull/13988) by [@github-nicolas-stadler](https://github.com/github-nicolas-stadler))
- Fixed importing `@oh-my-pi/pi-coding-agent` source from an installed package (SDK, extension loader, bun-global `omp`) failing with `Export named 'createRatchetPrelude' not found` ([#14027](https://github.com/can1357/oh-my-pi/issues/14027))
- Fixed finished subagent runs staying in memory for as long as the session that spawned them, through an abort listener left on the session's signal ([#14038](https://github.com/can1357/oh-my-pi/pull/14038) by [@theolundqvist](https://github.com/theolundqvist)).
- Fixed print, RPC and ACP runs recording startup timing spans for their whole lifetime, which grew memory with every session and subagent they started ([#14039](https://github.com/can1357/oh-my-pi/pull/14039) by [@theolundqvist](https://github.com/theolundqvist)).
- Fixed parked subagents keeping their spawn-time run state and settings in memory until the process exits, which grew memory with every subagent a long session spawned ([#14040](https://github.com/can1357/oh-my-pi/pull/14040) by [@theolundqvist](https://github.com/theolundqvist)).
- Fixed parked and disposed agent sessions keeping their persistent shell (about 70 KB of native memory each) for the life of the process; a revived subagent now starts with a fresh shell ([#14042](https://github.com/can1357/oh-my-pi/pull/14042) by [@theolundqvist](https://github.com/theolundqvist)).
- Fixed discovered models' request headers nesting one level deeper on every model refresh, which grew memory and per-request work in long sessions with many subagents ([#14041](https://github.com/can1357/oh-my-pi/pull/14041))
- RPC `prompt`, `steer`, and `follow_up` run native `input` handlers in submission order and acknowledge `prompt` only after admission, so a later prompt cannot overtake an idle image skill during vision description, an abort accepted during an earlier hook cancels that frame instead of letting it start a new turn, and a skill failure after the acknowledgement rejects `RpcClient.promptAndWait` instead of being dropped ([#13027](https://github.com/can1357/oh-my-pi/pull/13027) by [@andrebrait](https://github.com/andrebrait)).
- Fixed test suite failures on non-FHS hosts and under ambient terminal and Git configuration ([#12358](https://github.com/can1357/oh-my-pi/pull/12358) by [@olegpulatov](https://github.com/olegpulatov)).
- Fixed late TTSR matches on short tool calls ending a run before the rule interrupt reaches the model ([#14018](https://github.com/can1357/oh-my-pi/issues/14018)).
- Fixed `omp gc --apply` holding `history.db` and `stats.db` open until exit, which left an empty `history.db-wal` behind after a WAL checkpoint ([#14043](https://github.com/can1357/oh-my-pi/issues/14043)).
- Fixed coding-agent session and gc tests failing on Windows ([#14043](https://github.com/can1357/oh-my-pi/issues/14043)).
- Fixed background skill-description compression requests emitting no OTLP chat span or token usage ([#14056](https://github.com/can1357/oh-my-pi/pull/14056) by [@xaviergmail](https://github.com/xaviergmail)).
- Fixed same-ID runtime API replacements carrying a prior route's prompt-cache lifetime into a route without a cache policy ([#13966](https://github.com/can1357/oh-my-pi/pull/13966) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Hashline edits no longer reject fully read lines below an earlier same-file edit as "never displayed" when that edit left them at the same line number ([#13983](https://github.com/can1357/oh-my-pi/issues/13983))
- Fixed `read agent://<id>` returning `Not found` for a running agent (dotted child ids and agents that only submitted non-terminal `yield` sections included) while `write agent://<id>` reached it; the read now shows the agent's status, its yields so far, and its latest text, an unknown id suggests at most five near ids instead of listing every output, and bare `read history://` refreshes the caller's persisted roster like `history://<id>` does ([#14000](https://github.com/can1357/oh-my-pi/pull/14000) by [@radkawar](https://github.com/radkawar))
- Fixed `enabledModels`/`--models` entries naming a judge, search, image, or speech model logging `No models match pattern` on every startup ([#14016](https://github.com/can1357/oh-my-pi/issues/14016))
- Fixed local-memory startup consolidation rebuilding the system prompt of a conversation that had already sent requests, which invalidated its signed thinking blocks; the new summary now applies from the next session ([#14019](https://github.com/can1357/oh-my-pi/pull/14019) by [@nick-maderight](https://github.com/nick-maderight))
- Fixed the Darwin Nix flake / NixOS module build producing an `omp` that fails to start after `nix-collect-garbage` with `Library not loaded: /nix/store/…-libiconv-…` by repointing the embedded native addon's `libiconv` install name at the system library and failing the build if the addon references any `/nix/store` path ([#13992](https://github.com/can1357/oh-my-pi/pull/13992) by [@krzysztofkusmierczyk](https://github.com/krzysztofkusmierczyk)).
- Fixed `/context` and clicks on the status-line context meter stacking a new Context Usage card every time; the existing card is refreshed in place, or moved to the bottom if newer blocks follow it
- Fixed the jevify keyword notice teaching the removed `judge()` handle API, so agents following it failed on the first judge cell; it now uses `judge_batch()` ([#13588](https://github.com/can1357/oh-my-pi/issues/13588), [#13698](https://github.com/can1357/oh-my-pi/pull/13698) by [@holny](https://github.com/holny))

## [18.4.9] - 2026-10-01

### Added

- Added opt-in stale-session garbage collection with `omp gc --stale` or `gc.stale`, removing orphaned session markers and terminal breadcrumbs and expiring old debug reports and collaboration replicas according to configurable retention limits.
- Added RPC controls to cancel or steer individual foreground and background subagents without aborting the session.
- Added RPC word-completion commands so web and IDE hosts can provide the same ghost-text completion available in the terminal editor.
- Added an opt-in RPC ask-dialog mode that lets hosts render all questions together with checkbox or radio-button controls and submit their answers in one response.
- Added SDK notifications when a session moves to a new persistence file, including the previous and new paths.
- Added SDK APIs to inspect and cancel background jobs, including their command, working directory, process IDs, exit status, and captured output.

### Changed

- Improved the `omp predict` comparison view with an interactive native interface, table rows, action controls, and clearer status information.
- Improved MCP authorization prompts with clickable links, native copy/open context menus, and a clearer URL layout.
- RPC hosts are now notified when omp cancels an expired `select`, `confirm`, `input`, or `ask` dialog, allowing stale UI prompts to be closed.
- Limited saved bash, Python, and JavaScript evaluation output artifacts to 16 MB by default while preserving both the beginning and latest output; configure the limit with `tools.artifactMaxBytes`, or set it to `0` for unlimited output.

### Fixed

- Fixed `/wt` on filesystems without copy-on-write cloning, including NTFS, so unchanged files are not incorrectly marked modified and staged edits, additions, and deletions retain the correct contents.
- Fixed Windows Ctrl+V taking about a second to paste by avoiding unnecessary PowerShell clipboard checks.
- Fixed `local://` paths being misinterpreted as local filesystem paths by the `read`, `write`, and search tools.
- Fixed `read` handling of semicolon-separated URLs, local paths, and line selectors so each entry is processed independently.
- Fixed session persistence conflicts between multiple omp processes, preventing lost or interleaved turns and continuing in a new session file when necessary.
- Fixed session image handling to avoid unnecessary rewrites, preserve images after interrupted writes, and prevent garbage collection from removing images that are referenced again.
- Reduced unnecessary disk writes and improved persistence efficiency across sessions, model data, configuration, and background jobs.
- Fixed the native composer showing the main session's effort level instead of the selected subagent's level.
- Fixed the `omp predict` comparison view and MCP authorization prompt rendering with their full native interfaces, including clickable link actions.

## [18.4.6] - 2026-10-01

### Added

- Added a live Background Jobs view that lets you monitor running background jobs without interrupting the transcript.
- Added agent lineage navigation, making it easy to move between subagents and the main session from the composer header.
- Added queued-message controls to the RPC clients and session API, including promotion of queued follow-ups to steering messages without duplicating text or losing attachments, plus explicit steering or follow-up behavior for prompts sent while the agent is busy.
- Added support for keeping Claude prompt caches warm on Amazon Bedrock and Bedrock Mantle according to configured model cache lifetimes and retention settings.
- In Tern terminals, the effort indicator now visualizes the selected thinking level and becomes a fireball at the maximum level.

### Changed

- RPC prompt requests now acknowledge only after the message has been accepted for processing, queued, or routed to an extension command, so subsequent queue-management operations can act on the admitted message reliably.
- Idle recaps now appear as structured notices in the transcript rather than status-line messages.
- Attached-image descriptions for text-only models now time out after 20 seconds and stop when aborted, while preserving the image and informing the model when a description is unavailable.
- The status line now separates the session's own cost from total subagent spend, including nested, background, and resumed subagents, and matches the Agent Hub total.
- Tool-use reminders are now delivered as separate developer messages, keeping them distinct from tool output.
- Reworked Tern transcript navigation and presentation: Esc-Esc rewind now uses the transcript with turn-by-turn and branch navigation, attached images open in Tern's image viewer, idle recaps remain unobtrusively in the transcript, and the background-jobs pill opens the live jobs view.
- Tern now reports agent activity through terminal progress consistently, and its progress and agent indicators update smoothly during subagent work.

### Fixed

- Fixed Tern commands issued while the agent is working so they appear immediately in the transcript instead of being clipped above the prompt.
- Added a dismiss action for Tern's prompt-area error notifications.
- Fixed dollar signs in prompts being mistaken for Python mode until a following space confirms the mode.
- Fixed turns getting stuck in a working state when post-turn maintenance, such as saving the session, fails; the session now becomes idle and reports a warning.
- Fixed failed tool-output pruning from leaving live context out of sync with saved history.
- Fixed oversized or undersized attached images being distorted when resized to fit display limits.
- Fixed interrupted tool calls disappearing from the model's context after resuming a stopped session.
- Fixed aborted prompts with images still being prepared from starting or entering the queue afterward.
- Fixed aside messages containing pasted image or video paths so the source path is preserved when sent to the model.
- Fixed extension-registered prompt-cache settings, including explicit opt-outs, not taking precedence over matching models.yml definitions.
- Fixed prompt-cache warming to honor cache-retention settings, including disabling replay for no-retention caches and using the lifetime written by long-retention requests.

## [18.4.5] - 2026-09-30

### Added

- Added Factory Droid login and model selection with base credit badges and account-matched regional discovery ([#8577](https://github.com/can1357/oh-my-pi/pull/8577) by [@will-bogusz](https://github.com/will-bogusz), continued in [#13276](https://github.com/can1357/oh-my-pi/pull/13276) by [@DusKing1](https://github.com/DusKing1)).
- Added `HELMCODE_API_KEY` to the environment variables listed in `omp --help` ([#13630](https://github.com/can1357/oh-my-pi/pull/13630) by [@alexcerezo](https://github.com/alexcerezo)).
- RPC hosts can send `messageUpdates: "delta"` with `set_event_filter` to receive `message_update` frames without the accumulated message snapshots (`message` shrinks to `{ role }` and `assistantMessageEvent.partial` is omitted); the response echoes the active mode ([#13716](https://github.com/can1357/oh-my-pi/pull/13716) by [@alphastorm](https://github.com/alphastorm))
- RPC hosts can follow each cache-warming refresh through `cache_warming_start` and `cache_warming_end` events (also written by `--mode json`), which report the outcome and the recorded usage, and can set the session's warming mode with `set_cache_warming` without changing `config.yml`; the Python client gains `set_cache_warming()` ([#13717](https://github.com/can1357/oh-my-pi/pull/13717) by [@alphastorm](https://github.com/alphastorm))
- The `/review` and `/annotate code-review` menus have a "Review a specific PR" option that lists the repository's open pull requests, with server-side search and a `#123` shortcut ([#12399](https://github.com/can1357/oh-my-pi/pull/12399) by [@abilliontokens](https://github.com/abilliontokens))
- Pinned Subagents rows can show each agent's current (or most recent) tool call with a one-line detail and an elapsed marker; enable with `display.subagentLivePreview` (off by default) ([#3821](https://github.com/can1357/oh-my-pi/pull/3821) by [@abilliontokens](https://github.com/abilliontokens))
- Model presets: save every role assignment plus the default thinking level under a name and switch between them with `/modelpreset save|switch|delete|list`, pick one interactively with `/modelpreset`, or press `s` in the `/models` Roles view to save the current setup ([#5253](https://github.com/can1357/oh-my-pi/pull/5253) by [@abilliontokens](https://github.com/abilliontokens))
- Subagent tool previews name the files a freeform edit (`apply_patch`, sloppy, hashline) touches ([#11210](https://github.com/can1357/oh-my-pi/pull/11210) by [@DarkPhilosophy](https://github.com/DarkPhilosophy)).

### Changed

- `omp auth-gateway serve` now attributes peers to the socket address by default; deployments behind a trusted reverse proxy can restore forwarded peer headers with `--trust-proxy-headers` ([#13827](https://github.com/can1357/oh-my-pi/pull/13827) by [@shawnkoh](https://github.com/shawnkoh))
- `--no-ui` now also works with `--mode rpc-ui`: extensions run headless while tool UI such as the `ask` tool still reaches the host ([#13718](https://github.com/can1357/oh-my-pi/pull/13718) by [@alphastorm](https://github.com/alphastorm))
- `omp models --json` reports each model's `pricingStatus` (`fixed`, `free`, `included`, `variable`, or `unknown`) ([#11613](https://github.com/can1357/oh-my-pi/pull/11613) by [@will-bogusz](https://github.com/will-bogusz)).

### Fixed

- Fixed the subagent live preview blanking or mislabelling a running call when a sibling call finishes: concurrent calls are tracked by call id and keep their own intent, and the row keeps the last completed call with its success or error mark until the next one starts ([#11210](https://github.com/can1357/oh-my-pi/pull/11210) by [@DarkPhilosophy](https://github.com/DarkPhilosophy)).
- Fixed subagent tool previews rewriting a search pattern that names a home directory: path arguments are now shortened by argument key, so the pattern still shows what was searched ([#11210](https://github.com/can1357/oh-my-pi/pull/11210) by [@DarkPhilosophy](https://github.com/DarkPhilosophy)).
- Fixed background task job progress dropping the current tool's arguments and start time ([#11210](https://github.com/can1357/oh-my-pi/pull/11210) by [@DarkPhilosophy](https://github.com/DarkPhilosophy)).
- Replying `c` during a `/guided-goal` interview now sends `c` as your answer instead of triggering the continue shortcut ([#13819](https://github.com/can1357/oh-my-pi/pull/13819) by [@H4vC](https://github.com/H4vC))
- Cache-warming refreshes cancelled or superseded after the provider accepted them now count toward session usage and cost instead of being dropped ([#13717](https://github.com/can1357/oh-my-pi/pull/13717))
- Fixed Cursor turns that fail with "Cursor stream ended before turnEnded" stopping instead of continuing with their completed tool results kept ([#13684](https://github.com/can1357/oh-my-pi/pull/13684) by [@eggpeat](https://github.com/eggpeat))
- `omp plugin upgrade <name>` now upgrades npm- and git-installed plugins (e.g. `ida-mcp` installed from `github:HexRaysSA/ida-mcp#latest`, which `hcli mcp install` relies on) and resolves a bare marketplace plugin name, instead of failing with "Invalid plugin ID"; the plugin's enabled state and feature selection are kept ([#13812](https://github.com/can1357/oh-my-pi/pull/13812) by [@H4vC](https://github.com/H4vC))
- Extension providers that offer `/login` and also name an env var as their `apiKey` (e.g. the Nexos provider's `NEXOS_API_KEY`) now use the key saved by `/login` when that env var is unset, instead of sending the env var's name as the key, which made their models fail to load or disappear ([#13815](https://github.com/can1357/oh-my-pi/pull/13815) by [@H4vC](https://github.com/H4vC))
- Reduced memory held by finished subagents during long sessions ([#13624](https://github.com/can1357/oh-my-pi/pull/13624) by [@iliaal](https://github.com/iliaal)).
- Fixed role and subagent `retry.fallbackChains` being skipped once the session's thinking level differed from the role's configured one (e.g. `task: grok-4.7:high` running at `:xhigh`), and cold-revived subagents losing the fallback chain they were spawned with ([#13789](https://github.com/can1357/oh-my-pi/issues/13789))
- Fixed compiled OMP extensions importing `@oh-my-pi/pi-catalog` and its provider-model subpaths ([#13731](https://github.com/can1357/oh-my-pi/issues/13731)).
- Explicit `symbolPreset: unicode` now stays Unicode after a Glyph Protocol handshake instead of switching the status bar to Nerd Font icons ([#13865](https://github.com/can1357/oh-my-pi/issues/13865)).
- Fixed rewinding (`/rewind`, `/tree`) during a running turn hiding the queued-prompt bar, making the still-pending queue look deleted and uneditable ([#13680](https://github.com/can1357/oh-my-pi/issues/13680))

## [18.4.4] - 2026-09-29

### Added

- Added `compat.bedrockMessagesApi` to `models.yml`, so Claude reached through a proxy or an `ANTHROPIC_BASE_URL` reroute to Bedrock's `/anthropic` API gets Bedrock request shaping and on-demand compaction; `false` opts a Bedrock URL out ([#13311](https://github.com/can1357/oh-my-pi/pull/13311)).
- Submitting exactly `exit`, `quit`, or `q` (any case, no leading `/`, nothing else in the input) in a session with no messages now quits; turn off with `input.bareExitOnEmptySession` ([#13755](https://github.com/can1357/oh-my-pi/pull/13755) by [@H4vC](https://github.com/H4vC))
- Added the opt-in `input.bareSlashCommands` setting (Interaction > Input): submitting exactly a command name without the leading `/` (e.g. `model`, `compact`, a skill or extension command) runs that slash command. Before the first message it runs at once; after that, the first Enter asks for confirmation and a second Enter runs it (a leading space sends the word as a message) ([#13780](https://github.com/can1357/oh-my-pi/pull/13780) by [@H4vC](https://github.com/H4vC))
- Extensions can now rewrite finalized assistant-message text through the awaited `assistant_message` hook before it reaches context, history, and `message_end` ([#13769](https://github.com/can1357/oh-my-pi/pull/13769) by [@NaC-L](https://github.com/nac-l))
- In Tern (`TERM_PROGRAM=tern`), omp reports its session file to the terminal (OSC 1337 user variable `omp_session_file`) at start and whenever the session changes, so an agent pane Tern's daemon restores after a crash or restart resumes the same session with `--resume`
- Added `additionalContext` to extension and hook `tool_result` results, so success- and failure-specific post-tool guidance reaches the model through the trusted developer channel instead of altering tool output ([#13267](https://github.com/can1357/oh-my-pi/pull/13267) by [@andrebrait](https://github.com/andrebrait)).
- The `ask` tool's custom-answer and note prompts accept pasted images, which reach the model with the answer ([#13774](https://github.com/can1357/oh-my-pi/pull/13774) by [@DrFaustus-vic](https://github.com/DrFaustus-vic))
- Added `/fast ultra` to select OpenAI's Ultrafast service tier on models that offer it (OpenAI API with preview access, or Codex models that advertise it, such as GPT-6.1 Sol once Ultrafast rolls out); `/fast off` clears it and `/fast status` reports `ultra`. `ultrafast` is also accepted by `tier.openai`, `tier.subagent`, `tier.advisor`, and `--service-tier` ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).
- RPC clients can now cancel one pending steering or follow-up message with `remove_queued_message`, including its hidden attachment context, without aborting the turn or changing other queued work ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).
- Added typed queued-message removal to the official Python RPC client, including validated success and refusal results ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).
- RPC clients can now render the actual pending-message queue instead of tracking it themselves: `get_state` reports a `queuedMessages` snapshot and a new `queue_update` event reports it live as steering/follow-up messages are queued, delivered, removed, or cleared ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).

### Changed

- `omp stats --summary` now labels costs as API-equivalent estimates and shows subscription usage that has no reference price as `N/A` instead of `$0.0000`, matching `omp-stats`.

### Fixed

- Fixed the `mnemopi.polyphonicRecall` and `mnemopi.enhancedRecall` settings (and `MNEMOPI_POLYPHONIC_RECALL` / `MNEMOPI_ENHANCED_RECALL`) having no effect: polyphonic recall now surfaces graph- and fact-linked memories, enhanced recall caches repeated recalls until the next memory write, and both apply per session instead of through process-wide defaults ([#2323](https://github.com/can1357/oh-my-pi/issues/2323))
- Fixed `computer.window(74)` matching every open window and `computer.window({ id: 74 })` matching none; a numeric id now resolves the same window as `"74"` ([#13649](https://github.com/can1357/oh-my-pi/pull/13649) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `/fast on` showing fast mode as active on Codex models whose discovered service tiers list others but not priority; it now reports that fast mode is unavailable for the current model. Models whose tier list is empty keep `/fast` ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).
- Cancelling a concurrently queued prompt now preserves the other prompt's hidden keyword context instead of removing it with the cancelled message ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).
- Hidden attachment context and its queued prompt are now claimed together in `one-at-a-time` mode, preventing successful cancellation after only the companion has been delivered ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).
- Queued RPC skill commands retain their original invocation for cancellation, and queue editing no longer treats agent-attributed user-role messages as user input ([#11872](https://github.com/can1357/oh-my-pi/pull/11872) by [@andrebrait](https://github.com/andrebrait)).
- Builtin slash commands (including `/record` and `/skills`) no longer erase a draft typed after Ctrl+Enter detached its submission from the editor ([#13026](https://github.com/can1357/oh-my-pi/pull/13026) by [@andrebrait](https://github.com/andrebrait))
- Failed detached submissions, including Ctrl+Enter `/queue`, and failed Enter `/plan`, `/vibe`, `/goal`, or `/guided-goal` commands now restore their text and attachments beside newer typing, with image markers remapped ([#13026](https://github.com/can1357/oh-my-pi/pull/13026) by [@andrebrait](https://github.com/andrebrait))
- Native extension input handlers now intercept main-session Ctrl+Enter, including queued input, with consistent transformations ([#11834](https://github.com/can1357/oh-my-pi/pull/11834) by [@andrebrait](https://github.com/andrebrait))
- `/plan`, `/vibe`, `/goal`, or `/guided-goal` with attachments that starts no turn (for example `/plan` while goal mode is active) now restores its text and attachments beside newer typing instead of re-attaching only its images ahead of the newer draft's own ([#11834](https://github.com/can1357/oh-my-pi/pull/11834) by [@andrebrait](https://github.com/andrebrait))
- Same-named skills from different sources are no longer silently discarded. A duplicate with identical content still collapses without a warning; otherwise the higher-precedence skill (an authored skill over an installed package, a custom-directory skill over a provider skill, else whichever loaded first) keeps its bare name and the other stays reachable as `<namespace>/<name>` via `skill://<namespace>/<name>` and `/skill:<namespace>/<name>`, with a collision warning naming both files. Skill names containing `/` or `\` are now rejected for every provider and custom directory, since `/` is reserved for that addressing ([#12151](https://github.com/can1357/oh-my-pi/pull/12151) by [@andrebrait](https://github.com/andrebrait))
- Added native HUD and UI elements (status, tool cards, usage heatmap) for TSP terminals
- Added support for native-only session info and job dashboard views in TSP terminals
- Inside a Tern pane, the browser tool opens tabs as browser picture-in-pictures over omp's pane and drives their native web view (trusted input, ARIA snapshots, screenshots, PDF, dialogs, downloads, cookies, console, fetch/XHR routes and HAR, recording); it falls back to Chromium when no Tern window can host them. Opt out with `browser.tern`, `PI_BROWSER_TERN=0` or `app.tern: false`; `app.tern: true` requires it
- Fixed the startup "what's new" notice dropping the last unseen release when it was the final section of a changelog ending in a newline.
- xAI web search honors `XAI_BASE_URL` again when the selected model uses the bundled `https://api.x.ai/v1` endpoint; a custom `baseUrl` from models.yml still wins, and official `xai-oauth` OAuth credentials always stay on the bundled endpoint (API keys, including command-backed ones, follow the override as in chat and image generation).

### Removed

- Removed the bash tool's `env` parameter; services inherit the configured shell environment

## [18.4.3] - 2026-09-28

### Added

- **CLI bin 更名(breaking)**:`zeta-c` 为主命令名,`zeta-cli`/`zetacode` 为别名;裸 `zeta` 名让位给工作台(bin @linxiraos/main)。安装器/补全/文档同步。
- **agent ↔ editor 双向切换**:`/editor` 命令写 handoff(cwd/gitRoot/sessionFile/file:line:col)后 detached spawn editor;配套 `editor.autoInstall` / `editor.handoffSession` 设置键(挂 interaction→Agent 组)。右上角按钮形态随统一入口(工作台)裁定移除。
- **`/teamagent` 指令**:crew 角色 → 标准 AgentDefinition 写 `<project|user>/.zeta/agents`,含 add/remove/agents/roles/status/profile.list/charter.show 七动词。
- Batch `task` calls now start each subagent as soon as its `tasks[]` item finishes streaming instead of waiting for the whole call; launched agents are aborted if the finished call is invalid, blocked, or changed. Controlled by `task.speculativeLaunch` (default on; requires auto-allowed task approval and no extension tool lifecycle handlers)
- Set `PI_SMART_GIT=1` to have every `git worktree add` in the bash tool — including inside compound commands, functions, and loops — copy-on-write clone the checkout (APFS, btrfs/XFS reflink, ReFS) instead of checking out every file, so new worktrees start with ignored build caches (`target/`, `node_modules/`) already in place; every `worktree add` option except `--orphan`, `--no-checkout`, `--track`, and `--relative-paths` is handled, and anything else still runs real git.
- In terminals that speak the Tern Surface Protocol, the working row, todo HUD, subagent HUD, judge/download progress rows, retry hint and stream console are native: the working spinner, message shimmer, elapsed timer and tok/s are terminal-clocked, todos are a phase tree with a progress bar, and clicking a subagent row focuses that agent
- `/usage` refreshes its reports with `r`. In terminals that speak the Tern Surface Protocol it is a glass sheet: provider frames with per-window meters, reset times and banked-reset badges, and a year of activity as a native heatmap with per-day tooltips; `/context` is one frame with a block grid, a legend and a bar marked at the compaction threshold; `/session` info gains a context meter; `/jobs` shows task jobs as live agent rows; `/stats` adds an Open dashboard button
- In terminals that speak the Tern Surface Protocol, MCP tool calls are native cards (an argument grid while running, then a collapsed Args section over highlighted JSON or markdown results) instead of the generic tool card; custom tools can supply their own `describeCall`/`describeResult` hooks for native views
- In terminals that speak the Tern Surface Protocol, a sent prompt's bubble shows its attached images above the text (click one to open the file) and keeps its attachment, skill and model-mention tokens highlighted as the composer drew them
- In terminals that speak the Tern Surface Protocol there is no status bar: the session name (and the branch's PR) is the tab title, Tern's pane header shows the path and branch, each finished turn ends with its time, tokens and cost, the composer carries a model chip (click to switch), an effort meter (click to cycle), a context hairline along its top edge and the context share and session cost, and other configured status segments sit as small facts in the composer; background jobs get a HUD pill
- Added the `/ratchet [flow and goal]` command: the agent asks one batched round of setup questions, builds (or reuses) an eval for the flow you name, gets three approvals (inputs, grader, plan), then hillclimbs it unattended, keeping a change only when it beats the best round on both train and held-out cases. It enables a new `ratchet(flow)` eval global for the session (docs at `xd://eval/ratchet`; persist with `ratchet.enabled`) that stores state in `.omp/ratchet/<flow>/`, invalidates approvals when the approved files change, and prices runs from the model catalog ([#13672](https://github.com/can1357/oh-my-pi/pull/13672) by [@H4vC](https://github.com/H4vC))

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:streaming CLI 命令、热路径记忆化(工具 schema/stamp/which 缓存)、TUI 主题与覆盖层组件迁移至 pi-tui、Astra 上下文确定性策略、eval 判定桥与 Python prelude 维护。
- 修复 bun 1.4.0 bytecode 编译产物启动崩溃(desktop smoke 全平台)。
- 设置项新增 Stream 分区与 stencil.so 流式认证。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:任务执行器 AgentBusyError、事件循环 keepalive、idle 封装截止时间、上下文笔记等。
- 修复中文界面设置布尔项无法关闭的问题(显示文案误入机器值匹配)。
- `/language` 切换后斜杠命令描述即时刷新,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅与 attach 模式提示接入 i18n;`/loop`、`/rename` 描述进目录。

## [1.1.10] - 2026-09-07

- Fixed `edit` auto-repair waiting up to 60 seconds when the `smol` model does not respond; it now times out after 20 seconds and reports repair start and timeout details.
- Fixed subagents leaving queued parent messages behind after tool interruptions.
- Fixed a subagent burning its whole run on `yield` calls that never finish it: an incremental-only `yield` turn no longer bypasses the request budget, and the forced final `yield` ends the run ([#12351](https://github.com/can1357/oh-my-pi/pull/12351) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Fixed `browser.open({ app: { relay: true } })` waiting for the full tool timeout when no relay extension is installed or reachable; it now fails promptly with an actionable error while preserving the wait for a connected extension to recover.
- Fixed `edit` handling of ellipsis markers, inline closing tags, copy-ready corrections, and retries, including cases that could insert literal markers, misreport matches, omit the file target, or panic.
- Enabled `edit.enforceSeenLines` by default to reject hashline edits anchored to content that was not displayed, and prevented stale-tag recovery from applying edits to a structurally different duplicate construct ([#12369](https://github.com/can1357/oh-my-pi/pull/12369) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Fixed startup failures when the plugins directory or its manifest cannot be read; inaccessible plugin roots are now skipped with a warning.
- Fixed generation token-rate displays for subagents and restored the main session's reading after switching focus.
- Fixed subagent HUD labels and plan filenames being populated with example prompt text on smaller models.
- Improved shell, file, session, and persistence operations to avoid unnecessary repeated work, improving responsiveness and resource usage.

## [1.1.9] - 2026-09-05

### Added

- OMP v18.1.10 sync baseline (`f241301c8372`): native Rust edit engine (EditStore/EditSession/DiffStream) behind the `edit` tool, `skillful` setting + `/skillful` per-session skill listing, agent emoji reactions (`tui.reactions`), plan-aware read window preserved for plan files, upstream security-scan command family rebranded, extension/agent discovery hardening.
- TUI settings page fully localized (zh): tabs, group headings, option values, footer hints, preview chrome and slash-command descriptions now follow the configured language; `/language` applies live.

### Fixed

- Sidebar renders again in production sessions: the gutter engine was anchored to the fallback render path after the upstream frame-provider refactor, so `tui.sidebar=true` drew nothing; provider frames now respect the reserved main width and paint the right gutter column. Sidebar content rebuilt to stop duplicating the status line (session header, todo/plan progress, subagent states, MCP health; empty panels hide).
- Channel tools (`channel_send`/`workspace_run`/`im_control`) are once again exclusive to top-level sessions — nested subagents can no longer relay to IM even when the tool names are requested explicitly; `tracking_update` gating restored.
- Windows installer (`install.ps1`) restored to the Zeta package/repo/binary names after the merge pulled the upstream OMP form back in.
- Base system prompt refresh only re-applies on byte-level changes, keeping the inherited provider prompt-cache key stable across explicit refreshes.
- i18n: zh catalog no longer carries OMP self-references; `/security` descriptions use the clean Zeta keys.
- Idle compaction now starts or reschedules when its enabled state, threshold, or delay changes while a session is already idle ([#10242](https://github.com/can1357/oh-my-pi/issues/10242)).
- Fixed `todo` and other tools called through eval rejecting optional `None`/`null` arguments that direct tool calls accept.
- Report oversized selected lines that cannot fit after read context, with a working raw recovery selector instead of a looping continuation hint ([#10775](https://github.com/can1357/oh-my-pi/issues/10775)).
- Approved plan content is now inlined into approve-and-execute prompts instead of forcing the executor to re-read the durable plan file ([#10923](https://github.com/can1357/oh-my-pi/issues/10923)).
- Fixed WorkPool child sessions crashing during startup while constructing their incremental `yield` tool schema.
- Commit summaries written in Vietnamese, Korean, and other accented scripts are no longer rejected for exceeding the length limit, and keep their accents as typed.
- Tool-scoped TTSR rules now match finalized arguments reliably when providers stream short or throttled tool calls ([#10910](https://github.com/can1357/oh-my-pi/issues/10910)).
- Restored `getSupportedThinkingLevels` in the legacy `pi-ai` shim so extensions importing it from `@earendil-works/pi-ai` (e.g. `@companion-ai/feynman`) pass Bun's named-export check and load ([#10800](https://github.com/can1357/oh-my-pi/issues/10800)).

## [1.1.6] - 2026-08-30

- Fixed prewalk conflicting with `todo.eager=always`: the forced eager-todo prelude ("call todo first this turn") was injected alongside the prewalk plan nudge ("write a complete plan first, then todo"), giving the model contradictory instructions; the eager-todo prelude is now suppressed only when prewalk will perform a handoff ([#10510](https://github.com/can1357/oh-my-pi/issues/10510)).
- Fixed `authHeader: true` + command-backed `apiKey` discovery providers (no explicit `headers:` block) resending a stale bearer after a 401 force-refresh; discovered models now re-derive `Authorization` from the live `apiKey` each request ([#10551](https://github.com/can1357/oh-my-pi/issues/10551)).
- Fixed the embedded shell's `command -v`/`-V` honoring only the first operand: it now iterates every name like bash/zsh, printing one line per resolved name and skipping misses ([#10544](https://github.com/can1357/oh-my-pi/issues/10544)).
- Fixed hard-killed subagents vanishing from the agent registry under concurrent fan-out: `AgentLifecycleManager.release` now applies the terminal `aborted` transition before awaiting the tombstone sidecar write, closing a race where the dying session's own dispose-path unregister deleted the ref instead of leaving it as a tombstone ([#10531](https://github.com/can1357/oh-my-pi/issues/10531)).
- `omp commit` now keeps extension-provided model credentials available in its nested commit-agent session ([#10528](https://github.com/can1357/oh-my-pi/issues/10528)).
- MCP tool results now surface `structuredContent`: servers that return their payload in the structured channel while keeping `content` a terse ack (e.g. rhizome-mcp) are no longer data-less to the model ([#10522](https://github.com/can1357/oh-my-pi/issues/10522)).
- Fixed the Agent Hub roster shuffling erratically while open: rows no longer re-sort on every agent heartbeat, so the list stays stable and navigable with many active agents ([#10524](https://github.com/can1357/oh-my-pi/issues/10524)).
- Exiting Vibe mode now removes its restrictions from subsequent model turns, including restored sessions ([#10500](https://github.com/can1357/oh-my-pi/issues/10500)).
- Fixed all-sessions listing (`Tab` in session picker) and cross-project resume failing when sessions are stored under `XDG_DATA_HOME`; `listAllSessions` now scans the active `getSessionsDir()` root instead of hardcoding `~/.zeta/agent/sessions`.
- Fixed the Nerd Font context icon showing a Windows logo instead of a generic window ([#10476](https://github.com/can1357/oh-my-pi/pull/10476) by [@erickmazer](https://github.com/erickmazer)).
- The debug terminal snapshot now reports Herdr (and CMUX) as the multiplexer wrapping the session, matching the TUI's pane-identity detection instead of only tmux/screen/zellij.
- Fixed vibe mode becoming un-exitable after branching a session (including via `/btw`), which previously failed with "Vibe parent session changed before mode exit could be persisted." ([#10468](https://github.com/can1357/oh-my-pi/issues/10468)).
- Fixed HTML session exports reordering interleaved assistant text, thinking, images, and tool calls in the transcript, and split matching text/tool sidebar rows with block-accurate navigation. ([#10253](https://github.com/can1357/oh-my-pi/pull/10253) by [@realcoderandom](https://github.com/realcoderandom))
- Fixed the built-in `grep` and `sed` treating a basic regular expression as an extended one: a bare `+` is now the literal and `\+` the operator, patterns like `^+` or `s/^\+/` no longer match every line, `^` anchors inside `\(…\)` and after `\|`, and a repetition operator with nothing to repeat is reported instead of silently selecting the whole file ([#10298](https://github.com/can1357/oh-my-pi/pull/10298) by [@mruangutai](https://github.com/mruangutai)).
- Fixed RPC `prompt` responses for `/skill:*` commands arriving only after the entire prompt-dispatch pipeline finished (usage preflight, compaction, provider calls): under provider stress that outlasts any client prompt timeout, so hosts reported the prompt as rejected while the turn was in fact running. The skill branch now builds the skill prompt eagerly (preserving the immediate error for an unreadable skill file) and dispatches the expensive pipeline asynchronously after answering, matching plain prompts; when the dispatch is cancelled before a turn starts (e.g. an abort overtakes usage preflight), the session now reports it through the non-invoked completion frame instead of leaving hosts waiting for an that never comes ([#10249](https://github.com/can1357/oh-my-pi/pull/10249) by [@cwr250](https://github.com/cwr250)).
- Fixed stale `omp-plugins.lock.json` entries loading leftover `node_modules` trees for plugins no longer declared in an existing `package.json` — the orphaned copy double-loaded its extensions. Lockfile-only plugins remain supported for manifest-less roots and symlinked packages (`omp plugin link`, marketplace runtime packages); stale entries are skipped with a warning.

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：git TUI 内置 conventional commit 生成与 `if-bench` 基准、`commit --legacy` 统一生成、`:img` 选择器渲染 SVG、新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra image_gen/tts。

### Fixed

- 修复 `/language` 与 `/tracking` 指令在 OMP v18.0.3 合并后未注册的问题（输入被当作普通消息；现已恢复注册并加合并护栏测试）。

## [1.1.4] - 2026-08-26

### Changed

- release 资产命名系统化：CLI 二进制统一为 `zeta-cli-*`，桌面安装包统一为 `zeta-desktop-<version>-<os>-<arch>`。

### Fixed

- 修复中文系统下 CLI 汉化自动检测失效（`language` 默认值不再顶掉环境检测，中文系统自动切换中文界面）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- TUI 渲染升级至上游 v18.0.3 架构（provider window + resize 重绘），终端尺寸变化即时重绘。
- `zeta update` 改为异步增量更新，慢盘/大文件不再阻塞交互。
- Streaming edit guard 改为异步增量验证，大文件编辑不再卡顿。

### Fixed

- Julia 内核可用性探测加固（超时上限 + 进程组击杀），冷启动不再误判为不可用。
- 中文界面本地化覆盖（zh overlay，随 v18.0.4 合并）。

### Removed

- 配置目录统一 `.zeta`，移除 `.zeta` 兼容别名路径。

## [1.0.10] - 2026-08-19

### Added

- Added a web gateway `enter_plan_mode` command and a session `enterPlanMode` path so the web-ui `/plan` slash command actually enters plan mode (plan file, `write` tool, plan-approval wiring, optional initial prompt) instead of forwarding a literal message.
- Added an interactive confirm to `zeta update` before installing a new version (default no on non-TTY input); `--yes`/`-y` skips it.
- Added WeChat `/api/v1/wechat` login (QR + status polling) with legacy iLink fallback, persisted peer→context_token bindings in `web.yml` (`channels.wechat.peerTokens`), and a `POST /api/channels/wechat/unbind` gateway route that resets the channel and clears credentials.
- Added Feishu `bot_p2p_chat_entered` handling: the first private-chat contact gets an onboarding reply.
- Added `channels.allowedPeers` web-config allowlist: when non-empty, only listed peers may reach the agent.
- Added `ui:` metadata to `shellPath`, `retry.enabled`, `stt.language`, `searxng.categories/language/safesearch`, `compaction.reserveTokens/keepRecentTokens`, and `skills.enabled` so they are editable from the web settings panel.

### Changed

- WeChat login now prefers the new `/api/v1/wechat` endpoints (endpoint host configurable via `channels.wechat.endpoint`); older hosts fall back to the legacy iLink QR flow.
- Reworked the Ctrl+S Agent Hub into a responsive fullscreen roster and selected-agent inspector, featuring aggregate status/usage metrics, detailed per-agent views (task, model, activity, usage, lineage), roster and spawn-tree views, stable ordering, asynchronous persisted-session discovery, restored historical metadata, and improved keyboard and mouse navigation.
- Replaced `arktype` with `@linxiraos/omptype` for all tool parameter and configuration schemas, resulting in significantly faster startup times. Configuration schema errors are now reported via `OmpErrors` entries using the standard `path`/`problem` format.

### Fixed

- Fixed panel commands (such as `/usage` and `/advisor status`) appearing unresponsive during active turns by flushing the deferred-panel queue at every settle, terminal or not. The deferral itself stays silent: mounting a status line into the transcript mid-turn re-renders rows below the live block and duplicates them in native scrollback (issues #4806/#6767).
- Fixed the bundled `ts-no-tiny-functions` rule failing to match one-line arrow functions in files with trailing newlines.
- Fixed advisor refusals skipping the model fallback chain, and bounded refusal recovery to a single attempt per model to prevent infinite fallback loops.
- Fixed repeated `/mcp reauth` commands getting stuck by ensuring new reauthorization requests cancel and clean up any pending MCP OAuth login flows.
- Fixed WSL host-home resolution to build `/mnt/<drive>/...` fallback paths using POSIX semantics regardless of the host platform.
- Fixed Python evaluation shell helpers (`!cmd`, `%%bash`, `%pip`) letting child processes inherit the runner's stdin, which previously caused deadlocks on Windows. Additionally, `%%bash` now correctly resolves Git Bash on Windows.
- Fixed subagents spawned via model-role aliases incorrectly falling back to the `default` role's retry chain instead of their own configured role chain.
- Fixed Linux/X11 clipboard reads failing when `xclip` is missing but `xsel` is available.
- Hardened Linux Chromium executable detection to filter out non-executable files, invalid wrappers, and candidates that hang during version probes.
- Fixed Bash command preview crashes caused by malformed tool arguments containing non-string environment values.
- Fixed UI rendering in the model browser and model hub where `nerd`-preset role chips would overlap and obscure the first character of labels.
- Fixed Codex web search sending incompatible request shapes to certain models, which caused the hosted `web_search` tool to ignore them.
- Fixed resumed or rebuilt sessions incorrectly applying stale rewind reports from previous checkpoint cycles to new checkpoints.
- Fixed the `read` tool incorrectly parsing semicolon-delimited internal URLs (such as batched `skill://` resources) as a single invalid resource.
- Fixed `pi.getAllTools()` returning bare strings instead of `ToolInfo[]` objects, restoring compatibility with extensions built against the upstream contract.
- Fixed legacy extensions failing to load in compiled binaries when resolving bundled dependencies via dynamic `createRequire` factories.
- Fixed Wayland window activation and native input handling by correctly reporting them as unavailable rather than attempting unsupported foreground-delivery paths.
- Fixed live execution progress being hidden in the conversation view after approving a plan in the fullscreen Plan Review.
- Fixed `omp -r` failing to discover sessions created under the temporary hashed project-directory scheme by adding a one-way migration back to legacy path-based names.
- Prevented the `read` tool from advertising or resolving `memory://` URIs when the memory backend is disabled.
- Fixed the Shift-Tab thinking mode UI rendering the `off` state as a blank label, which made it appear that reasoning could not be disabled.
- Fixed parsing of POSIX `$EDITOR` commands that contain quoted arguments or executable paths with spaces.
- Fixed persisted Agent Hub rows losing the explicit caller model role when a subagent used a model override, preserving role provenance across restarts.
- Fixed unobserved promise rejections in browser helpers (such as `tab.waitForResponse()`) causing tab workers to hang or crash.
- Improved edit-tool error guidance for operations missing the `»` separator, identifying redundant context-only operations
- Fixed OAuth provider `modifyModels` projections being silently dropped after a discovery refresh introduced live-config headers.
- Edit-tool `＋`/`－` line operations now match their anchors leniently across whitespace drift (indentation, blank-line miscounts) instead of failing with a byte-for-byte error; a note reports the lenient match.
- Fixed an edit-tool REWRITE consisting only of `＋` add lines silently replacing (deleting) the matched text; it now inserts after the kept MATCH.
- Edit-tool no-match errors now name MATCH lines that exist nowhere in the file and suggest marking them with `＋`, and errors without a located region no longer append a misleading file-head "closest match" preview.
- Fixed ordinary CLI startup eagerly loading the computer worker graph (native desktop addon and early environment), restoring lazy startup and profile `.env` ordering.
- Fixed online auto-thinking classifier usage being omitted from session token and cost totals.
- Fixed image generation with custom provider endpoints when using `openai-codex` credentials and a non-OpenAI chat model.
- Fixed custom hook UI factories not receiving the documented `keybindings` argument.
- Fixed MCP OAuth token exchange for authorization endpoints that use a different resource indicator.
- Fixed custom extension `web_search` tools being shadowed by the built-in search tool.
- Fixed Agent Hub task boards collapsing to summary rows after returning from a focused session.
- Improved Linux ARM64 browser startup messaging when managed Chrome for Testing builds are unavailable, with guidance for using system Chromium or `PUPPETEER_EXECUTABLE_PATH`.
- Fixed resuming image-heavy sessions that previously terminated while replaying transcripts.
- Fixed custom agents declaring `hub` being incorrectly treated as read-only.
- Restored compatibility for legacy Pi extensions that import `calculateContextTokens` or use the synchronous `SettingsManager.create()` API.
- Fixed custom model overrides being lost during configuration updates.
- Clarified that the default task-delegation setting follows the selected model's policy.
- Fixed `/rename` without a title interrupting active session activity.
- Fixed the Nerd Font notification persisting incorrectly after theme configuration.
- Fixed sampling parameter errors with newer Anthropic models.
- Long OpenCode Go usage-limit waits now switch replay-safe turns to a configured alternate provider when the delay exceeds `retry.maxDelayMs`.
- Fixed OpenAI Codex Responses tool results being lost when composite and plain tool-call identifiers did not match.
- Fixed `/tan` background agents failing to resolve credentials for providers supplied by extensions.
- Fixed Mnemopi saving session transcripts on exit when automatic retention is disabled.
- Fixed configuration writes through chained symlinks so the final target and intermediate links are preserved.
- Fixed direct tool calls using full `xd://` device URLs.
- Fixed command-backed headers in custom discovery providers being resolved for discovered models.
- Fixed Windows drive paths pasted under WSL being resolved through their `/mnt/<drive>` mounts for images and file reads.
- Improved sloppy/SPARSE edit no-match guidance so low-confidence matches are clearly presented without unsafe copy-ready operations.
- Fixed agents in Hub wait loops failing to respond to user steering messages.
- Fixed `/tan` sessions inheriting parent costs and overstating subagent totals.
- Fixed prompt action labels being truncated.
- Fixed assistant text being truncated when a tool call begins during streaming.
- Fixed the advisor dropping concerns when catching up on multiple turns and improved review context with bounded tool-result excerpts plus complete `ask` exchanges.
- Fixed bash command timeouts being delayed by child processes holding output pipes open, while improving timeout reporting and cleanup.
- Fixed retry countdowns and capped-wait errors displaying floating-point noise in millisecond durations.
- Prevented browser `app.path` from terminating existing same-executable applications when no reusable CDP endpoint is available.
- Fixed top-level errors overwriting the active composer before terminal restoration.
- Fixed Enter being ignored during the first turn when omp starts with an initial prompt.
- Fixed idle compaction discarding context while the session was still waiting on a backgrounded async job ([#10223](https://github.com/can1357/oh-my-pi/pull/10223) by [@mattwilkinsonn](https://github.com/mattwilkinsonn)).
- Fixed LSP idle timeout clobbering in multi-workspace sessions and unmanaged timer spawning on pure config reads ([#10237](https://github.com/can1357/oh-my-pi/pull/10237) by [@harshaygadekar](https://github.com/harshaygadekar)).
Older entries are archived in [packages\coding-agent\CHANGELOG.md@07e9197a3012](https://github.com/can1357/oh-my-pi/blob/07e9197a3012f58c459f1faabeb324decc21f41d/packages\coding-agent\CHANGELOG.md).
### Changed

- Subagent `yield` now takes `data`/`error` directly instead of nesting them under a `result` wrapper.

### Fixed

- Fixed Codex V2 remote compaction rebuilding the request prefix differently from normal turns, restoring prompt-cache reuse ([#10786](https://github.com/can1357/oh-my-pi/issues/10786)).
- Restored mouse clicks, hover, and wheel scrolling in Plan Review.

## [18.1.9] - 2026-09-04

### Breaking Changes

- Browser and computer automation now use JavaScript/Python evaluation preludes with reusable tab and element handles, replacing the previous standalone tool schemas and object-shaped run APIs.
- Replaced the `inspect_image` tool and `/vision` controls with `read <image>?q=<question>` for image questions; text-only models now receive image metadata and guidance for using this selector.
- Renamed `inspect_image.timeoutMs` to `images.questionTimeoutMs`; existing settings are migrated automatically.

### Added

- Bash now extracts Kitty and Sixel terminal graphics as image results for foreground, failed, manual, and background executions.
- Markdown links to existing local files and resources are now clickable while preserving their displayed URLs.
- Added `/switch <model>` for session-only model changes, with the same model selectors and completions supported by `--model`; ACP `/model <model>` accepts these selectors as well.
- Added the `worktree.cleanSource` setting to reset and clean the original checkout when creating a worktree with `/wt`.
- Expanded the computer JavaScript/Python evaluation prelude with direct desktop, window, screenshot, accessibility, and element interaction helpers, while keeping `computer.run` available for multi-step scripts.

### Changed

- Agent delegation is now model-aware, allowing some models to favor focused inline work instead of spawning subagents.

### Fixed

- Fixed fallback authorization-code prompts remaining active after native OAuth callback completion.
- Fixed reciprocal idle subagents repeatedly waking one another indefinitely.
- Fixed `/wt` and `git worktree add` failing when the new worktree targeted the same commit as the clean source checkout.
- Fixed omp-installed marketplace plugins and `--plugin-dir` plugins losing their skills when the Claude plugin source was not separately enabled ([#10743](https://github.com/can1357/oh-my-pi/issues/10743)).
- Fixed session accent colors rendering as bright white in terminals without truecolor support, including Terminal.app ([#10759](https://github.com/can1357/oh-my-pi/issues/10759)).
- Rules with `enabled: false` frontmatter are now omitted during discovery, matching disabled skills ([#10769](https://github.com/can1357/oh-my-pi/issues/10769)).
- Fixed large MCP tool-result previews losing the relevant tail content when an oversized output line preceded it ([#10761](https://github.com/can1357/oh-my-pi/issues/10761)).
- Fixed `Ctrl+V` replacing CJK characters with `?` when pasting from XWayland clipboard owners on Wayland ([#10762](https://github.com/can1357/oh-my-pi/issues/10762)).
- Fixed byte-limited artifact reads reporting the displayed byte count instead of the actual read limit ([#10764](https://github.com/can1357/oh-my-pi/issues/10764)).
- Fixed read-tool truncation notices incorrectly reporting zero delivered lines or bytes when previewing a partial oversized line ([#10768](https://github.com/can1357/oh-my-pi/issues/10768)).
- Fixed Mnemopi removing explicitly retained or learned long-term memory after sessions longer than 24 hours by consolidating eligible working memory at session start ([#10770](https://github.com/can1357/oh-my-pi/issues/10770)).

### Removed

- Removed the librarian agent.

## [18.1.8] - 2026-09-03

### Fixed

- Improved background task results with structured output schemas: parsed results are now available through the `agent://<id>` resource, while large or invalid inline JSON is replaced with a reliable pointer to the complete result.
- Background task artifacts are retained long enough for follow-up turns to read them, including failed tasks that lack valid structured output, and are cleaned up without blocking shutdown or leaking resources.
- Fixed context compaction incorrectly accepting archived history that was larger because of opaque reasoning data, allowing the next compaction strategy to run instead.
- Fixed the Model Hub sidebar jumping to the top when provider refreshes rebuild the list; the focused model, or its nearest remaining entry, is now preserved.
- Fixed the `inspect_image` status hint showing the wrong model after switching between image-capable model roles.
- Fixed multi-minute TUI freezes during subagent activity and batch execution.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@14c97b555b20](https://github.com/can1357/oh-my-pi/blob/14c97b555b206231290f46882794c8d8c3c024b1/packages/coding-agent/CHANGELOG.md).
