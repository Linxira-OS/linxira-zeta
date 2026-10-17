## [Unreleased]

## [18.11.3] - 2026-10-16

### Breaking Changes

- Extension `ui.approve()` hosts receive an optional `session` choice label and answer `"once"`, `"session"`, or `"deny"` instead of a boolean

### Added

- Added `imageCountBudget` to custom models and `modelOverrides` in models.yml, so a custom gateway can state its host's image limit instead of the default of 5; past that limit the oldest images were dropped on every new image, which rewrote the provider's prompt cache ([#15002](https://github.com/can1357/oh-my-pi/issues/15002), [#15969](https://github.com/can1357/oh-my-pi/pull/15969) by [@aramalipoor](https://github.com/aramalipoor))
- The status line names the active profile next to the `π` brand (`π-work`), so sessions from different profiles are distinguishable at a glance; the default profile is unchanged ([#15622](https://github.com/can1357/oh-my-pi/pull/15622) by [@matthewrball](https://github.com/matthewrball))
- Added opt-in `prewalk.auto` (`off`, `suggest`, or `on`): the native judge decides per task whether to arm a prewalk handoff to `prewalk.autoTarget`, and the next task starts back on the planning model ([#16026](https://github.com/can1357/oh-my-pi/pull/16026) by [@taibenvenuti](https://github.com/taibenvenuti))
- Added `/seance` and the task `seance` agent: consult a saved session read-only, in place, without resuming it or copying its artifacts; pick the source and an optional model from pickers, and send follow-ups to the consultant ([#15036](https://github.com/can1357/oh-my-pi/pull/15036) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))

### Changed

- Tool approval prompts list Approve, Approve `<tool>` for this session, and Deny again: with an empty composer, pick with the arrow keys and Enter; typing in the composer denies and steers instead, and the Deny row reads "Deny and send message" while you do

### Fixed

- Fixed the Isolate Subagents setting description implying that all tasks run isolated; each task must opt in with `isolated: true` ([#15987](https://github.com/can1357/oh-my-pi/issues/15987)).
- Fixed `read` labeling re-encoded images with the display format instead of the source file's format; it now identifies both when they differ ([#15890](https://github.com/can1357/oh-my-pi/issues/15890)).
- Fixed `omp -p` and `task` subagents reporting a clean finish with an earlier answer when a context overflow could not be compacted enough to retry; the overflow error is now the run's outcome ([#15897](https://github.com/can1357/oh-my-pi/pull/15897) by [@nhthung](https://github.com/nhthung))
- Fixed Cursor's Shell tool killing commands once its `block_until_ms` wait elapsed; the wait no longer sets the kill deadline, which comes from Cursor's `hard_timeout` or the bash default ([#15898](https://github.com/can1357/oh-my-pi/pull/15898) by [@nhthung](https://github.com/nhthung))
- Fixed an interrupted prompt's late setup cleanup marking the next prompt idle early, allowing overlapping submissions and releasing sleep prevention mid-turn ([#15946](https://github.com/can1357/oh-my-pi/issues/15946))
- Fixed hashline `REM` hiding the path-recovery warning when a nonexistent path matched an earlier-read file ([#15957](https://github.com/can1357/oh-my-pi/issues/15957)).
- Fixed tool downloads (`sd`, `sg`, `yt-dlp`, `trafilatura`) failing with `GitHub API error: 403` on a machine whose egress IP has spent GitHub's anonymous 60/hour budget; the release lookup now sends `GITHUB_TOKEN`/`GH_TOKEN` like omp's other GitHub API call sites ([#15981](https://github.com/can1357/oh-my-pi/pull/15981) by [@iacore](https://github.com/iacore))
- Background local memory extraction now stops after one bounded retry budget on repeated OpenAI-compatible 429 responses instead of multiplying transport, provider, and completion retries ([#15826](https://github.com/can1357/oh-my-pi/issues/15826)).
- Fixed a message-result subagent resumed by typing into its focused session leaving `agent://<id>` empty and never reporting its final reply to the parent ([#15948](https://github.com/can1357/oh-my-pi/issues/15948))
- Fixed `read` of an RSS or Atom feed showing `Untitled` for every item and dropping feed titles, descriptions, dates, and RSS item links ([#15954](https://github.com/can1357/oh-my-pi/issues/15954))
- Fixed `read` showing a binary notice instead of an HTML page when a server sends unlabeled gzip to the first request but decodable HTML to the second ([#15956](https://github.com/can1357/oh-my-pi/issues/15956))
- Fixed `read` returning a homepage's site-wide feed or a page's site-wide `llms.txt` alternate instead of the requested page ([#15955](https://github.com/can1357/oh-my-pi/issues/15955)).
- Fixed `ast_grep` reporting a clean "No matches found" for a pattern that does not parse in the target language (e.g. a bare C# identifier); it now lists the pattern's ERROR node as a parse issue ([#15950](https://github.com/can1357/oh-my-pi/issues/15950))
- Fixed `--resume <id>` and session listings skipping transcripts placed in the session directory as symlinks ([#15878](https://github.com/can1357/oh-my-pi/issues/15878), [#15884](https://github.com/can1357/oh-my-pi/pull/15884) by [@peda-cos](https://github.com/peda-cos))
- Fixed sessions with a deferred-connecting MCP server listing every routed MCP tool twice, once as a mount notice and once in route guidance ([#15982](https://github.com/can1357/oh-my-pi/pull/15982) by [@zcyoung2000](https://github.com/zcyoung2000))

### Removed

- Removed the built-in `rs-parking-lot` rule; Rust edits using `std::sync::{Mutex, RwLock}` with `.lock().unwrap()` are no longer steered to `parking_lot`

## [18.11.2] - 2026-10-16

### Added

- Added a Copy button that leads the turn footer under an answer in Tern (`⧉ · 2m13s · 71K tok · $0.85 this turn`, in place of the clock), which copies that answer
- Added `/fork` support for creating a new Tern pane while a turn is streaming, preserving the original session
- Added `zetacode session pack`, `zetacode session unpack` and `zetacode session moved` to move a session with its artifacts to another machine and continue it there; resuming the copy left behind forks it instead of continuing it
- Added `zetacode auth export` and `zetacode auth import` to carry model sign-ins to another machine
- Added hiding a pending `ask` question without answering it: `Alt+H` (`app.ask.hide`) or the Hide button in Tern collapses the dialog to one line; the same key, `Enter`, or Show brings it back ([#15400](https://github.com/can1357/oh-my-pi/pull/15400) by [@H4vC](https://github.com/H4vC))
- Added `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` support: set it to stop Anthropic requests sending experimental beta fields that a company `ANTHROPIC_BASE_URL` gateway rejects, such as the Sonnet 5.5 `thinking.adaptive.block_binding` 400 ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))
- Added the `task.structured` setting (default off) for structured task results: when on, the task tool accepts `outputSchema`/`schemaMode` and subagents return results through `yield` as before
- Added `task.agentSoftRequestBudget` to give named subagents their own soft request budget, so a long-running agent can get more requests (or `0` for no guard) while scout, sonic and other agents keep theirs ([#15419](https://github.com/can1357/oh-my-pi/pull/15419) by [@will-bogusz](https://github.com/will-bogusz))
- Added `o200k` as a `tokenizer` value for custom models and overrides in `models.yml` ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))
- Extensions can observe and answer the interactive plan review, including refinement feedback and save-and-quit ([#14250](https://github.com/can1357/oh-my-pi/pull/14250) by [@rlfleming93](https://github.com/rlfleming93))
- Added opt-in `omp gc --compress` (or `gc.compress`), which stores sessions idle for `gc.compressAfterDays` (default 7) with filesystem transparent compression (APFS, NTFS); they stay resumable and searchable ([#15600](https://github.com/can1357/oh-my-pi/pull/15600) by [@wolfiesch](https://github.com/wolfiesch))
- Extensions can reopen a dismissed plan review while the session is idle (`ctx.openPlanReview()`) and pick the execution tier on `ctx.resolvePlanReview` (`input.role`); `plan_review_requested` now reports the slider's tiers ([#15552](https://github.com/can1357/oh-my-pi/pull/15552) by [@Shadorain](https://github.com/Shadorain))
- Added image attachments to single and batch eval `judge()`/`judge_batch()` calls (local paths or embedded images); image judgments skip candidates without image support and fail explicitly instead of dropping images ([#15471](https://github.com/can1357/oh-my-pi/pull/15471) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))
- Added a job tree to `/jobs`, `/jobs full` and the jobs pill's sheet, in the terminal UI and over ACP: subagents' background jobs now appear nested under the task that runs them, with the busiest branches listed first; only your own jobs offer Cancel ([#15854](https://github.com/can1357/oh-my-pi/pull/15854) by [@H4vC](https://github.com/H4vC))
- Added `ctx.ui.getEditorComponent()` so extensions can wrap the active custom editor factory instead of replacing it ([#8655](https://github.com/can1357/oh-my-pi/pull/8655) by [@jovi-tsx](https://github.com/jovi-tsx))
- Added a microphone button beside Send in Tern: click to record, click Stop to finish, then review and submit the transcription yourself. Clicking while it says **Starting…** cancels a slow first model load ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- Added local Nemotron streaming dictation: words appear while you speak, and the microphone waits for the recognizer to be ready before recording ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- Added agent frontmatter `structured: true`: that agent's task spawns keep the `yield` tool and its `output` schema validation while `task.structured` is off ([#15717](https://github.com/can1357/oh-my-pi/pull/15717) by [@alphastorm](https://github.com/alphastorm))
- The composer stays usable while a tool approval is pending: sending a message denies the call and steers the turn with it, so the agent knows why it was denied ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- Session entries record which omp build wrote them, so a transcript shows whether a fix was live even in a session left open across an upgrade: the version, plus commit, branch, and uncommitted-diff hash when run from a source checkout, and `OMP_BUILD_LABEL` when set. `/session` lists the builds that wrote the session ([#15680](https://github.com/can1357/oh-my-pi/pull/15680) by [@will-bogusz](https://github.com/will-bogusz))
- Added `lsp.requestTimeout` setting to configure wait durations for language server diagnostics and requests
- Added `POST /api/channels/send` to the `zeta serve` gateway: any process outside the server (the desktop shell, a script) can push one IM message through a running WeChat/Feishu/Telegram channel with `{channelId, to, text}`; 404 when that channel is not running here, 400 when the peer is not paired (WeChat needs a `context_token` from an earlier inbound), 500 when the platform refused. Same access gate as `/api/channels/status` — loopback passes, a non-loopback caller needs `remote.token`.
- Added `omp auth-gateway serve --clients=<file>`: per-client bearer tokens, each limited to listed models and broker OAuth accounts with no fallback to other accounts or API keys, re-read while serving ([#5098](https://github.com/can1357/oh-my-pi/issues/5098), [#15900](https://github.com/can1357/oh-my-pi/pull/15900) by [@alphastorm](https://github.com/alphastorm))

### Changed

- Running agents and background jobs in Tern now share one compact counter over the composer (an icon and a count each, the words on hover) instead of two "N running" pills; each count still opens its own sheet
- In Tern, `/session pin` and `/usage reset` open the same picker sheet as the other small selectors (the active account checked, a confirm strip before a reset is spent, unusable accounts dimmed with the reason); the thinking level picker shows each level's depth as a meter, the plugin and queue mode pickers use badges (version, installed, scope, recommended) and plain-language names instead of bracketed text, and the theme picker no longer repeats "(current)" beside its check
- In Tern, the text editor an extension opens (and the ask tool's custom answer and note) is now a sheet in the composer's place: the title over its details, the text written straight on the sheet, and Open in editor, Cancel and Submit buttons whose keys show in their tooltips instead of a keycap hint row
- A subagent's model is no longer a spawn parameter: `task` rejects `model` outright (the model comes from the agent definition, or — unconfigured — the parent's own), and switching a subagent's model is now a per-subagent capability that opens once it has completed a model response, instead of an opt-in global setting. Failure classes and the session's alternative models are reported unconditionally.
- Local IPC endpoints (daemon broker, LSP mux, IDA hosts, text prediction, `zetacode stream`, Collab discovery, local model workers) now run on a native transport: owner-only on every platform, including Windows named pipes; on Windows, daemons started by an older zetacode are not reused, so close older sessions after upgrading.
- Output hidden behind an open `ask` dialog, command report or todo list now reaches terminal scrollback once it closes, rather than while it is still open ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Subagents spawned by the task tool now return their final message as plain text, with no `yield` tool, output schemas, or "Submit Result" fields; eval `agent()`/workpool spawns still return structured results
- In Tern, a backgrounded `bash` command or `eval` cell keeps filling its own card with live output (In background, with a running clock) and settles it with the job's outcome, Cancelled when the job is killed; `wait` lists each job on one line (type, id, label, duration) instead of repeating its output
- ACP clients now see a backgrounded call's job output stream into its tool call, which settles completed or failed with the job
- Sized snapcompact archives for Claude 4.7+ and GPT-5.5 to 6.1 (gpt-6-astra included) at each frame's measured price instead of at least 5,024 tokens, so Codex archives can hold up to 1.7× as many frames when the room under the compaction trigger is the limit ([#15442](https://github.com/can1357/oh-my-pi/pull/15442) by [@will-bogusz](https://github.com/will-bogusz))
- Enabled sibling subagent prompt-cache sharing for Muse Code's Spark 1.3, Wonder 1.0, and Wonder Full 1.0 variants while keeping their conversations separate ([#15467](https://github.com/can1357/oh-my-pi/pull/15467) by [@iliaal](https://github.com/iliaal), based on [#15285](https://github.com/can1357/oh-my-pi/pull/15285) by [@YueyuHoshizora](https://github.com/YueyuHoshizora))
- Reduced tool-result tokens by omitting subsecond bash timing and redundant task size metadata ([#15468](https://github.com/can1357/oh-my-pi/pull/15468) by [@iliaal](https://github.com/iliaal); [#15265](https://github.com/can1357/oh-my-pi/issues/15265); based on [#15284](https://github.com/can1357/oh-my-pi/pull/15284) by [@YueyuHoshizora](https://github.com/YueyuHoshizora))
- On the official Anthropic and Codex endpoints, snapcompact archives may carry up to 12 MB of frames instead of 3 MB, Anthropic requests keep up to 600 images (100 on 200k-window models) instead of 90, and Codex requests up to 2,000 instead of 200; custom base URLs, including Anthropic requests rerouted by `ANTHROPIC_BASE_URL` or Foundry's `FOUNDRY_BASE_URL`, keep the previous limits and no longer get Anthropic's 24 MB inline image byte limit ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Tool approval prompts now replace the composer like `ask`, show one row per detail, and approve with `Ctrl+Enter` (or `Ctrl+Q`) instead of `Enter` ([#15548](https://github.com/can1357/oh-my-pi/pull/15548) by [@H4vC](https://github.com/H4vC))
- Reduced memory used by bundled model catalog data in standalone and npm installs ([#15876](https://github.com/can1357/oh-my-pi/pull/15876) by [@iliaal](https://github.com/iliaal)).
- The in-composer tool approval prompt summarizes the command, path, or content to one row so the composer keeps its room; `Ctrl+O` shows them in full ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- Background task guidance now lives in the Task tool description (and in same-name extension replacements that delegate to Task) instead of being repeated in every spawn acknowledgment ([#15477](https://github.com/can1357/oh-my-pi/pull/15477) by [@iliaal](https://github.com/iliaal))
- The Auto-Promote Context and Retry Model Fallback settings now state that they are independent; turn off Retry Model Fallback (`retry.modelFallback`) to stop `retry.fallbackChains` model switches ([#15636](https://github.com/can1357/oh-my-pi/issues/15636))
- The `lsp` tool now uses `lsp.requestTimeout` to dynamically adjust both call deadlines and project-aware diagnostic wait times, with support for per-call overrides
- Reduced CPU overhead during syntax checks and automatic edit repairs ([#15904](https://github.com/can1357/oh-my-pi/pull/15904) by [@iliaal](https://github.com/iliaal)).
- Reduced status-line refresh overhead while subagents have long conversations ([#15874](https://github.com/can1357/oh-my-pi/pull/15874) by [@iliaal](https://github.com/iliaal)).
- Agents now send `todo` updates alongside their next tool call instead of spending a separate model turn on them ([#15402](https://github.com/can1357/oh-my-pi/pull/15402) by [@will-bogusz](https://github.com/will-bogusz))
- The Shared Language Servers setting now says what it does: each connection gets its own server, and a released one is reused while another omp instance keeps the project's mux running ([#14633](https://github.com/can1357/oh-my-pi/pull/14633) by [@jorgoose](https://github.com/jorgoose))
- Memories saved explicitly through the extension `memory.save` API are now stored as `stated` rather than `unknown`, so they rank as deliberate memories in Mnemopi recall ([#13824](https://github.com/can1357/oh-my-pi/pull/13824) by [@sjawhar](https://github.com/sjawhar))

### Fixed

- Fixed `grep` on a single file showing in Tern as separate boxed snippets with no file row or syntax colors; it now looks the same as a `grep` over a directory
- Fixed project tracking never writing two things its documentation promised. Every committed compaction now persists its summary to `.zeta/tracking/summaries/compaction-<ts>.md` (wired at the single `SessionMaintenance.#commitCompactionEntry` chokepoint, plus the snapcompact dead-end rebuild; nothing is written while `tracking.enabled` is off), and every plan-approval path — TUI plan review, ACP plan proposals, remote/IM `plan_approve` and plan-yolo — now mirrors the approved plan into `.zeta/tracking/plans/<slug>-plan.md` instead of only plan-yolo doing so.
- Fixed `/tracking on` flipping the setting and the UI while changing nothing in the running session: `tracking.enabled` is now a live tool gate, so a session reconciles its built-ins on the toggle instead of waiting for a restart. `tracking_update` also stays top-level instead of being mounted under `xd://` — the todo phase nudge and the approved-plan prompt both read the *active* tool set and call the tool by name, so mounting it closed both gates. The approved-plan prompt now receives that tool set too, which makes its todo/tracking instructions actually render, and the phase nudge names the completed phase instead of emitting a literal `{phase}`.
- Fixed every session loading its own copy of the local mnemopi embedding model and keeping it in memory until exit; one server per model is shared across sessions and exits after 15 idle minutes ([#9908](https://github.com/can1357/oh-my-pi/issues/9908))
- Fixed the first-use mnemopi embedding-model download never completing for sessions shorter than the download; it now finishes in the shared embedding server after the session exits ([#10240](https://github.com/can1357/oh-my-pi/issues/10240))
- Fixed `RpcClient.stop()` occasionally waiting forever because the agent process was never signaled.
- Fixed blank rows opening under the input after an `ask` dialog, command report or todo list closed in a session that had filled the screen; the transcript now refills the screen ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Fixed blank rows appearing between the last paragraphs of a streamed answer when the turn ended ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- The shell tool refuses commands that would kill its own host chain or sweep unrelated processes. A recency or name sweep (`Get-Process cmd | Where-Object { $_.StartTime -gt … } | Stop-Process`, `Stop-Process -Name`, `taskkill /IM`, `pkill`, `killall`, `kill -1`/`kill 0`, `wmic process … delete`, a `.Kill()` on a handle the command did not create) now fails with a message naming the target, why the reach is unsafe, and the fix, instead of ending the user's session; the agent's own chain (its pid, its parents, the `bun`/`node` host, the terminal/console host) is collected at call time and is never killable. The accepted `spawn → capture $! / -PassThru → stop that pid` idiom still runs, an explicit pid outside the chain still runs, and the bash prompt now states the rule. The guard has no session-side switch — the agent can write settings files — so the user's escape hatch is `ZETA_HOST_PROCESS_GUARD=off` in the launch environment.
- The plugin system loads end to end again: `zetacode plugin link ./plugins/official/pi-messenger` → `plugin list`, `plugin doctor`, `skills list`, and the plugin's `pi_messenger` tool plus its `/editor`, `/teamagent`, `/messenger` commands are all present in a session. Three defects each hid the next. (1) The session loader read only the upstream `omp`/`pi` manifest keys, so a package declaring its manifest under `zeta` (the key Zeta-authored plugins ship) was listed by `zetacode plugin …` and contributed nothing — no skill, no extension module. `PLUGIN_MANIFEST_KEYS` in `extensibility/plugins/types.ts`, read through `readPluginManifest`, is now the one key list for listing, session loading, installation, extension-directory resolution and sub-discovery. (2) The lockfile *writer* targeted the pre-rename `omp-plugins.lock.json` while the loader's migrating *reader* treated `zeta-plugins.lock.json` as canonical and deleted the legacy file, so the first migration ran and every `zetacode plugin …` command then read a file that no longer existed ("No plugins installed"). Every writer now writes `zeta-plugins.lock.json`, and every reader resolves canonical-first with the pre-rename name as a read-only fallback (`pluginsLockfileReadOrder` in `packages/utils/src/dirs.ts`) plus the existing first-read migration — an install that predates the rename keeps its enabled flags and feature selection. (3) The `cfgEditorAutoInstall` / `cfgEditorHandoffSession` settings handles that the official plugin's `editor-command.ts` imports had been dropped from `session/settings.ts` by an upstream merge; because `index.ts` imports that module statically, the plugin's whole module graph failed to import and registered neither tool nor commands while `plugin doctor` reported it healthy. Both handles are restored from the pre-merge implementation. `scripts/brand/zeta-sentinels.ts` now pins the four lines an upstream merge would revert, `test/plugins/pi-messenger-activation.test.ts` imports the real plugin through the real extension loader, and `test/plugin-extensions-discovery.test.ts` installs a `zeta`-only fixture and requires it to be both listed and loaded.
- The npm fallback that starts the Web UI names the **scoped** package again (`@linxiraos/zeta-web`, bin `zeta-web`). `zetacode serve` on an install without a repository `web-ui` checkout asked `npx` for the unscoped `zeta-web`, which is a *bin* name, not a published package: every launch died with `npm error 404 Not Found - GET https://registry.npmjs.org/zeta-web`, the serve process still bound 30141/3847/30142 and published itself to `serve.json`, and every request was proxied to a Web UI child that had never come up (`Proxy request failed … ECONNREFUSED`). The fallback target is now a discriminated `bin`-path / npx-`specifier` pair so one string cannot serve both roles, the resolved `@latest` version is logged at boot (web-ui rides its own line — 1.1.5 while the CLI is 1.2.1), and the install hints name the scoped package.
- Instance reuse is decided on the surface the user needs, not only on routes the gateway answers in-process. `/api/server/identity` and `/api/sessions` come from the serve process itself, so an instance whose Web UI child died still passed discovery; `zetacode serve` then reported "reusing it" and the desktop shell adopted the corpse on every launch. Discovery now also probes the proxied Web UI page and refuses such an instance (`web-ui-unreachable`, with the probe's URL/status/error printed), and the desktop shell retires the reused instance's registration on a failed readiness probe instead of leaving it for the next start, with a failure dialog that names the surface that failed, its URL, the probe answer, and what happened to the registration.
- A packaged desktop shell starts its own bundled runtime ahead of a PATH-installed CLI. The bundle is the only launcher that ships the staged Web UI plus the Node runtime it needs and is version-locked to the shell (`check-version-consistency.ts`); a PATH launcher carries neither guarantee, and an npm install of the same version ships no Web UI at all. Explicit `ZETA_SERVE_COMMAND` / `ZETA_BIN_DIR` overrides still win, an incomplete bundle still falls back to PATH, and unpackaged shells are unaffected.
- Agent-driven model switching (`task.enableModelParam`, default `false`): a parent agent can now name the model a spawn runs on and re-plan a failed subagent itself instead of depending on a configured `retry.fallbackChains` list that may point at an equally exhausted provider. Enabled, the `task` tool accepts a per-spawn `model` selector (`provider/model-id`, `:level`, or `@role`) that outranks `task.agentModelOverrides`, the agent's frontmatter model, and the parent's active model; a wake can override the model too (`ensureLive(id, { model })` and follow-up turns), which is the "just continue it" path that previously kept the model captured at spawn. A settled run now reports `failureClass` (`usage-limit`, `auth`, `account-policy`, `context-overflow`, `transient`, `aborted`, `unknown`) with the session's `fallbackCandidates`, surfaced in the `<task-result>` envelope as `<failure class="…" />`, `<candidates>` and — when the setting is on — a `<retry-hint>` telling the parent which field to re-dispatch through, so a failure reads as "this route is dry, use one of these" instead of a bare error line. Guardrails are built in: a model that failed hard is recorded per session and neither re-dispatched nor offered as a candidate until its cooldown expires (5 minutes by default, or the provider's own reset hint, capped at 24 hours) or a run on it succeeds, every applied switch is audited (`model_change` in the transcript plus an observable notice and the run's `modelChange` field), and the harness never hops models on its own initiative. Off by default, the wire shape, the resolution chain, the results, and the ledger are byte-for-byte what they were.
- The upstream-OMP model compatibility probe targets the real upstream root (`~/.omp/agent`) again. The branding sweep had redirected `defaultOmpAgentDir()` to `~/.zeta/agent`, which is Zeta's **own** config root: the read-only probe therefore re-read Zeta's own `models.yml` as a phantom "upstream overlay" — one file consumed as two sources, and model-registry tests on a provisioned host only passed when they were handed an empty `ompAgentDir` fixture. Upstream `models.yml`/`agent.db` are still mapped read-only into the in-memory overlay and nothing is written back; the reload mtime fingerprint now shares the same resolver so the two cannot drift.
- Startup no longer waits on the bundled model-catalog sweep when it only needs the providers that can actually be unresolved. The `createAgentSession` discovery fallback exists for providers that ship **no** static models (models.yml `discovery:` endpoints, the implicit local engines, runtime managers) — the very set its guard tests — but it refreshed *every* bundled provider's online catalog. With a cold cache that is one network fetch per provider, and the slowest of them (zenmux/venice on a plain HTTPS connection) held the pre-paint path past 10s: a cache-cold boot on Windows measured 12.4s → 2.3s median (N=5, `PI_TIMING=x`, credentials absent so the fallback path is taken). Every bundled provider already contributes static rows, so the sweep cannot add a resolvable model at that point; `ModelRegistry.refresh(strategy, { providers })` now restricts the pass and the catalogs are reconciled by the post-frame background refresh (`refreshInBackground`, `startDeferredStartupWork`) that already ran.
- Unknown `models.yml` compat keys are aggregated and actionable. One key is now one line — occurrences folded together, counted, and listed as up to three `…compat` containers plus `+N more` — instead of one line per dotted path, and a key the vocabulary renamed is reported with its successor (`requiresReasoningContentOnAssistantMessages` → `requiresReasoningContentForAllAssistantTurns`) instead of a bare "Unknown". The reported shape (one stale key on both models of four providers) went from eight header rows to one, the complete path list is written to the debug log, and the interactive header caps its warning block at five rows plus a summary.
- The welcome tips are guarded against silently going untranslated: a new `packages/coding-agent/test/i18n-tips-coverage.test.ts` proves every non-blank `tips.txt` line has a `tipN` entry in **both** catalogues, that the English value is that line verbatim (minus the `[NEW]` marker, exactly like the runtime fallback), and that neither translation drops the line's `{key:…}`/`{tap:…}` render placeholders. `scripts/check-i18n-consistency.ts` only compared en against zh, so one line falling out of step (no key at all, or a key that no longer tracks its line — the drift that left the `#`/`/`/`!`/`$`, `jevify` and self-reconfigure tips English in every language) stayed green.
- Fails unstructured task runs that conclude without a final message
- Background task cards no longer stop updating once the agent ends its turn while the task is still running
- Transparent images the model receives (small icons, oversized screenshots) keep their transparency instead of turning into a black square, and resized edges no longer pick up a dark fringe
- Fixed `snapcompact.toolResults` re-sending each large tool result as images a turn after it went out as text, which broke the prompt cache and Anthropic signed thinking every turn; results are now imaged from their first send, and `read` results stay text unless the model is known to edit exactly from images (Opus 5.5+) ([#14249](https://github.com/can1357/oh-my-pi/pull/14249) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed compaction on Claude sessions with thinking sometimes keeping about half the recent history `compaction.keepRecentTokens` asks for, because each kept turn was counted at its signature's size ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed retry fallback rejecting a model with a smaller window by charging it the reasoning the active model's provider usage replayed, and the output cap charging reasoning a cold Responses session leaves out of its first request ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed anonymized session exports losing whether bash timing was shown ([#15468](https://github.com/can1357/oh-my-pi/pull/15468) by [@iliaal](https://github.com/iliaal))
- Added `omp --restore <session>`: resumes a session like `--resume`, then goes on with what its last process left unfinished when it crashed or was killed, both the interrupted turn and the subagents it was running (their results reach the parent as usual); Tern's session daemon now restarts omp with it after a crash
- Kept private prompt-cache routing keys out of shared sessions and HTML exports ([#15467](https://github.com/can1357/oh-my-pi/pull/15467) by [@iliaal](https://github.com/iliaal))
- Fixed late completion probes rewinding resumed conversations and stale history scans lowering parked subagent costs ([#15594](https://github.com/can1357/oh-my-pi/pull/15594) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Fixed `read.renderMarkdown` having no effect on plain-file reads: inline read previews now render Markdown files as formatted Markdown instead of numbered source ([#15007](https://github.com/can1357/oh-my-pi/issues/15007)).
- Fixed Claude refusing every turn (`reasoning_extraction`) in a session snapcompacted under Codex, Grok or another reasoning model, after a switch or resume; Claude turns, `/btw`, `/handoff` and compaction now read a reasoning-free copy of the archive ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the project-shared browser (headless or headed) reopening every page its previous run left open whenever it relaunched (after a crash, an out-of-memory kill, a normal stop, or a restart from `omp ps`); no session owned those pages, so they were never closed and piled up across restarts. Detaching it through `proc://<name>/mode`, which relaunched it the same way, is now refused ([#15561](https://github.com/can1357/oh-my-pi/pull/15561) by [@eggpeat](https://github.com/eggpeat))
- Fixed `omp models --json` reporting a scheduled model's superseded price in `cost`; it reports the price in force, such as DeepSeek V4 Pro's $0.30 / $1.20 card since 2026-09-14 ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Fixed `/shake` and automatic shake leaving old transcript rows in native scrollback or obscuring the start of a response beside the Todo HUD ([#15877](https://github.com/can1357/oh-my-pi/issues/15877)).
- Fixed `write` making Rust source files beginning with `#![...]` executable instead of preserving their permissions ([#15858](https://github.com/can1357/oh-my-pi/issues/15858)).
- Fixed the startup status bar preview showing a previous session's model instead of the default model ([#15865](https://github.com/can1357/oh-my-pi/issues/15865)).
- Fixed `length`-stop recovery with a lowered `compaction.thresholdTokens` counting the discarded output against the threshold, so a reasoning-only cut compacted without the retry hint and a truncated answer was discarded instead of kept ([#15870](https://github.com/can1357/oh-my-pi/issues/15870))
- Fixed `read` on a directory showing `(empty directory)` when the directory itself is unreadable, and silently omitting subdirectories it cannot list; it now errors for an unreadable root and marks unreadable subdirectories `[unreadable: …]` ([#15769](https://github.com/can1357/oh-my-pi/issues/15769)).
- Fixed isolated tasks losing the commits of a submodule added inside the isolation, leaving the merged checkout pinned to an unreachable commit ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed isolated task startup hanging or detaching an unrelated checkout when `.gitmodules` lists a submodule path that is absolute or contains `.`/`..` ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed `/live` and Ctrl+L starting live mode while the composer microphone was still loading its recognizer, which opened a second recorder and dictated into the hidden editor ([#15759](https://github.com/can1357/oh-my-pi/pull/15759))
- Fixed images in the transcript not opening their file; their placeholders and image chips now link to it ([#15872](https://github.com/can1357/oh-my-pi/pull/15872) by [@H4vC](https://github.com/H4vC))
- Fixed print mode returning success after length-stop recovery gave up; it now waits for the session to settle before choosing its exit code ([#15732](https://github.com/can1357/oh-my-pi/pull/15732) by [@nick-maderight](https://github.com/nick-maderight))
- Fixed browser `tab.click("text/…")` passing over a match a scroll container shows only a narrow strip of and clicking a later duplicate instead ([#15792](https://github.com/can1357/oh-my-pi/pull/15792) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `/advisor` status waiting on usage checks; it now renders immediately with cached quota data and refreshes usage in the background ([#15780](https://github.com/can1357/oh-my-pi/pull/15780) by [@mvid](https://github.com/mvid))
- Fixed task agents silently skipping `autoload-skills` entries for skills added after the session started ([#15723](https://github.com/can1357/oh-my-pi/pull/15723) by [@shyamsivakumar](https://github.com/shyamsivakumar))
- Fixed changed `initOptions` in `lsp.json` not applying when a new session reused an idle shared language server ([#15645](https://github.com/can1357/oh-my-pi/pull/15645) by [@mottopanikeiku](https://github.com/mottopanikeiku); [#15535](https://github.com/can1357/oh-my-pi/issues/15535))
- Fixed wake completions falsely reporting no output when the agent already messaged its owner over IRC ([#15834](https://github.com/can1357/oh-my-pi/pull/15834) by [@mg-mg-mg](https://github.com/mg-mg-mg)).
- Fixed a steered service readiness wait leaving the daemon broker polling until `ready.timeout`; the abandoned wait is now cancelled ([#15656](https://github.com/can1357/oh-my-pi/pull/15656))
- Fixed Cursor `;`-separated reads returning an image part's bytes as text ([#15635](https://github.com/can1357/oh-my-pi/pull/15635))
- Fixed auto-compaction ignoring `retry.waitForUsageReset` and abandoning the last compaction method on a provider-stated usage-limit reset past `retry.maxDelayMs` ([#15313](https://github.com/can1357/oh-my-pi/pull/15313))
- Fixed advisor compaction dropping the kept latest turn when the native compaction had to stop before it ([#15712](https://github.com/can1357/oh-my-pi/pull/15712))
- Fixed tool-approval steering: a message typed while viewing a subagent now steers the main session awaiting the approval, the message that denied a call is delivered ahead of older queued steers, and an equal-looking later steer no longer answers a new approval ([#15642](https://github.com/can1357/oh-my-pi/pull/15642))
- Fixed workpool item errors cancelling the entire batch; workers now continue with remaining items and report each result separately ([#15860](https://github.com/can1357/oh-my-pi/issues/15860)).
- Fixed image attachments with uppercase MIME types being dropped; supported image MIME types are now matched case-insensitively ([#15765](https://github.com/can1357/oh-my-pi/pull/15765) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))
- Fixed ordinary Bash commands emitting an ignored-readiness warning for placeholder-only `ready` fields, while preserving warnings for log/port conditions and service validation ([#15629](https://github.com/can1357/oh-my-pi/pull/15629) by [@nqrwhal](https://github.com/nqrwhal)).
- `openai-models-list` discovery reads the output limit from `top_provider.max_completion_tokens` (OpenRouter-shaped catalogs such as ModelRelay), so a bundled reference with a larger limit no longer makes requests the provider rejects ([#15652](https://github.com/can1357/oh-my-pi/pull/15652) by [@shanev](https://github.com/shanev))
- Fixed saved session history being replaced by incomplete rewrites after asynchronous disk write failures ([#15588](https://github.com/can1357/oh-my-pi/pull/15588) by [@jiwangyihao](https://github.com/jiwangyihao)).
- Fixed the `read` tool description inviting `:img` on PNG paths: it now says `:img` only rasterizes SVG/SVGZ files and raster images need no selector, and the `:img` error on a raster file says to read it without the selector ([#15671](https://github.com/can1357/oh-my-pi/pull/15671) by [@nick-maderight](https://github.com/nick-maderight))
- Corrected the `ast_grep` truncated-result advice to suggest `skip` pagination or narrowing instead of `increase limit`, which the tool schema does not accept ([#15532](https://github.com/can1357/oh-my-pi/issues/15532), [#15543](https://github.com/can1357/oh-my-pi/pull/15543) by [@peda-cos](https://github.com/peda-cos)).
- Fixed Cursor sessions with many MCP tools compacting unnecessarily or pausing automatic maintenance despite ample free context ([#15815](https://github.com/can1357/oh-my-pi/issues/15815)).
- Fixed switching a session or advisor to Cursor still counting the previous model's tool schemas toward context usage and compaction ([#15815](https://github.com/can1357/oh-my-pi/issues/15815)).
- Fixed todo reminders continuing the agent when the `todo` tool is disabled ([#12589](https://github.com/can1357/oh-my-pi/pull/12589) by [@anthonyrisinger](https://github.com/anthonyrisinger)).
- Fixed JS eval `completion()` handles created in one cell never resolving in a later cell, which left `wait(handles, { timeout })` hanging past its timeout ([#15756](https://github.com/can1357/oh-my-pi/issues/15756)).
- Closed `read :raw` line ranges now return only the requested content, and newline-terminated files report their actual line count ([#15810](https://github.com/can1357/oh-my-pi/issues/15810)).
- Fixed `/review` PR file assignments by including exact per-file diff URLs and preserving 1-based indexes across excluded files ([#15463](https://github.com/can1357/oh-my-pi/pull/15463) by [@tkossak](https://github.com/tkossak))
- Fixed `grep` and `ast_grep` returning no matches for a `path` glob that names directories, such as `src/{api,web}` or `src/we?`; matched directories are now searched recursively like a plain directory path, so `src/*` also searches files in `src`'s subdirectories ([#15760](https://github.com/can1357/oh-my-pi/issues/15760))
- Fixed a structured `display()` value in an Eval cell appearing twice in the TUI and collab view, as text in the cell box and again as the JSON tree; it now shows once, as the tree, while the model still sees the text ([#10778](https://github.com/can1357/oh-my-pi/issues/10778), [#12730](https://github.com/can1357/oh-my-pi/pull/12730) by [@F0Rextasy](https://github.com/F0Rextasy))
- `omp auth-gateway serve` now bounds its broker-backed session cache instead of growing with every distinct client session ([#15841](https://github.com/can1357/oh-my-pi/issues/15841)).
- Fixed the run ending when a reasoning model stops with only a signed thinking block and no reasoning text (seen with Gemini 4 via OpenRouter); the agent now continues it like any other thinking-only stop ([#15837](https://github.com/can1357/oh-my-pi/issues/15837))
- Fixed `openai-models-list` discovery ignoring a model's top-level `max_output_tokens` / `max_completion_tokens`, which let gateway models inherit an output cap as large as the whole context window and send oversized `max_completion_tokens` ([#15811](https://github.com/can1357/oh-my-pi/issues/15811))
- Fixed the standalone binary crashing with `Settings not initialized` when resuming or starting a TUI session with an extension whose dependencies clear `require.cache` (e.g. `request-promise` via `pi-messenger-bridge`) ([#15799](https://github.com/can1357/oh-my-pi/issues/15799))
- Python Eval displays preserve integers outside JavaScript's safe range as decimal strings in structured JSON instead of silently rounding them ([#15847](https://github.com/can1357/oh-my-pi/issues/15847)).
- Loop-watchdog stalls while Mnemopi truncates the recall query for compaction or background first-turn recall are now logged under `mnemopi.recall` instead of `unknown` ([#15413](https://github.com/can1357/oh-my-pi/pull/15413) by [@jaredlyon](https://github.com/jaredlyon)).
- Clarified the `/session pin` description: it pins a stored OAuth account to the current provider for this session only ([#15479](https://github.com/can1357/oh-my-pi/pull/15479) by [@iacore](https://github.com/iacore))
- Fixed `/jobs` doing nothing in a focused subagent view: it now lists that subagent's own background jobs, as does the jobs pill's sheet, without a way to cancel them; `/jobs kill` still requires returning to the main session ([#15161](https://github.com/can1357/oh-my-pi/pull/15161) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Fixed a suspended JavaScript Eval cell resolving `artifact://` and `local://` paths against the session directories of another cell that started while it was awaiting ([#15409](https://github.com/can1357/oh-my-pi/pull/15409) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `read` ignoring JSON and JSONL `?q=` filters and pagination for `local://` and `artifact://` files ([#15767](https://github.com/can1357/oh-my-pi/issues/15767)).
- Agents can now read saved context notes without accidentally clearing them ([#15748](https://github.com/can1357/oh-my-pi/pull/15748) by [@Komzpa](https://github.com/Komzpa))
- Fixed startup without an explicit model picking an unrelated authenticated provider instead of the first available model in the configured default fallback chain ([#15781](https://github.com/can1357/oh-my-pi/pull/15781) by [@mvid](https://github.com/mvid))
- Fixed browser `tab.click("text/…")` timing out when the match was below the fold or the tab was in the background ([#14864](https://github.com/can1357/oh-my-pi/pull/14864) by [@alnaggar-dev](https://github.com/alnaggar-dev), [#15496](https://github.com/can1357/oh-my-pi/pull/15496) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser clicks the page never received, such as on a disabled control or inside an `inert` subtree, reporting success; the call now fails saying the browser did not deliver the click ([#15496](https://github.com/can1357/oh-my-pi/pull/15496) by [@will-bogusz](https://github.com/will-bogusz))
- `tab.ariaSnapshot()` no longer prints the value of a password field; it shows one bullet per character, as `tab.observe()` and the screen do, so a typed or browser-autofilled password stays out of the model's context ([#15502](https://github.com/can1357/oh-my-pi/pull/15502) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed project discovery loading plugins, `SYSTEM.md`, rules, context files, and skills from a `.zeta` at a shared temporary root (`/tmp`, `/var/tmp`, the temp dir) above an unanchored working directory, or, when `HOME` is overridden, from another account's `~/.zeta` outside the working directory's git repository ([#15719](https://github.com/can1357/oh-my-pi/pull/15719) by [@alphastorm](https://github.com/alphastorm))
- Fixed browser `tab.text()` and `tab.html()` (and the same calls on a frame) throwing when called without a selector; they now read the page body on Chrome, Tern and cmux ([#15599](https://github.com/can1357/oh-my-pi/pull/15599) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed skill-description compression re-sending the same smol-model requests every session for a skill whose compressed answer was rejected (over 12 words or 160 characters) or cut off at the token limit; that model is no longer asked again for that skill (a newly selected smol model is), and compressions still running at exit get up to 4 seconds to save ([#13291](https://github.com/can1357/oh-my-pi/issues/13291), [#15720](https://github.com/can1357/oh-my-pi/pull/15720) by [@alphastorm](https://github.com/alphastorm))
- Fixed the macOS `computer` tool keeping the display awake for the rest of the session after a native call hung; the call's timeout or closing the session now lets it sleep ([#15414](https://github.com/can1357/oh-my-pi/pull/15414) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed an agent definition whose `tools` value names no tool (`tools: ""`, a number, a list without strings) getting every default built-in tool; it now gets none, like `tools: []` ([#15718](https://github.com/can1357/oh-my-pi/pull/15718) by [@alphastorm](https://github.com/alphastorm))
- Fixed `page.waitForNetworkIdle` in a browser `run` timing out on a request an earlier `run` started ([#15495](https://github.com/can1357/oh-my-pi/pull/15495) by [@alnaggar-dev](https://github.com/alnaggar-dev) and [@will-bogusz](https://github.com/will-bogusz))
- Fixed a tab that a relay page opens over its own CDP session (`Target.createTarget`) landing in a separate Chrome window with `newWindow`, under an id omp could not attach to, activate or close; it now opens as a relay tab in that page's browser ([#15494](https://github.com/can1357/oh-my-pi/pull/15494) by [@alnaggar-dev](https://github.com/alnaggar-dev) and [@will-bogusz](https://github.com/will-bogusz))
- Fixed an Anthropic refusal fallback redeeming its fallback credit with an outdated system prompt and tools after switching models; it now sends a fresh request ([#15702](https://github.com/can1357/oh-my-pi/pull/15702) by [@H4vC](https://github.com/H4vC))
- Fixed OpenAI/Codex auto-compaction failing with "Remote compaction input exceeds the context window" after a turn's final response pushed history past the window; native compaction now compacts the history before the kept recent turns, which stay in context as-is ([#15712](https://github.com/can1357/oh-my-pi/pull/15712) by [@H4vC](https://github.com/H4vC))
- Fixed `omp commit`, `/git`, and other agent commits skipping the signature when Git's `commit.gpgsign` is enabled; they now sign with the configured key, and a signing failure leaves HEAD unchanged ([#14810](https://github.com/can1357/oh-my-pi/issues/14810))
- Fixed rejected `task` calls appearing successful to SDK hosts instead of reporting a tool error ([#15573](https://github.com/can1357/oh-my-pi/issues/15573))
- Fixed `read` claiming regenerated images were identical when their pixels changed at the same path ([#15668](https://github.com/can1357/oh-my-pi/issues/15668))
- Fixed SDK embedders leaking every disposed `AgentSession` that owned its MCP manager, so long-lived processes that create and dispose many sessions grew memory without bound ([#15386](https://github.com/can1357/oh-my-pi/issues/15386))
- Fixed retry model fallback stopping at a fallback model whose provider is outside a subagent's `task.agentAccountPools` pool; that model is now skipped and the next fallback model is tried ([#15423](https://github.com/can1357/oh-my-pi/issues/15423))
- Fixed the system prompt's `## MCP Server Instructions` section following MCP connection order, so a server connecting late or reconnecting no longer reorders it and rewrites the prompt cache; servers are now listed by name ([#15705](https://github.com/can1357/oh-my-pi/issues/15705))
- Fixed `read` reporting an HTTP 204 No Content response as a failed fetch; it now returns an empty successful read ([#15667](https://github.com/can1357/oh-my-pi/issues/15667))
- Fixed `/mcp reauth` failing with `Could not discover OAuth endpoints` when a server's 401 challenge is a bare `Bearer resource_metadata="…"`; the advertised protected-resource metadata URL is now used ([#15690](https://github.com/can1357/oh-my-pi/issues/15690))
- Fixed extension `agent_end` events reporting a background-job wait as a scheduled continuation; they now carry `awaitingAsyncWork: true` alongside `willContinue` ([#15348](https://github.com/can1357/oh-my-pi/issues/15348))
- Fixed auto-compaction waiting out provider retry delays longer than `retry.maxDelayMs` (e.g. a 16-hour `retry-after`); it now tries the next configured method or reports the failure ([#15311](https://github.com/can1357/oh-my-pi/issues/15311))
- Fixed `read skill://<name>` for a name no loaded skill owns hanging for the rest of the turn while an MCP server was still connecting or reconnecting; it now reports `Unknown skill` after at most 5 seconds ([#15648](https://github.com/can1357/oh-my-pi/issues/15648))
- Fixed `/new` ignoring "Start in Plan Mode" (`plan.defaultOnStartup`): the new session now starts in plan mode like the first one ([#15627](https://github.com/can1357/oh-my-pi/issues/15627))
- Fixed Cursor models' Read on an image file returning the file's raw bytes as text; Read now loads the image, and Cursor's text-only Read frame gets a short image note instead of the bytes ([#15630](https://github.com/can1357/oh-my-pi/issues/15630))
- Fixed Mermaid diagrams showing `&lt;`, `&gt;`, `&amp;`, and `#quot;` literally inside labels instead of `<`, `>`, `&`, and `"` ([#15619](https://github.com/can1357/oh-my-pi/issues/15619))
- Fixed background job results already consumed by an eval `agent()` handle's `wait()` being re-injected as one `async-result` follow-up when the cell ran past the 5-minute job retention window ([#15625](https://github.com/can1357/oh-my-pi/issues/15625))
- Fixed `/tan` missing the parent's prompt cache: it advertised the parent's `xd://` tools as top-level tools and dropped `ask`, so its tool list no longer matched ([#15578](https://github.com/can1357/oh-my-pi/issues/15578))
- Fixed forks and reloaded sessions missing the prompt cache after a compaction in a session with `eval` history ([#15695](https://github.com/can1357/oh-my-pi/issues/15695))
- Fixed compiled-binary extensions importing `@oh-my-pi/pi-tui` subpaths such as `terminal-capabilities`, `chat/svg-figure` or `theme/index` loading a second copy from their own `node_modules` instead of sharing the host's terminal, theme and figure state ([#15659](https://github.com/can1357/oh-my-pi/issues/15659))
- Fixed marketplace plugins that keep their version in `.claude-plugin/plugin.json` never being reported by `omp plugin upgrade` or auto-updated; for plugins shipped inside the marketplace, `plugin.json`'s version now also takes precedence over the catalog entry's, as in Claude Code ([#15585](https://github.com/can1357/oh-my-pi/issues/15585))
- Fixed a steer (queued user or peer message) waiting behind a `bash` service's readiness wait (`name` + `ready`) for up to `ready.timeout`; the call now returns early with the service still starting, inspectable via `proc://<name>` ([#15653](https://github.com/can1357/oh-my-pi/issues/15653))
- Fixed `omp install`/`omp plugin install`, `upgrade`, `uninstall` and `doctor --fix` failing with `Executable not found in $PATH: "bun"` for npm and Git plugins on machines without Bun installed, such as standalone-binary installs ([#15480](https://github.com/can1357/oh-my-pi/issues/15480))
- Fixed `/plugins enable` and `/plugins disable` in the TUI not refreshing skills, commands, task agents and MCP servers until a reload, and rejecting npm plugins ([#15383](https://github.com/can1357/oh-my-pi/issues/15383))
- Fixed local memory injection and `learn` using the `Settings` directory instead of the session's project directory, so SDK hosts sharing one `Settings` across projects injected another project's lessons and never the project's consolidated summary; sharpshooter memory follows the session directory too ([#15375](https://github.com/can1357/oh-my-pi/issues/15375))
- Fixed ACP bash approvals ignoring `bash.patterns`, and an earlier "Always allow" letting critical commands such as `rm -rf /` run without a prompt ([#15473](https://github.com/can1357/oh-my-pi/issues/15473))
- Fixed hashline edits silently dropping the tail of a line that `read` or `grep` had cut at the column limit; such an edit is now refused until a `:raw` read shows the full line ([#15649](https://github.com/can1357/oh-my-pi/issues/15649))
- Fixed isolated tasks failing on linked worktrees with initialized recursive submodules and leaving updated submodule pins unreachable after cleanup ([#15457](https://github.com/can1357/oh-my-pi/issues/15457))
- Fixed `/tan` missing the parent's prompt cache by advertising `xd://` tools top-level and omitting `ask` ([#15578](https://github.com/can1357/oh-my-pi/issues/15578)).
- Fixed prewalk switching models during read-only MCP lookups through `write xd://` when the server marks the tool read-only ([#15994](https://github.com/can1357/oh-my-pi/issues/15994))
- Fixed Ctrl+C printing `9;5u` in the shell after force-quitting omp with a third Ctrl+C while it was still closing the session
- Fixed Smart unexpected-stop recovery continuing finished answers, which added extra "nothing more to add" turns
- Fixed `grep` searching only the first 4 MB of a file named directly, so later matches were reported as absent; the whole file is now searched, and a multiline pattern, which still reads only the first 4 MB, says so in its no-match headline ([#15942](https://github.com/can1357/oh-my-pi/issues/15942))
- Fixed browser `uploadFile` failing with "Not allowed" through the relay or into a Chrome on another machine, stalling behind macOS folder-privacy prompts, and breaking the tab on large drop-zone files ([#15489](https://github.com/can1357/oh-my-pi/pull/15489) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser `uploadFile` sending a stale copy of a file rewritten without changing its size or timestamp, failing on folders that contain a symlink loop, and deleting copies a still-open attached page could read after a repeat upload
- Fixed plan mode (including plan-yolo) looping on `write xd://propose` forever when an extension provides a tool named `write`; the extension tool is left out of plan mode with a warning, since only the built-in `write` can submit plans ([#14030](https://github.com/can1357/oh-my-pi/issues/14030), [#14438](https://github.com/can1357/oh-my-pi/pull/14438) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed legacy Mnemopi bank databases staying open after the recall bank probe, which could block deleting them on Windows ([#14584](https://github.com/can1357/oh-my-pi/pull/14584) by [@yshihao636](https://github.com/yshihao636))
- Fixed startup skipping a configured default fallback whose provider authenticates only through another provider's key (e.g. `xai-oauth` via `XAI_API_KEY`) and picking an unrelated model instead ([#15781](https://github.com/can1357/oh-my-pi/pull/15781))
- Fixed slower startup when the configured default model is unavailable and no fallback chain is configured ([#15781](https://github.com/can1357/oh-my-pi/pull/15781))
- Fixed `read` directory listings printing a directory's raw listing error, whose tabs, newlines, or control characters could break the transcript; `[unreadable: …]` is now a single bounded line ([#15789](https://github.com/can1357/oh-my-pi/pull/15789))
- Fixed a `^` model mention sent while the agent is working (steer, follow-up, or queued skill prompt) never announcing its new `m<N>` alias to the model ([#14093](https://github.com/can1357/oh-my-pi/issues/14093), [#14322](https://github.com/can1357/oh-my-pi/pull/14322) by [@holny](https://github.com/holny))
- Fixed large session files ending in a truncated record not being repaired on load, unlike small ones ([#14582](https://github.com/can1357/oh-my-pi/pull/14582) by [@yshihao636](https://github.com/yshihao636))
- Fixed a read-only subagent's rejected `write` reading as a dead end: when `yield` is available, the rejection now names it as the way to return the content ([#14308](https://github.com/can1357/oh-my-pi/issues/14308), [#14470](https://github.com/can1357/oh-my-pi/pull/14470) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed `/retry` after an interrupt leaving later advisor notes and extension asides unable to wake the agent until the next typed prompt ([#14831](https://github.com/can1357/oh-my-pi/pull/14831) by [@daandden](https://github.com/daandden))
- Fixed session titles and idle recaps disappearing after a corrupt `history.db` was quarantined and recreated, and a briefly busy store disabling the session index for the rest of the session ([#13929](https://github.com/can1357/oh-my-pi/issues/13929), [#14361](https://github.com/can1357/oh-my-pi/pull/14361) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed pasting a screenshot with ⌘V into omp running over SSH from Tern or kitty failing with `Clipboard is empty` or `Image not found` ([#15369](https://github.com/can1357/oh-my-pi/pull/15369) by [@LoneExile](https://github.com/LoneExile))
- Fixed native hook discovery silently ignoring hooks symlinked into `hooks/pre` or `hooks/post` ([#14189](https://github.com/can1357/oh-my-pi/issues/14189), [#14536](https://github.com/can1357/oh-my-pi/pull/14536) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed headless Linux containers without a system D-Bus logging a `Failed to acquire power assertion` warning on every turn; the missing backend is now noted once at debug level ([#14591](https://github.com/can1357/oh-my-pi/pull/14591) by [@tahakotil](https://github.com/tahakotil))
- Fixed a project's daemon broker staying unreachable after its runtime directory was deleted while it ran (`proc://`, `wait`, shared LSP and the shared browser failed with `connect ENOENT …/broker.sock`); the broker now releases the project within seconds of losing its socket and the next request starts a fresh one ([#14466](https://github.com/can1357/oh-my-pi/pull/14466) by [@nick-maderight](https://github.com/nick-maderight))
- Fixed SQL and Redis sessions stalling after a rewrite raced an append; later turns now republish after the backend recovers ([#15612](https://github.com/can1357/oh-my-pi/pull/15612) by [@sjawhar](https://github.com/sjawhar))
- Fixed OpenAI Codex web search failing with "No Codex OAuth credentials found" when only `OPENAI_CODEX_OAUTH_TOKEN` is set ([#12537](https://github.com/can1357/oh-my-pi/issues/12537), [#14337](https://github.com/can1357/oh-my-pi/pull/14337) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed `yield` rejecting a valid `data` result when a non-strict provider also filled `error` with a placeholder such as `unused` or `n/a`; a real error alongside `data` is still rejected, now with exact resend instructions ([#15633](https://github.com/can1357/oh-my-pi/pull/15633) by [@Komzpa](https://github.com/Komzpa))
- Fixed secret redaction replaying Gemini tool calls with their original `thoughtSignature` after rewriting the call arguments; a rewritten call now drops the signature, as rewritten thinking already did ([#14392](https://github.com/can1357/oh-my-pi/pull/14392) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed Claude marketplace plugin MCP servers declaring a sub-second `timeout` (e.g. SAP's `"timeout": 600`) never loading; values below Claude Code's 1000 ms minimum are now ignored with a warning so the default timeout applies ([#12485](https://github.com/can1357/oh-my-pi/issues/12485), [#14574](https://github.com/can1357/oh-my-pi/pull/14574) by [@oleg494](https://github.com/oleg494))
- Fixed automatic retries looping without end when the primary model's cooldown expired mid-retry: the session no longer switches back to the primary while a retry is still in flight, and returns to it on the next prompt ([#14611](https://github.com/can1357/oh-my-pi/pull/14611) by [@MiloMMIN](https://github.com/MiloMMIN))
- Fixed web search providers garbling non-UTF-8 responses; they now decode with the charset declared in `Content-Type` (or a `<meta charset>` tag), the same way fetched pages are ([#15304](https://github.com/can1357/oh-my-pi/pull/15304) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Fixed `openai-models-list` discovery ignoring a flat `max_tokens` output limit on `/v1/models` rows, which pinned such models to the 32K default ([#13062](https://github.com/can1357/oh-my-pi/issues/13062), [#14403](https://github.com/can1357/oh-my-pi/pull/14403) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed long replies dropping lines from scrollback or replaying them duplicated and out of order when status widgets stay taller after a turn or transient HUDs close ([#15820](https://github.com/can1357/oh-my-pi/pull/15820) by [@emmahyde](https://github.com/emmahyde))
- Fixed a stale "Working…" row staying under a focused subagent after it finished while the main session kept running ([#15820](https://github.com/can1357/oh-my-pi/pull/15820))
- Fixed `omp update` failing when a bunfig `minimumReleaseAge` or npmrc `min-release-age` supply-chain cooldown rejects the just-published release; self-update now overrides the cooldown for the pinned version it installs ([#14581](https://github.com/can1357/oh-my-pi/pull/14581) by [@morri-son](https://github.com/morri-son))
- Fixed `agent://<id>` returning a message-result subagent's first result after it completed a parent-requested follow-up; reads now return its latest completed result ([#15707](https://github.com/can1357/oh-my-pi/pull/15707) by [@mg-mg-mg](https://github.com/mg-mg-mg))
- Fixed sloppy edits silently dropping an operator when one `*** Find` was followed by two (e.g. `*** Insert Before` and `*** Replace`); the payload is now rejected with an error naming both and nothing is applied ([#14357](https://github.com/can1357/oh-my-pi/pull/14357) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed a cancelled Python tool install (e.g. `uv tool install`) falling through to `pip` with the aborted signal and leaving the install progress running ([#15750](https://github.com/can1357/oh-my-pi/pull/15750) by [@harshaygadekar](https://github.com/harshaygadekar))
- Fixed auto-learn captures rewriting earlier OpenAI Responses history after a learning tool call, which broke prompt-cache reuse ([#14099](https://github.com/can1357/oh-my-pi/pull/14099) by [@nanbloom001](https://github.com/nanbloom001))
- Fixed `/shake images` leaving the context percentage unchanged; the tokens freed by the removed images are now reported and subtracted from the context meter right away ([#5029](https://github.com/can1357/oh-my-pi/issues/5029), [#14367](https://github.com/can1357/oh-my-pi/pull/14367) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed `/fork pane|tab` and Herdr `ctx.ui.openTerminal()` launches failing in panes whose shell is not POSIX (such as Nushell); Herdr launches now type only the path of a self-deleting `/bin/sh` script and no longer ask for POSIX-shell confirmation ([#15262](https://github.com/can1357/oh-my-pi/pull/15262) by [@shgew](https://github.com/shgew))
- Fixed Eval `read("artifact://N")` returning an "Unbounded raw read blocked" notice instead of the text for artifacts over 50 KB that belong to another session, or when the session has no artifacts directory, in JavaScript and Python cells ([#15410](https://github.com/can1357/oh-my-pi/pull/15410) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed cancelling a bash job hard-killing it before its TERM cleanup handlers could run; it now gets up to one second to clean up before termination is forced ([#15709](https://github.com/can1357/oh-my-pi/pull/15709) by [@mg-mg-mg](https://github.com/mg-mg-mg))
- Fixed the transcript collapsing to one line per entry after switching between a subagent and the main session mid-turn when an earlier turn left a tool call without a result ([#12247](https://github.com/can1357/oh-my-pi/issues/12247), [#15466](https://github.com/can1357/oh-my-pi/pull/15466) by [@shgew](https://github.com/shgew))
- Fixed a retried tool losing its transcript card when the view was rebuilt (subagent focus switch, overlay close) while the tool was still running
- Fixed Chrome element handles' `uploadFile()` failing "Node is not a file input element" on labels, chooser triggers and drop zones; it now uploads like `tab.uploadFile()` ([#15918](https://github.com/can1357/oh-my-pi/pull/15918) by [@will-bogusz](https://github.com/will-bogusz))
- Browser `tab.fill` in Chrome sets colour, date, time and range inputs to the given value (it typed `2026-10-12` as `61012-02-02` and left a colour at `#000000`), and refuses a value the input rejects ([#15914](https://github.com/can1357/oh-my-pi/pull/15914) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser `uploadFile` on a control that opens `showOpenFilePicker()` hanging the cell until the tab was killed; it now fails at once with a named error ([#15915](https://github.com/can1357/oh-my-pi/pull/15915) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed every later file chooser on a page doing nothing, the user's own clicks in a relay tab included, after browser `uploadFile` clicked a chooser trigger or drop zone ([#15915](https://github.com/can1357/oh-my-pi/pull/15915) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser `uploadFile` in Chrome reporting success with no file attached when the element opens no file chooser and nothing on the page reads the dropped files; it now fails and says what to target ([#15919](https://github.com/can1357/oh-my-pi/pull/15919) by [@will-bogusz](https://github.com/will-bogusz))
- Relay mode: when Chrome detaches omp from a tab it drives (a password manager's inline menu loading in the page), the call fails at once saying why and omp reattaches to the same tab, instead of every later call timing out and reopening failing with `No page targets available` ([#15920](https://github.com/can1357/oh-my-pi/pull/15920) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the macOS `computer` tool letting the display sleep and lock in a turn that went 5 minutes without a desktop action; it now keeps the display awake until the turn ends or asks for your answer, then lets it sleep ([#15762](https://github.com/can1357/oh-my-pi/pull/15762) by [@will-bogusz](https://github.com/will-bogusz))

### Removed

- Removed the unused `editor.handoffSession` setting (and its row in `zetacode config`): `/editor` hands the session to the editor on the command line, so nothing read the key.
- Removed Codex Code Mode and its `providers.openai-codex.codeMode` / `providers.openai-codex.codeModeDirectTools` settings; Codex models always use the full direct tool surface.

## [1.2.1] - 2026-10-13

- Multi-surface coexistence: a `zetacode serve` instance now publishes itself to `<config root>/serve.json` (`0600`, atomic replace, removed on clean shutdown, `ZETA_SERVE_REGISTRY` overrides the path) and answers `GET /api/server/identity` with `{ app, version, pid, startedAt, webUrl, statsUrl, gatewayUrl }`, so a second surface can discover it before binding. A starting `zetacode serve` whose target port is already held by a healthy instance of **the same version** no longer dies on `EADDRINUSE`: it prints the running instance's URLs and exits `0`, pointing at how to force a separate instance (`--web-port`/`--gateway-port`) or restart the old one. A **different version** is never taken over silently — the running and expected versions are reported with the same two options and the command exits `1`. A stale registration (dead `pid`) is deleted and reported instead of believed, and an instance answering on another port is only reported, because an explicit `--web-port` is a deliberate second listener. The desktop shell runs the same discovery first (`desktop/src/serve-discovery.ts`, same file and endpoint): a healthy same-version instance is reused — window, stats window and gateway calls follow its published URLs, its workspace and (for a desktop-spawned instance) its open-bridge secret are adopted, nothing is spawned, and quitting leaves it running — while a version mismatch is shown as a choice instead of a later bind error. The identity endpoint rides the existing gateway access gate (non-loopback callers still need `remote.token`); stats-only instances publish nothing, since no probe could confirm them.
- `zetacode serve` no longer breaks git and tracking panels when it runs on non-default ports. The web-ui child is now told the real service origins (`ZETA_WEB_GATEWAY_URL` from `--gateway-port`, plus the stats URL) on every spawn path, and web-ui resolves its Next-side proxy targets from that origin (`lib/proxy-targets.ts`) instead of assuming `127.0.0.1:30142`. Because Next freezes `next.config` `beforeFiles` rewrite destinations into the build output, the gateway paths Next serves itself (`/api/tracking`, `/api/git/branches|checkout|branch`) proxy per request (`lib/gateway-proxy.ts`) and `/api/tracking` is dispatched in-process by the listener (`classifyRequest`). The `/api/git/:path*` rewrite is gone: it both shadowed the local `status`/`diff` handler…
- The interactive CLI now installs the pi-tui text source at TUI startup (`wireTuiTexts`), so every panel lookup through `tuiText`/`tuiTextFmt` resolves against the live `Messages` catalogue instead of always falling back to inline English, and a `/language` switch re-resolves on the next render. Previously the bridge was never called and the whole pi-tui surface stayed English.
- The welcome tips are localised: `tipN` catalogue keys are realigned to the `tips.txt` line they translate (they had drifted several lines out of step) and now cover every line, including the `#`/`/`/`!`/`$` prompt hints, the `jevify` tip, the self-reconfigure tip, and the Tern habitat tip. English output is unchanged (the lines keep their `{key:…}` placeholders and markdown links).
- The CLI welcome banner is the upstream logo lockup (ζ mark + half-block `Zeta` wordmark, version under the wordmark, tip below). The composer no longer resolves model/provider labels, LSP servers or recent sessions for the banner, and the corresponding welcome i18n keys are gone.
- `zetacode update` on Windows no longer resolves the npm-installed POSIX `zetacode` sh script (which Windows cannot execute, so the version probe always failed) and refuse to replace itself: the shim lookup now tries executable extensions (`.cmd`/`.exe`, in PATHEXT order) before the bare name, matching `cmd.exe` itself.
- The self-update binary fallback asks for the asset a release actually publishes (`zeta-cli-<os>-<arch>[.exe]`) instead of one derived from the command name (`zetacode-*`), which 404'd for every user. The name now comes from `packages/utils/src/release-assets.ts`, and `scripts/check-release-asset-names.ts` pins the updater, the build outfiles and the `release_binary` upload matrix to the same set.
- Update-failure recovery hints point at our own installers (`https://linxira-os.github.io/install.sh` on POSIX, `install.ps1` on Windows) instead of the upstream `omp.sh/install` one-liners.
- `zetacode update` merges `NODE_EXTRA_CA_CERTS` into its release metadata, binary download and npm registry requests (the same TLS wrapper inference uses), so a TLS-inspecting corporate proxy no longer fails the whole update with `SELF_SIGNED_CERT_CHAIN`.
- A browser run cancelled while it was navigating now always stops the load it abandoned. The cancel path read the pending main-frame navigation from the CDP `request` event the browser had already sent, which can still be queued in the tab worker when the abort arrives: a cancel landing in that window left the navigation loading, so the cancelled navigation replaced the page later and held up the interception restore. The main-frame navigations a run starts (`tab.goto`, `tab.reload`, `tab.back`, `tab.forward`) are now recorded where they start and released when the browser answers them — a response, or the navigation's own failure.

## [1.2.0] - 2026-10-12

- Tracking integrity (four fixes): the read-modify-write of `status.json` and the global tracking index now runs entirely inside a `withFileLock` lease (the lock spans the whole cycle, not just the write) and uses atomic replacement, while `tracking_update` declares same-batch serialization — two writers no longer lose each other's updates. `actions.jsonl` rotates at 5 MB × 3 as `actions.<date>.jsonl.log`, and every reader (the web panel, `/tracking log`) uses bounded tail reads. The web UI tracking panel gains the `summaries/` tab (previously declared but never rendered). `GET /api/tracking`'s `updatedAt` is now content-derived (the newest mtime in the tracking directory) instead of advancing on every request.
- Subagent fan-out now tightens itself under memory pressure: `task` samples on every concurrency-permit acquisition (process RSS + system free memory) and lowers that decision's effective ceiling when below threshold (tight ≤8, critical ≤2; an already-smaller configured value is kept, never raised), warning once per level in the log. The `task.maxConcurrency` setting itself is untouched, running work is neither killed nor added, and the ceiling returns to the configured value once memory recovers.
- Crash reports (stderr and `~/.zeta/logs/native-*.log`) now carry process and system memory counters: process RSS/peak/commit and system free/total/commit limit. The reads go through syscalls and are written allocation-free via a preallocated stack buffer, so even a true OOM lands the numbers in stderr before the report body itself.
- Added a dynamic mini-tool framework and its first tool, time (`/tool time on|off`; while enabled, user messages carry a sent timestamp so the model can get the current accurate time at any point).
- Added the `mode` tool: the model can enter plan mode itself (including the `parallel`/`iterative`/`ultra` workflows) and can only exit a plan mode **it started**; exiting a user-started plan mode, or entering/exiting `goal`/`vibe` mode, is always refused (those two grant autonomy, so only the user may start them — the model can only ask). Plan-mode provenance is recorded in session state (absent = user-started), so an agent cannot slip past the gate that only the user may open.
- The system prompt now states the host-CLI tool rules: use the `github` tool (not shell `gh`) for GitHub work (CI runs, PRs, issues, search), poll CI with `op: run_watch` (omit `run` for the current HEAD) instead of a `gh run watch` loop, and use the `tea` tool (not shell `tea`) for Gitea. The rule previously lived only in the "make CI green" conditional prompt, so everyday sessions still polled via the shell.
- The bash tool's elevation and credential rules now also land in the model-facing prompt: by default **never persist to disk** — for the local machine, or a container on it, the SSH key / root password is kept only in context memory for reuse against that target (nothing written to the credential store, settings, notes, plans, artifacts, or logs, and never echoed back; context memory does enter your own session record under `.zeta/sessions/`, which is your data directory and not in the repo). Remote hosts and third-party services are never stored at all by default — the user types them in a visible window. **When the user explicitly asks, the user wins**: if they tell you to remember it, or to write the usage into docs, do so. Previously "never store credentials" was a blanket rule, and the two elevation paths (`pty: true` overlay, popping the elevation window) lived only in `docs/` for on-demand reading with zero mention in the model-facing prompt.

### Added

- The bundled office skills (`docx`, `xlsx`, `pptx`, `pdf`) are installed into your own skills directory (`~/.zeta/agent/skills/`) as files you can edit and version, on first session startup or with `zetacode skill install-official`; files you edited are never overwritten, and `--uninstall` hands the names back to the built-in provider.
- Added the tea tool suite: a `tea` CLI integration for self-hosted Gitea (and gitea.com) covering repo/issue/pull-request/checkout/merge/release ops (`repo_view`, `repo_create`, `issue_*`, `pr_*`, `release_*`), with every create-type operation verified by reading back through the API (`tea repo create` has a history of silent failure). Enabled via `gitea.enabled`, off by default.
- Added WeChat `/api/v1/wechat` login (QR + status polling) with legacy iLink fallback, persisted peer→context_token bindings in `web.yml` (`channels.wechat.peerTokens`), and a `POST /api/channels/wechat/unbind` gateway route that resets the channel and clears credentials.

### Changed

- OTLP telemetry export is now **hard-disabled**: the `telemetry.otlpExportEnabled` setting (previously on by default) is removed and startup is gated by a literal `TELEMETRY_EXPORT_ENABLED = false`. We have no telemetry backend, so no `OTEL_EXPORTER_OTLP*` endpoint ever receives anything, and there is no way to turn it on (no setting, no env var, no CLI flag). We will add it back deliberately once we run our own collector. The gate is pinned by `brand-check` MUST_CONTAIN/MUST_NOT_CONTAIN guards so an upstream merge cannot revert it. The OTLP `service.name` fallback also changes from `oh-my-pi` to `zeta`.
- Brand-surface regression fix: an upstream `chore: branding` commit (`d35a9067233`, 2026-09-24) came in with the v18.8.x merge and reverted model-visible prompts and user-visible CLI text to `omp` — the system prompt's first line (from which the model calls itself "omp's coding assistant"), the `cfg://`/browser/ida/isolation-error/security/cleanse/live/commit prompts, help and example text (`zetacode bench`, etc.), the `text-predict`/`tiny worker`/`lsp mux`/RPC wire process banners, and the related `docs/` pages all return to Zeta naming. `brand-rules.ts` gains 6 MUST_CONTAIN + 4 MUST_NOT_CONTAIN guards; the CHANGELOG is exempt per the "released entries are immutable" convention ([#83](https://github.com/Linxira-OS/linxira-zeta/pull/83))
- The CLI's canonical command name is fixed as `zetacode` (the four-product standard names — zetawork / zetacode / zetaide / zetaeditor, no hyphens): `--help` usage and examples, the `update` banner, the `--resume` hint, profile alias generation, and all per-command help and docs now use the standard name. `zeta-c`/`zeta-cli`/`zeta-ide`/`zeta-i`/`zeta-editor`/`zeta-e`/`zeta-work` remain npm bin compatibility aliases with unchanged behavior; shims and asset filenames (`zeta-c.cmd`, etc.) are unaffected.
- **Full upstream brand-residue sweep**: every upstream identifier the product exposes is renamed to Zeta, including OS/browser-visible parts — the macOS bundle id and app name (`dev.zeta.oauth-callback.*` / `Zeta OAuth Callback.app`), the Windows HKCU registry transaction name, the Linux desktop entry and `zeta-auth` protocol, the file-descriptor URL scheme (`zeta-descriptor://`), the file-lock prefix, and the XDG state directory; process titles (`zetacode lsp mux`), the IDA daemon name (`zeta.ida.*`), named-pipe and socket paths, User-Agent, the AWS STS `RoleSessionName`, telemetry metric and TUI semantic roles, and the custom element name of exported HTML. The session-recording format extension changes `.ompcast` → `.zetacast`. Dev wrappers and link scripts become `scripts/zetacode` / `scripts/link-zetacode.sh` and no longer write `omp` into the global bin.
- **⚠️ Storage key namespace change (migration needed)**: the Redis session store's default key prefix changes from `omp:sessions:` to `zeta:sessions:`, and the SQL session store's default table name from `omp_session_files` to `zeta_session_files`. Existing deployments on the defaults will no longer see their history — migrate by renaming the old keys/table to the new names, or explicitly write the old prefix back in config. Both are pure renames with no format change.
- **⚠️ OAuth callback protocol handler renamed**: macOS LaunchServices, the Windows registry, and Linux desktop entries may still hold registrations for the old identifiers (`dev.omp.oauth-callback.*` / `omp OAuth Callback` / `omp-auth`) pointing at paths that no longer exist. Running one OAuth login after upgrading writes the new registration; if stale entries remain, remove them in the OS's "default apps / protocol associations" settings.
- **SDK rename (no compatibility alias)**: `sdk/go/omp-rpc`, `sdk/python/omp-rpc`, and `sdk/rust/omp-rpc` become `zeta-rpc`; the Python package `omp_rpc` → `zeta_rpc`, the Go package `omprpc` → `zetarpc`. All three are `gen:rpc`-generated and committed, at version 0.1.0 (pre-1.0), and were never published to any registry, so no `omp-rpc` transitional alias is provided. The Go module path is also corrected: it previously pointed at the upstream repo `github.com/can1357/oh-my-pi/sdk/go/...`, and is now `github.com/Linxira-OS/linxira-zeta/sdk/go/zeta-rpc`.

### Fixed

- Fixed the spelling split between the two sides of the tiny worker banner: the worker printed `omp tiny worker listening on` while the title-client filtered for `zeta tiny worker listening on ` (never matching, so the banner line that should be filtered kept leaking in). Both sides now use `zetacode`, and the `text-predict`/`lsp mux` process identifiers and the IDA named-pipe prefix are aligned too ([#83](https://github.com/Linxira-OS/linxira-zeta/pull/83))
- Fixed `read` serving a stale archive listing when an archive was rewritten in place with the same size and a restored mtime: the reader cache identified files by inode/mtime/ctime/size only, and on filesystems whose timestamps advance in steps coarser than the gap between the two writes the inode reports the same ctime, so the rewrite was invisible. The cache now also fingerprints the head and tail of the file.
- The terminal tab title no longer falls back to `omp` when there is no session name; it uses `zeta`.
- Collab replication snapshots restore upstream v18.8.4's no-copy contract (live header + entries), with host and sentinel in sync.
- Deduplicated a repeated `[1.1.27]` section header in the CHANGELOG, fixing changelog parsing.
- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.27] - 2026-10-07

- Added automated release binary publication to build.stencil.so
- Added OSC 7501 program status reporting: terminals and agent inboxes that support it now show whether omp is working, waiting on your answer or approval (with the question), done, or failed (with the error), without parsing the window title. Turn it off with `terminal.programStatus`.
- Added title cards (icon and short code) to `/rename`: the title model picks one for a title you type, or for a generated title when the session has no card yet; `title.icons: boring` keeps renamed titles plain.
- Grammars for less common languages (Kotlin, Swift, Ruby, PHP, Haskell, Verilog, and others) are now downloaded on first use for code summaries, block context, `ast_grep`, `ast_edit`, and TTSR rules; offline, files in those languages are skipped with a note instead of failing. `PI_GRAMMARS_URL` overrides the download location.
- Added `bash.gitGuard` (default off) for checkouts shared by concurrent agents: the bash tool refuses `git stash`, `git reset --hard` or to another commit, and `git checkout`/`switch`/`restore` that would overwrite working-tree files unless a merge or rebase conflict is being resolved; unstaging stays allowed, and commands are judged as they actually run, including inside substitutions, functions, and after `cd`.
- Added `/jobs kill <id>|all` to cancel a running background job (or every one this session owns) from the command line, even while the agent is busy ([#14160](https://github.com/can1357/oh-my-pi/pull/14160) by [@KanwarGill](https://github.com/KanwarGill))
- Added `omp anonymize [session] [-o dir]` to write a shareable copy of a session and its subagent transcripts: only an explicit allowlist of omp metadata (ids, timestamps, models, usage, built-in tool names and options) is kept; message, thinking, and tool-output text become size-annotated `[redacted …]` markers; tool-call paths become mock paths (`/home/seg3/seg4/src/seg9.ts:10-20`), shell commands keep known programs and flags, other literals such as a grep pattern become `PLACEHOLDER_N`, and extension or MCP payloads are redacted whole, with the same original always mapping to the same token across files ([#15077](https://github.com/can1357/oh-my-pi/pull/15077) by [@H4vC](https://github.com/H4vC))
- Added `/dump anon`, which writes the same anonymized session and subagent JSONL to a zip in the temp directory and copies its path ([#15077](https://github.com/can1357/oh-my-pi/pull/15077) by [@H4vC](https://github.com/H4vC))
- Added message times to `/dump` transcripts (assistant turns also show request duration and time to first token), and live status, last activity, pending tool calls, and the partially streamed turn to `/dump all` files for subagents still running, so a stuck subagent can be diagnosed from the archive ([#15121](https://github.com/can1357/oh-my-pi/pull/15121) by [@H4vC](https://github.com/H4vC))
- Added `contextFiles.extra` to load extra instruction files, such as `AGENTS.local.md`, beside the usual context file ([#15147](https://github.com/can1357/oh-my-pi/pull/15147) by [@Shadorain](https://github.com/Shadorain)).
- `/annotate` opens the note you are writing, a file or typed-prompt source, or (for local diff reviews) the current working-tree file in `$VISUAL` or `$EDITOR` with the external-editor key (Ctrl+G by default); a file source is saved back and its notes follow the edited text ([#15151](https://github.com/can1357/oh-my-pi/pull/15151) by [@Shadorain](https://github.com/Shadorain))

### Added

- Added per-session Git worktree support with `worktree.onStart` and `worktree.onExit` settings to create an isolated worktree for each session and clean it up when the session ends.
- Expanded xAI web search with X post search, including X-only and author-specific queries, author exclusions, date and recency filters, and automatic xAI routing when credentials are available.
- Added xAI-powered reading of X posts, threads and replies, profiles, searches, and hashtags when logged in, replacing the unavailable Nitter mirrors.
- Added per-model auto-compaction points: the `/models` preview shows where each model compacts, and in the Roles view `k` (or the **Compaction limit** button) sets it for the selected role's or fallback's model (`90000`, `90k`, `1M`, `80%`; empty resets). Also configurable as `compaction.modelThresholds` with `provider/model-id` or `provider/*` keys ([#14952](https://github.com/can1357/oh-my-pi/pull/14952) by [@H4vC](https://github.com/H4vC))
- Updated `write` tool error message to mention local:// scratch support
- Web search now tells the agent about its X post operators (`site:x.com`, `from:<handle>`) when you are logged in to xAI, so questions about reactions on X reach X search.
- Reduced memory retained after merging unchanged discovered and cached models ([#14252](https://github.com/can1357/oh-my-pi/pull/14252) by [@iliaal](https://github.com/iliaal)).
- The default `smol` model now prefers Claude Haiku 5.5 when it is available.
- Automatic session titles now start when the agent's reply begins rather than when you submit, so a slow-thinking first reply gets a card title (icon and code) instead of a plain fallback title.
- `read file.jsonl?q=…` keeps the other lines' results when a line before the last fails and shows jq's error ahead of them, instead of failing the read; anything else the query wrote to stderr, such as `debug` output, now leads the result too ([#14659](https://github.com/can1357/oh-my-pi/pull/14659) by [@will-bogusz](https://github.com/will-bogusz))
- Title card icons now picture each session's specific subject instead of a generic bug, flask, speedometer, gear, or terminal, or the project's language logo, so sessions in the same project are easier to tell apart.
- Agents whose tool list omits `write` but still get it to run `xd://` tools can now also write `local://` files (reports, notes) outside plan mode; working-tree writes stay blocked.
- Added `worktree.onStart` and `worktree.onExit` settings to start each session in its own worktree and clean it up on exit ([#14908](https://github.com/can1357/oh-my-pi/pull/14908) by [@gitpushoriginmaster](https://github.com/gitpushoriginmaster))
- Added `speech.speed` and `tts.localSpeed` settings (0.5–2.5, default 1) to speed up or slow down local Kokoro speech for live vocalization and the `tts` tool / `omp say`, plus an `omp say --speed` flag; ACP voice clients find both settings and their presets in `speech.models.list` ([#5868](https://github.com/can1357/oh-my-pi/issues/5868))
- `omp update` and the startup update notice leave an omp installed by another app (Tern) to that app instead of replacing its files.
- The startup update notice no longer appears when omp runs from a source checkout.
- A `/models` compaction limit set past a model's standard context window now runs that model on its extended window instead of being silently clamped; the hub warns (noting long-context pricing) and saves on a second Enter, in the terminal and in Tern, and rejects limits past the model's largest window ([#15048](https://github.com/can1357/oh-my-pi/pull/15048) by [@H4vC](https://github.com/H4vC))
- A token compaction limit set in `/models` (or `compaction.modelThresholds`) is now the base omp scales with its usual policy, as if it were the model's window (85% of it by default for bases above ~109k, or `compaction.thresholdPercent` of it), instead of the exact point. Plain numbers saved since 18.8.5 therefore compact earlier; rewrite one as `"f<tokens>"` (or type `f400k` in the hub) to keep it an exact trigger. The `/models` limit field shows where the model would compact as you type (`compacts at 340K · 85% of 400K base`), the preview's **Compacts at** row says why, and the saved message repeats it ([#15065](https://github.com/can1357/oh-my-pi/pull/15065) by [@H4vC](https://github.com/H4vC))
- Write-tool previews now render as files stream: SVG files appear as images, and Mermaid files (`.mmd` and `.mermaid`) appear as diagrams. Tern also previews supported 3D model formats (`.obj`, `.ply`, `.wrl`, `.x3dv`, `.stl`, `.gltf`, and `.usda`) and renders SVG writes as SVG figures.
- Added the `title.icons` setting to show session title cards with a Nerd Font glyph and emoji fallback (`nf+emoji`, default), always the emoji (`emoji`), or as plain titles (`boring`).
- Added the `title.generator` setting to name sessions from a fork of the reply (`fork`, default) or with the title model only (`tiny`).

### Changed

- Web search now prefers an authenticated `xai-oauth` login over an `xai` API key when both are available, unless `modelProviderOrder` specifies a different order.
- Reduced memory growth after one-shot side requests without interrupting ongoing conversations ([#14334](https://github.com/can1357/oh-my-pi/pull/14334) by [@iliaal](https://github.com/iliaal)).
- Fixed sessions staying untitled when you interrupted the first reply to send a queued steer message.
- Fixed browser downloads saving into another tab's `downloads` folder, and `tab.waitForDownload()` saving into the system Downloads folder once another tab closed; each tab in a Chromium omp launched or spawned now saves into its own, iframe downloads included. In those browsers a download no tab tracks (started by a page omp did not open, or finishing after its tab closed) now keeps Chromium's GUID file name instead of its suggested name; connected and relay browsers keep real file names ([#14544](https://github.com/can1357/oh-my-pi/pull/14544) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser calls in relay mode failing with "The browser relay … is out of date" after an omp upgrade until the old relay was killed by hand; omp now restarts a relay it started itself under an older version ([#14416](https://github.com/can1357/oh-my-pi/pull/14416) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `/rename` without a title dropping the session's title card (icon and short code) ([#14980](https://github.com/can1357/oh-my-pi/issues/14980))
- Fixed title cards showing the emoji instead of the Nerd Font icon when the model misremembered the icon's name: dashes for underscores (`nf-md-text-box`), the wrong icon set (`nf-md-spinner` for `nf-fa-spinner`), or reordered, missing, or extra words (`nf-md-test` for `nf-md-test_tube`).
- Fixed `omp update` ignoring the `update.channel` setting: canary users were checked against stable releases, and `--canary`/`--stable` were never remembered.
- Fixed interrupting a reply to send a queued steer message briefly showing omp as idle (title, progress, working indicator) before the steer ran; RPC and SDK clients also no longer see a final `agent_end` for that interrupt.
- Fixed browser tab recordings and video frame/contact-sheet extraction creating `omp-browser-recording-*` and `omp-video-*` scratch directories in your working directory instead of the system temp directory.
- Fixed edit snapshots retaining excess history when metadata or displayed-line provenance grows; the 64 MiB snapshot budget now counts UTF-8 bytes, so CJK- and emoji-heavy files keep fewer versions ([#14975](https://github.com/can1357/oh-my-pi/pull/14975) by [@iliaal](https://github.com/iliaal)).
- Fixed `/usage` (or clicking the status-line cost) while the usage dashboard was already open stacking a second dashboard on top; it now focuses the open one ([#15145](https://github.com/can1357/oh-my-pi/pull/15145) by [@H4vC](https://github.com/H4vC))
- Fixed the browser tool prompt not documenting `observe()`'s `viewportOnly` and `includeAll` options, or that `open`/`close`/`run` timeouts are seconds clamped to 1–300 while `waitFor*` timeouts are milliseconds ([#15104](https://github.com/can1357/oh-my-pi/pull/15104) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser relay pages opened in the background (`browser.newPage({ background: true })` in `tab.run`) taking over the user's selected tab; they now open unselected once the relay extension is reinstalled ([#15109](https://github.com/can1357/oh-my-pi/pull/15109) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser `open` with `app.relay` and a `target` failing with `No page target matched` or `Selected tab is no longer available` when the matching tab was opened a moment earlier outside omp; it now waits briefly for the relay to list the tab ([#15112](https://github.com/can1357/oh-my-pi/pull/15112) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a timed-out `browser.open` holding up the next open of the same browser (apps launched with `app.path` excepted) until its abandoned launch or connect returned; the timeout error now names the step that stalled ([#15117](https://github.com/can1357/oh-my-pi/pull/15117) by [@jinpyo-jeon](https://github.com/jinpyo-jeon) and [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser tabs crashing mid-load on some pages with a same-site iframe, Google Travel among them, after which every open, screenshot and evaluate on the tab timed out ([#15118](https://github.com/can1357/oh-my-pi/pull/15118) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the custom-tool examples' full-documentation link opening a missing page ([#15076](https://github.com/can1357/oh-my-pi/pull/15076) by [@qingshungLI](https://github.com/qingshungLI))
- Fixed the `/models` compaction limit preview and **Compacts at** row rounding fractional percentages (`12.5%` showed as `13%`) ([#15074](https://github.com/can1357/oh-my-pi/pull/15074) by [@H4vC](https://github.com/H4vC))
- Fixed `/omfg` save, overwrite, and validation prompts in Tern opening as a sheet over the candidate rule; they now sit in the composer slot like `ask`, so the rule stays readable while you choose ([#15058](https://github.com/can1357/oh-my-pi/pull/15058) by [@H4vC](https://github.com/H4vC))
- Fixed hotkeys pressed in Tern while omp is still starting (such as Alt+P for the model selector) being ignored; like in other terminals, they now take effect once startup finishes ([#15120](https://github.com/can1357/oh-my-pi/pull/15120) by [@H4vC](https://github.com/H4vC))
- Fixed a startup extension dialog (select, confirm, input) in Tern not receiving keys until it timed out ([#15122](https://github.com/can1357/oh-my-pi/pull/15122) by [@H4vC](https://github.com/H4vC))
- Fixed auto-compaction overflowing the context window every cycle when `compaction.thresholdTokens` or an `f<tokens>` model limit is at or past a window the provider caps lower (such as Factory's 196K Kimi K3); it now compacts at the window less the reserve, and `/models` shows the trigger as capped ([#15146](https://github.com/can1357/oh-my-pi/pull/15146) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed resumed xAI, Factory Droid and OpenAI sessions forgetting earlier reasoning on their first request, while a retry after a stale Responses item error still rebuilds history ([#15148](https://github.com/can1357/oh-my-pi/pull/15148) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the startup default ignoring the model a provider's discovery names as the account's default: with no model chosen, Devin Pro now starts on SWE-2 at High instead of SWE-1.6 ([#15115](https://github.com/can1357/oh-my-pi/pull/15115) by [@will-bogusz](https://github.com/will-bogusz))
- Session titles are generated using the session's model when possible, with a fallback to the lightweight title model; `TITLE_SYSTEM.md` continues to override the title prompt.
- Session titles now include a card index, icon, and short code, with appropriate Nerd Font rendering in Tern panes.
- When Nerd Font symbols are unavailable, session titling requests only an emoji.
- Subagent completion indicators now advance to 99% when the subagent submits its result.
- In Tern panes, headed and headless browser opens are shown in Tern picture-in-picture by default; set `app.tern: false`, `browser.tern`, or `PI_BROWSER_TERN=0` to open Chromium instead.
- In Tern panes, `/fork` opens the fork in a neighboring pane while preserving the original session.
- Tern's empty composer now shows the session title, or “What are we cooking?” when no title is available.
- Tern todo cards now display their checklist by default and can be collapsed by clicking the card header.
- Improved performance across browser extraction, web and document fetching, file tools, search, session handling, LSP/DAP, MCP, subagents, SSH file operations, image processing, voice and dictation, collaboration, and large-output or large-file workflows.
- Prompt history search now updates shortly after typing stops while Enter and mouse selections use the latest query.
- Improved responsiveness and reduced resource usage for long sessions, large files and documents, streaming evaluations, terminal graphics, live voice calls, and other high-volume workflows.
- Hosts that are not supported Mastodon, Lemmy, or Discourse instances are no longer repeatedly probed for those services, improving URL-fetch performance.

### Fixed

- Fixed judge-gated features continuing to use a stale model chain after switching judge roles.
- Improved Anthropic prompt-cache reuse when pruning tool results from long conversations.
- Fixed resumed Claude sessions losing earlier thinking context and prompt-cache reuse when extensions or MCP tools were registered before the first message.
- Fixed subagent advisors configured with `@advisor` using the built-in `slow` model instead of the configured advisor role.
- Fixed the `/switch` command and alternate model picker crashing when stored model speed statistics contained an unnamed model.
- Fixed `lsp` and `generate_image` attempting to read FIFO, terminal, or unbounded device paths, which could hang or exhaust memory.
- Fixed aside messages from extensions being blocked behind a running wait operation.
- Fixed extensions importing `@oh-my-pi/pi-tui/native/*` failing to load in compiled `omp` binaries.
- Fixed raw token markers appearing instead of Nerd Font icons in Anthropic idle recaps, `/btw` and `/omfg` replies, and streaming previews.
- Fixed sessions moved with `/wt` disappearing from resume lists; sessions in Git worktrees now remain discoverable and can be resumed or relocated if their worktree was removed.
- Fixed live config reload ignoring edits made during startup or right after a config symlink was retargeted, until the next unrelated edit.
- Fixed `zetacode usage` reporting an account exactly at its reserve (e.g. 30% left with a 30% reserve) as eligible instead of inside reserve ([#14765](https://github.com/can1357/oh-my-pi/pull/14765) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the todo reminder pushing the agent to keep working after it offered options and asked the user to choose ([#14800](https://github.com/can1357/oh-my-pi/pull/14800) by [@mrmans0n](https://github.com/mrmans0n))
- Fixed the todo reminder telling the model to keep working right after it asked the user a bolded or italicised question ([#12051](https://github.com/can1357/oh-my-pi/issues/12051), [#14353](https://github.com/can1357/oh-my-pi/pull/14353) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed short model selectors such as `p/a:max` or `a:max` dropping their explicit thinking level when a role was reassigned or used for image questions; a model whose ID literally ends in `:max` or `:auto` is still treated as that model ([#14554](https://github.com/can1357/oh-my-pi/pull/14554) by [@xiangnan0811](https://github.com/xiangnan0811))
- Fixed starting a subagent switching the parent session's later language servers from shared to private ([#14628](https://github.com/can1357/oh-my-pi/pull/14628) by [@jorgoose](https://github.com/jorgoose))
- Fixed a finishing subagent cancelling local tiny-model requests (titles, task labels, judgments) still running for the parent or other subagents ([#14629](https://github.com/can1357/oh-my-pi/pull/14629) by [@jorgoose](https://github.com/jorgoose))
- Fixed rust-analyzer on Windows not running through a running lspmux server, as it already did on Linux and macOS ([#14630](https://github.com/can1357/oh-my-pi/pull/14630) by [@jorgoose](https://github.com/jorgoose))
- Fixed a malformed or unreadable project `plugin-overrides.json` being ignored silently, which re-enabled project-disabled plugins without a trace; omp now logs a warning naming the file ([#14518](https://github.com/can1357/oh-my-pi/issues/14518), [#14573](https://github.com/can1357/oh-my-pi/pull/14573) by [@oleg494](https://github.com/oleg494))
- Fixed Claude Opus 5.5 and Sonnet 5.5 disappearing with mixed-access Google Antigravity accounts; models now route to accounts that serve them, and revoked accounts no longer block catalog refresh ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).
- Fixed clipboard-pasted image chips opening a nonexistent file instead of the image, including after `/move` ([#14927](https://github.com/can1357/oh-my-pi/issues/14927)).
- Fixed clipboard-pasted image chips opening the auto-resized copy sent to the model instead of the image as pasted ([#14929](https://github.com/can1357/oh-my-pi/pull/14929))
- Fixed `zetacode token <provider> --account N --force-refresh` printing the stored token unchanged while it was still valid; it now re-mints that account. Security scans pinned to one account, including Codex Security cloud requests, refresh it after a 401 and may reuse a still-usable token minted in the previous five minutes, as `zetacode auth-broker serve` now also may for its clients' 401 recovery ([#14752](https://github.com/can1357/oh-my-pi/pull/14752) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed revived subagents moving to the parent's automatically chosen account and re-writing their whole prompt cache instead of staying on the account that served their earlier turns; a parent's explicit `/session pin` still moves them ([#14749](https://github.com/can1357/oh-my-pi/pull/14749) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a fallback chain switching back to a usage-limited primary model every 30 minutes, failing a request each time, when the provider's usage report showed a later reset; the session now stays on the fallback until that reset ([#14757](https://github.com/can1357/oh-my-pi/pull/14757) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `/usage`, the status line usage segment and `/logout` treating every Google Antigravity account (and every Codex Team seat in one workspace) as the session's account, and `zetacode usage` not listing such an account when its usage fetch failed ([#14900](https://github.com/can1357/oh-my-pi/pull/14900) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Tern showing an agent as finished when automatic context maintenance ends partway through a turn; omp now keeps reporting the turn's working state until the turn actually ends ([#14917](https://github.com/can1357/oh-my-pi/pull/14917) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed the terminal title and Tern busy state staying in the working state after an interrupt cancels a scheduled retry or continuation before it starts ([#14917](https://github.com/can1357/oh-my-pi/pull/14917) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed Anthropic web search through a custom `anthropic-messages` provider sending a plain API-key request even though the provider's conversations use Claude Code request shaping; search now honors the model's `isOAuth` like the main conversation, so keys that only work with that shaping no longer fail with HTTP 429 `rate_limit_error` ([#14919](https://github.com/can1357/oh-my-pi/pull/14919) by [@farnoy](https://github.com/farnoy))
- Fixed Anthropic web search spreading the model's configured headers under its own without the main conversation's case-insensitive merge and enforced-header filtering, so a configured `authorization` header could replace the credential or join it comma-separated on the wire ([#14919](https://github.com/can1357/oh-my-pi/pull/14919) by [@farnoy](https://github.com/farnoy))
- Fixed a message sent while an earlier title request was still running never getting its own try at naming the session when that request came back empty.
- Fixed `/new` incorrectly carrying plan mode, its plan-specific model, or goal mode into the new session.
- Fixed todo lists failing to auto-clear while subagents streamed progress.
- Fixed memory growth during ACP client-terminal commands.
- Fixed freezes after large pastes containing unclosed tags.
- Fixed slowdowns when processing long evaluation output, large Python kernel results, compiler/linter output, and ephemeral side-channel replies.
- Fixed documents served as `application/octet-stream` being downloaded twice.
- Fixed collaboration guests rebuilding the transcript excessively during streaming.

### Removed

- Removed the `PI_SUBPROCESS_CMD` environment variable; subagents run in-process and never read it ([#14632](https://github.com/can1357/oh-my-pi/pull/14632) by [@jorgoose](https://github.com/jorgoose))

## [1.1.24] - 2026-10-03

### Added

- Skills in nested router trees (up to 3 levels, e.g. `.agents/skills` router → category → leaf) are now all discoverable, and `skills.enableOfficial` actually toggles the bundled official skills.

### Changed

- Usage/help strings across `config`/`plugin`/`setup`/`update`/`login`/`shell`/`web-search` and the docs corpus show canonical bin names only (`zetacode`/`zetaide`/`zetaeditor`); spaced forms like "zeta code" no longer appear anywhere user-visible.

### Fixed

- Session exit tips and every command example now name the coding CLI (`zeta-c`) instead of the workbench `zeta` — following the old `zeta --resume <id>` hint silently opened the Zetawork workbench and did nothing.
- `--resume` ids pasted with a trailing `/` (or a `.jsonl` suffix) resolve as session ids again; an explicit transcript path that does not exist now errors with a usage hint instead of silently minting an empty session.
- `update` on Windows no longer writes or retires the workbench `zeta` shims (it manages only this package's `zeta-c`/`zeta-cli`/`zetacode`), and its GitHub/mise fallbacks point at Linxira-OS/linxira-zeta.
- npm source installs no longer silently miss the bundled official skills, and reseeding the official-skills embed prunes stale files.
- Plugins get a per-plugin storage contract: `pi.storage` (`dataDir`/`cacheDir`/`stateDir` under `~/.zeta/plugins/`) is injected into every extension factory, with `adoptLegacyFileOnce` as the one-time migration primitive — plugins no longer need to invent their own paths in the user data tree.
- Models already configured in upstream OMP (`~/.zeta/agent/models.yml` providers and `/login` API keys) now appear in the model list automatically, badged "来自 OMP" — read-only mapping, keys reused in memory, Zeta-local config always wins; nothing is written back to the upstream install.

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

## [1.1.6] - 2026-08-30

- Fixed prewalk conflicting with `todo.eager=always`: the forced eager-todo prelude ("call todo first this turn") was injected alongside the prewalk plan nudge ("write a complete plan first, then todo"), giving the model contradictory instructions; the eager-todo prelude is now suppressed only when prewalk will perform a handoff ([#10510](https://github.com/can1357/oh-my-pi/issues/10510)).
- Fixed `authHeader: true` + command-backed `apiKey` discovery providers (no explicit `headers:` block) resending a stale bearer after a 401 force-refresh; discovered models now re-derive `Authorization` from the live `apiKey` each request ([#10551](https://github.com/can1357/oh-my-pi/issues/10551)).
- Fixed the embedded shell's `command -v`/`-V` honoring only the first operand: it now iterates every name like bash/zsh, printing one line per resolved name and skipping misses ([#10544](https://github.com/can1357/oh-my-pi/issues/10544)).
- Fixed hard-killed subagents vanishing from the agent registry under concurrent fan-out: `AgentLifecycleManager.release` now applies the terminal `aborted` transition before awaiting the tombstone sidecar write, closing a race where the dying session's own dispose-path unregister deleted the ref instead of leaving it as a tombstone ([#10531](https://github.com/can1357/oh-my-pi/issues/10531)).
- `zetacode commit` now keeps extension-provided model credentials available in its nested commit-agent session ([#10528](https://github.com/can1357/oh-my-pi/issues/10528)).
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
- Fixed stale `omp-plugins.lock.json` entries loading leftover `node_modules` trees for plugins no longer declared in an existing `package.json` — the orphaned copy double-loaded its extensions. Lockfile-only plugins remain supported for manifest-less roots and symlinked packages (`zetacode plugin link`, marketplace runtime packages); stale entries are skipped with a warning.

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：git TUI 内置 conventional commit 生成与 `if-bench` 基准、`commit --legacy` 统一生成、`:img` 选择器渲染 SVG、新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra image_gen/tts。

### Fixed

- 修复 `/language` 与 `/tracking` 指令在 OMP v18.0.3 合并后未注册的问题（输入被当作普通消息；现已恢复注册并加合并护栏测试）。

## [1.1.4] - 2026-08-26

### Changed

- release 资产命名系统化：CLI 二进制统一为 `zeta-cli-*`，桌面安装包统一为 `zeta-desktop-<version>-<os>-<arch>`。

### Fixed

- 修复中文系统下 CLI 汉化自动检测失效（`language` 默认值不再顶掉环境检测，中文系统自动切换中文界面）。

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.0] - 2026-08-25

### Changed

- TUI 渲染升级至上游 v18.0.3 架构（provider window + resize 重绘），终端尺寸变化即时重绘。

## [1.0.10] - 2026-08-19

### Added

- Added a web gateway `enter_plan_mode` command and a session `enterPlanMode` path so the web-ui `/plan` slash command actually enters plan mode (plan file, `write` tool, plan-approval wiring, optional initial prompt) instead of forwarding a literal message.
- Added an interactive confirm to `zeta update` before installing a new version (default no on non-TTY input); `--yes`/`-y` skips it.

### Changed

- WeChat login now prefers the new `/api/v1/wechat` endpoints (endpoint host configurable via `channels.wechat.endpoint`); older hosts fall back to the legacy iLink QR flow.

### Fixed

- Fixed the transcript collapsing into a compact no-spacing layout whenever the prompt, todo HUD, or other below-transcript chrome grew a few rows; the live tail now scrolls off the top instead.
- Fixed transcript layout and rebuilding issues that could collapse blank rows, leave tool calls displayed on one line, or show stale fragments after navigation, display changes, or compaction ([#12177](https://github.com/can1357/oh-my-pi/pull/12177) by [@shivamklr](https://github.com/shivamklr)).
- Fixed the `security-reviewer` agent so valid findings with anchors and remediation details are accepted.
- Stopping a subagent from Agent Hub now settles and reports its parent background job instead of leaving `hub wait` blocked indefinitely.
- Fixed prewalk handoff detection after edits or writes dispatched through Code Mode eval cells.
- Reduced main-thread stalls while streaming large edits by deferring AST-based matching until the edit is complete.
- Corrected the `/handoff` description so it accurately reflects that the command creates a handoff document and compacts the current session.
- Deferred misleading cold-cache `retry.fallbackChains` warnings until provider discovery completes.
- Fixed `--prewalk-into @default` so an explicitly selected startup model does not replace the configured default role, including ordered fallbacks and discovery-backed candidates.
- A corrupted or externally modified session file no longer leaves the session impossible to close; a subsequent Ctrl+C exits without rewriting the session log.
- Fixed silent MCP requests being terminated by an undeclared idle timeout; closing a legacy SSE connection now also cancels pending requests and notifications.
- Fixed browser reuse for Chromium installed behind Linux wrapper scripts and prevented duplicate launches when a profile is locked ([#12236](https://github.com/can1357/oh-my-pi/pull/12236) by [@shivamklr](https://github.com/shivamklr)).

Older entries are archived in [packages/coding-agent/CHANGELOG.md@5ae2ef3569ca](https://github.com/can1357/oh-my-pi/blob/5ae2ef3569ca9299b7eb101ad7ef0d316d30f551/packages/coding-agent/CHANGELOG.md).

Older entries are archived in [packages/coding-agent/CHANGELOG.md@1e3cc3ab94d0](https://github.com/can1357/oh-my-pi/blob/1e3cc3ab94d05617e79fb12d95711d58161747d3/packages/coding-agent/CHANGELOG.md).
- The shell's `cp` builtin accepts macOS's `-c` (clone where possible, else copy; same as `--reflink=auto`).

### Changed

- Removed unused timestamp metadata from model usage tracking queries to optimize database overhead
- Improved session storage reliability by using atomic inode identity verification for lock management
- Optimized internal role chain resolution and caching to reduce event-loop contention during judge initialization
- On macOS, the shell's `cp` builtin now also clones (copy-on-write) when overwriting an existing file, instead of rewriting its data; the destination keeps its permissions, and hard-linked destinations are still written in place.
- The `find` tool now fails with a timeout error after 20 seconds instead of blocking the turn when the judge model stalls.
- Reduced main-thread stalls with many agents running: `read` code summaries now parse off the main thread, streamed tool-call snapshots no longer deep-copy growing argument text on every delta, and model-cache reads skip re-parsing unchanged rows.
- Reduced CPU while an agent streams: the working-row token rate and status line no longer re-tokenize or re-resolve settings every frame, and `^` model mentions no longer rebuild the model scope per keystroke.
- `task` and `/vibe` subagents now get their own Python kernel and JS/Ruby/Julia eval state instead of sharing the parent's, so agents can no longer overwrite each other's variables or reset each other's kernels.
- On Windows, the shell's `cp` builtin now clones files (copy-on-write) on ReFS and Dev Drive volumes by default, falling back to a regular copy elsewhere; `--reflink` and `-c` no longer fail there.

### Fixed

- Fixed mouse handling ignoring per-mode TUI mouse setting
- Fixed the shell's `cp --reflink=always` emptying an existing destination when the filesystem cannot clone; the destination is now left untouched.
- Fixed `block-clone` task isolation on Windows ReFS and Dev Drive volumes failing on files whose size is not a whole number of clusters, larger than 4 GiB, or sparse.
- Fixed Google Antigravity requests failing with `429 RESOURCE_EXHAUSTED` on every turn: the system prompts' RFC 2119 conventions line is reworded so the endpoint no longer rejects it ([#13379](https://github.com/can1357/oh-my-pi/pull/13379) by [@heshuoshuo0512](https://github.com/heshuoshuo0512))
- Fixed CRLF `SKILL.md` files injecting raw YAML frontmatter into user-invoked and autoload skill messages ([#13590](https://github.com/can1357/oh-my-pi/issues/13590)).
- Fixed Cursor native Grep ignoring requested context, Read negative offsets starting at the top, and Delete reporting zero-byte files ([#13600](https://github.com/can1357/oh-my-pi/issues/13600)).

## [18.4.1] - 2026-09-28

### Changed

- With LSP disabled (`--no-lsp` or `lsp.enabled: false`), startup skips language-server discovery and warmup, and the welcome screen no longer shows the LSP Servers section
- The first frame's status bar now renders live at the current terminal width from the cached model, thinking level, and status-line settings instead of replaying an `…`-filled snapshot: path and git branch are always current, the context gauge shows the window without a stale percent, git dirty counts no longer blank out when the session bar takes over, and folders that never ran omp paint the bar (and your theme) too.
- Moved the composer startup cache (theme, welcome, recent sessions, LSP rows, status bar) from per-project JSON files under `cache/composer/` to a single `cache/composer.db`; the old directory is no longer read and can be deleted.
- Improved interactive startup: the session status bar appears sooner because `retry.fallbackChains` validation, the background model-catalog refresh, and project daemon registration no longer block the first session frame.
- Reduced CPU use from subagent HUD repaints during active sessions ([#13245](https://github.com/can1357/oh-my-pi/pull/13245) by [@iliaal](https://github.com/iliaal)).
- Clarified which provider transports honor `thinkingBudgets` and that local OpenAI-compatible models use effort controls instead ([#13503](https://github.com/can1357/oh-my-pi/issues/13503)).
- `/fork` now prints how to resume the session it leaves behind (`omp --resume <id>` or `/resume <id>`) instead of the new transcript's filename ([#13338](https://github.com/can1357/oh-my-pi/pull/13338) by [@LlemonDuck](https://github.com/LlemonDuck))
- `/vibe` status checks no longer redraw every worker the director killed: `vibe_wait` and `vibe_list` leave killed sessions off the wall with a `N killed hidden` count, and `vibe_list` collapses them to one trailing line naming the most recent (transcripts stay at `history://<id>`) ([#13073](https://github.com/can1357/oh-my-pi/pull/13073) by [@igasmi](https://github.com/igasmi)).

### Fixed

- Fixed `find` exhausting memory on trees with many matching lines: its keyword scan now counts matches as they stream in, holding a few hundred MiB where a 5-million-line tree took several GiB, and finishes faster ([#13495](https://github.com/can1357/oh-my-pi/issues/13495))
- Fixed a native compaction speculation that failed for good turning off background compaction for the rest of the cycle. With `compaction.methodOrder` such as `["remote", "soft"]`, speculation now moves to the next configured method and the threshold pass keeps deferring to it, instead of running that method on the blocking path ([#13478](https://github.com/can1357/oh-my-pi/pull/13478) by [@andrebrait](https://github.com/andrebrait)).
- Extensions that register bash through the legacy `createBashTool`/`createBashToolDefinition` with a `spawnHook` no longer make every bash call fail with `ready and env require a service name.` ([#13461](https://github.com/can1357/oh-my-pi/pull/13461) by [@sjawhar](https://github.com/sjawhar))
- Fixed `/new` with automatic thinking starting the new session at the previous session's classified effort instead of the provisional level, both in its first `thinking_level_change` entry and on the wire ([#13383](https://github.com/can1357/oh-my-pi/issues/13383))
- Fixed a corrupt `agent.db` crashing every launch with `no such table` (for example `hint_usage`) instead of being preserved and recreated ([#13530](https://github.com/can1357/oh-my-pi/pull/13530) by [@Hunter-124](https://github.com/Hunter-124))
- Fixed `edit` rejecting a one-line replacement of an `if` opener, `case` label, or function signature with another of the same shape as an "ambiguous boundary" whenever another edit in the same batch broke the file's syntax; it now applies with the usual syntax-error warning. ([#13522](https://github.com/can1357/oh-my-pi/pull/13522))
- Jujutsu status and diffs now report renames and copies (`R`/`C`, `rename from`/`rename to`) the way `jj status` and `jj diff` do, instead of a delete plus an add ([#13406](https://github.com/can1357/oh-my-pi/pull/13406) by [@sjawhar](https://github.com/sjawhar)).
- Fixed a subagent that finished before a later step failed (such as the isolation merge) losing its evidence: the `task` result now names the child's exit status and `agent://` output, keeps that output on disk, and is marked as an error ([#13557](https://github.com/can1357/oh-my-pi/pull/13557) by [@aktanazat](https://github.com/aktanazat))
- Fixed SDK sessions created with `agentDir` loading user rules (`rules/`, `RULES.md`) and custom tools from the default agent dir instead of that `agentDir`; `discoverCustomToolPaths` and `discoverAndLoadCustomTools` accept an `agentDir` argument ([#13558](https://github.com/can1357/oh-my-pi/pull/13558) by [@aktanazat](https://github.com/aktanazat))
- Reduced daemon broker metadata writes for historical services when owners reconnect or the broker restarts ([#13471](https://github.com/can1357/oh-my-pi/pull/13471) by [@Dante-dan](https://github.com/Dante-dan)).
- Fixed compaction re-emitting the whole transcript into native scrollback when `display.collapseCompacted` is off, for both the automatic compaction-end and the manual `/compact` path ([#12140](https://github.com/can1357/oh-my-pi/issues/12140), [#13235](https://github.com/can1357/oh-my-pi/pull/13235) by [@holny](https://github.com/holny))
- Subagents can submit their preceding report with a data-less yield after a finish reminder ([#12837](https://github.com/can1357/oh-my-pi/pull/12837) by [@iliaal](https://github.com/iliaal)).
- Fixed session dispose losing the final message and exit record on SQL/indexed session storage ([#13415](https://github.com/can1357/oh-my-pi/pull/13415) by [@sjawhar](https://github.com/sjawhar))
- Fixed the `recall`, `reflect`, and `memory_edit` tool descriptions naming each other by bare name when those tools are reachable only as `xd://` devices ([#13207](https://github.com/can1357/oh-my-pi/pull/13207) by [@andrebrait](https://github.com/andrebrait)).
- Listed the directories searched for agent files in the `task` tool's unknown-agent error, with the home directory shortened to `~`
- Fixed sessions and subagents of the same agent in different working directories (such as one git worktree per task) never sharing the cached Anthropic system prompt: context files, workspace tree, workspace roots, and other directory-specific sections now come after the static system prompt, which stays a cache hit across directories ([#13104](https://github.com/can1357/oh-my-pi/issues/13104))
- Fixed the startup "What's New" heading and config warnings keeping the dark palette on a light terminal: they were colored before the terminal reported its background, so the heading rendered near-white on white. Both now resolve their color at render time and follow the auto theme switch
- Fixed idle `display: true` custom messages (such as extension `pi.sendMessage` notices sent without starting a turn) not appearing in the transcript until the session was reloaded ([#12718](https://github.com/can1357/oh-my-pi/pull/12718) by [@Broglah1](https://github.com/Broglah1)).
- Fixed `omp usage` ignoring usage providers registered by extensions, which left those accounts listed as having no usage data; `omp usage` now also accepts `-e`/`--extension` and `--no-extensions` ([#13579](https://github.com/can1357/oh-my-pi/issues/13579))
- Fixed a task model saved in `/agents` being ignored for the rest of the session after an Alt+P session-only pick ([#13345](https://github.com/can1357/oh-my-pi/issues/13345)).
- Fixed tool calls made through an `xd://` alias being recorded under the alias, which made OpenAI/OpenRouter Responses replay reject every later request ([#13352](https://github.com/can1357/oh-my-pi/issues/13352)).
- Fixed pasted images in skill invocations not reaching the configured vision model when the main model supports only text ([#13480](https://github.com/can1357/oh-my-pi/issues/13480)).
- A provider listed in `disabledProviders` no longer answers through a retry fallback chain, an advisor or a restored model, and gets no credential however one of its models was selected ([#13194](https://github.com/can1357/oh-my-pi/pull/13194) by [@sjawhar](https://github.com/sjawhar)).
- Fixed `glob` silently clamping `limit` above 200 while advising `Use limit=<clamped>` retries: a clamped request is now disclosed up front and the "Use limit=" advice is dropped once the hard cap is reached ([#13263](https://github.com/can1357/oh-my-pi/issues/13263))
- Fixed subagents that stop to wait for their own background job failing with a missing yield instead of waiting for the job ([#13305](https://github.com/can1357/oh-my-pi/issues/13305)).
- Fixed a failed session append leaving partial bytes behind on Windows, where ftruncate is refused on the append handle: the rollback now reopens the file without O_APPEND and verifies it is still the same file before truncating ([#13362](https://github.com/can1357/oh-my-pi/pull/13362) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed plugin installation failing on Windows outside developer mode by linking the plugin through a directory junction, matching the marketplace link ([#13364](https://github.com/can1357/oh-my-pi/pull/13364) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed the grep tool searching subdirectories for globs whose base path merely resolved to the cwd: only globs spelled without a directory prefix (like `*.ts`) now match at any depth, while `./*.ts` and absolute paths stay scoped to their directory ([#13360](https://github.com/can1357/oh-my-pi/pull/13360) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed the `ask` tool's "Other (type your own)" prompt sending RPC and SDK clients a terminal-rendered title (options with icon glyphs, lines clipped to the terminal width) instead of the question text; the interactive TUI's own ask dialog is unaffected ([#13477](https://github.com/can1357/oh-my-pi/pull/13477) by [@andrebrait](https://github.com/andrebrait))
- Fixed prewalk targets registered by extensions resolving before their provider was loaded. The hand-off now retries after extension registration, preserves role fallback order, and refreshes a cold runtime provider when needed.
- Fixed saving settings on Windows through a symlinked `config.yml` whose target contains `..` writing a file other than the one the link reads, and `agent.db` staying open after its storage is closed ([#13351](https://github.com/can1357/oh-my-pi/pull/13351) by [@Vortex727](https://github.com/Vortex727))
- Fixed grep line ranges (`path:N-M`) returning out-of-range lines for absolute paths with `./` or `..` segments ([#13296](https://github.com/can1357/oh-my-pi/pull/13296) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Fixed service requests the project's service broker cannot parse, such as commands added by a newer omp after an update, waiting 30 seconds to time out; the broker now rejects them immediately with the reason ([#13301](https://github.com/can1357/oh-my-pi/pull/13301) by [@eggpeat](https://github.com/eggpeat)).
- Fixed sessions stopping on "Anthropic stream stalled while waiting for the next event" (and other mid-stream stalls, HTTP/2 resets, premature closes, or sockets closed mid-response) when the connection died after the reply's text had already rendered. Replay was refused to avoid duplicating shown text and the tool-turn continuation needed a tool call, so text-only turns had no recovery; the partial turn is now kept and the model is asked to continue from where it stopped, up to 3 times per prompt when `retry.enabled` is on ([#13333](https://github.com/can1357/oh-my-pi/pull/13333) by [@jerryfane](https://github.com/jerryfane))
- Fixed editing one fallback chain in the model hub, or one agent in `/agents`, saving every chain or agent a `--config` overlay supplies into `config.yml` ([#13308](https://github.com/can1357/oh-my-pi/pull/13308) by [@Vortex727](https://github.com/Vortex727))
- Fixed `omp install --dry-run <local-path>` and `omp plugin link --dry-run` linking the plugin and writing the lockfile instead of only previewing ([#13241](https://github.com/can1357/oh-my-pi/pull/13241)).
- Sessions containing assistant messages with no recorded usage now open with that usage counted as zero, instead of crashing on load with `undefined is not an object (evaluating 'usage.cacheRead')` ([#13386](https://github.com/can1357/oh-my-pi/pull/13386) by [@ParadaCarleton](https://github.com/ParadaCarleton)).
- Fixed rules with an `astCondition` and `interruptMode: always` letting the matching `write` or `edit` run before the interrupt, so the file changed on disk even though the rule fired; the call is now blocked before it executes ([#13303](https://github.com/can1357/oh-my-pi/pull/13303) by [@JYeswak](https://github.com/JYeswak))
- Fixed rules not applying to tool calls made from inside `eval` (for example `tool.write(...)`), which ran without any rule check; they are now checked the same way as direct calls ([#13316](https://github.com/can1357/oh-my-pi/pull/13316) by [@JYeswak](https://github.com/JYeswak))
- Fixed bash calls whose optional fields arrive filled with empty values being rejected as service starts ([#13182](https://github.com/can1357/oh-my-pi/issues/13182)).
- Fixed keyless vLLM providers failing every request with "No API key found" ([#13246](https://github.com/can1357/oh-my-pi/issues/13246)).
- Fixed the Agent Hub usage gauge measuring a subagent against its startup model's context window after a fallback model swap ([#13061](https://github.com/can1357/oh-my-pi/pull/13061)).
- Fixed HTML session exports failing to render offline or under a strict script CSP; the viewer libraries are now inlined ([#12948](https://github.com/can1357/oh-my-pi/issues/12948)).
- Fixed hashline edits rejecting files whose names contain `#` (such as yadm alternate files) ([#13428](https://github.com/can1357/oh-my-pi/pull/13428)).
- Fixed a module created with `write` leaving the importing file stuck on TS2307 in typescript-language-server ([#12925](https://github.com/can1357/oh-my-pi/pull/12925)).
- Fixed startup waiting up to 10s on an unresponsive LM Studio loopback probe; the probe now gives up after 250ms like Ollama and llama.cpp ([#12945](https://github.com/can1357/oh-my-pi/issues/12945)).
- The interactive `/usage` dashboard keeps connected accounts visible when some or all usage lookups fail, showing unavailable usage instead of hiding accounts ([#13476](https://github.com/can1357/oh-my-pi/pull/13476) by [@aktanazat](https://github.com/aktanazat)).
- Fixed multiline pastes splitting into separate submissions after a terminal drops bracketed-paste mode, and text typed right after Enter being erased by the post-submit clear ([#13440](https://github.com/can1357/oh-my-pi/pull/13440) by [@Dante-dan](https://github.com/Dante-dan)).
- Fixed subagents never compacting when the parent sets `compaction.midTurnEnabled: false`; a subagent's run is a single turn, so subagents keep mid-run compaction on unless a spawn overrides it ([#13212](https://github.com/can1357/oh-my-pi/pull/13212)).
- Fixed the exit resume hint so the `omp --resume <id>` command prints on its own line, letting triple-click select just the command ([#12748](https://github.com/can1357/oh-my-pi/pull/12748) by [@F0Rextasy](https://github.com/F0Rextasy)).

## [18.4.0] - 2026-09-28

### Added

- Added the `telemetry.otlpExportEnabled` setting under Settings → Providers → Privacy to disable OTLP trace, log, and metric export even when `OTEL_*` endpoints are configured; exporting remains enabled by default.
- Added a first-launch warning when Python evaluation is enabled but no working Python interpreter is available, with guidance for configuring `python.interpreter` and checking the installation with `omp setup python --check`.

### Changed

- Updated `omp stats` and `/stats` to open the redesigned dashboard immediately while session data synchronizes in the background with live progress; `--json` and `--summary` continue to synchronize before producing output.
- Replaced the stats dashboard’s Behavior page with a Frustration page that can classify messages using the `judge` model role, showing an estimated cost before analysis and recording `/stats` spending in the current session.
- Clarified the `eval` tool documentation to explain that its kernel may be shared with the parent session and concurrent task subagents.

### Fixed

- Fixed `/tree` reopening saved Ask results instead of navigating past them when an optional preview was saved as `null`.
- Fixed the legacy `createGrepTool()` API when searching with both a file path and a `glob` filter.
- Improved task and subagent reliability: eligible saved usage resets are now redeemed automatically when polling is throttled or transient failures occur, concurrent tasks share confirmed resets, headless subagents retain assignments across session transitions, tagged `^model` agents are available to nested subagents, and `wait` returns promptly with information about still-running work when no owned jobs are available.
- Fixed SDK requests using `ApiKeyResolver` to wait for a nearby healthy credential when a drained account’s quota block is about to expire, instead of immediately failing with a multi-hour quota error.
- Fixed Anthropic requests failing after native compaction when experimental context notes were enabled.
- Fixed Windows path handling for 8.3 short paths, including project-directory detection and home-directory display in status, tool labels, and errors.
- Fixed `edit` `PUT >N` producing syntactically invalid code when inserting shallower constructs near closing braces.
- Fixed Windows one-shot commands, including `omp update`, incorrectly reporting successful completion as an error; also fixed this behavior when no user npm or Bun configuration file exists.
- Fixed missing judge token counts corrupting session usage totals and displaying `$NaN`.
- Fixed Cursor sessions under-reporting token usage and cost, compacting based on the wrong context measurement, and applying shell-command timeouts in the wrong units.
- Updated goal mode to wait for user input when all remaining todos are blocked instead of repeatedly requesting approval.
- Fixed `pi-background-tasks` 2.6.0 and later failing to load due to a missing legacy `pi-ai` compatibility export.
- Fixed blob broker requests when `PI_PROXY` is configured.
- Fixed `generate_image` reporting the catalog model instead of the image model actually used by the ChatGPT/Codex backend; saved image metadata now reflects the provider-returned size and quality.
- Fixed fast-model fallback selection so it no longer chooses Gemini or MiniMax models when no `smol` role is configured.
- Fixed extension tool renderers using upstream pi’s `renderCall(args, theme, context)` signature failing to render.
- Fixed Nix flake and NixOS module builds failing because the native package version stamp was not recognized.
- Fixed Nix dependency-lock checks failing after obsolete stats chart dependencies were removed.

## [18.3.5] - 2026-09-27

### Added

- Added API-key-billed OpenAI Responses web search (`openai/gpt-6-luna`, then `openai/gpt-5.6-luna`), tried after every Codex entry in the default search fallback chain so ChatGPT-subscription search is exhausted before any API usage is billed ([#13467](https://github.com/can1357/oh-my-pi/pull/13467) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Added prompt-cache warming, ported from [earendil-works/pi](https://github.com/earendil-works/pi): shortly before a prompt-cache entry expires, the main agent loop replays its last request and cuts the replay off at the first generated token, so idle gaps no longer force a full-prefix cache re-write. A refresh fires only when the expected avoided-miss cost clears its cost by $0.05, and warming stops as soon as a refresh misses the cache. Controlled by `providers.cacheWarming` (`off` / `streaming` / `idle`, default `idle`); idle warming covers 5-minute entries only, and models without a declared `promptCache` lifetime are never warmed. Extensions can override each decision through the `cache_warming_decision` event ([#12699](https://github.com/can1357/oh-my-pi/pull/12699) by [@KamijoToma](https://github.com/KamijoToma)).

## [18.3.4] - 2026-09-27

### Breaking Changes

- Replaced the `task` tool's `complexity` field with `solutionSpace`, a description of how open-ended the subtask is; `auto` thinking for spawned subagents now picks effort from it alone

### Changed

- `auto` thinking now picks effort for every turn by how open-ended the problem is, so large volumes of mechanical work no longer raise it

### Fixed

- Fixed agents looping for hours when every turn spends the whole output limit on reasoning: length-stop retries now tell the model its reasoning was discarded and to act in smaller steps, and a subagent whose length-stop recovery gives up now fails with that error instead of being re-prompted into the same loop
- Fixed tagging a model with `^` mid-session dropping the provider prompt cache for every following turn: new `m<N>` pseudonyms now arrive as a hidden session notice instead of rewriting the `task` description, which only absorbs them at a base-prompt rebuild

## [18.3.3] - 2026-09-27

### Added

- Added a unified predictive text engine with N-gram, SmolLM2, and macOS native providers, including cross-engine blending, background model downloads, and a cross-process prediction daemon.
- Added the `omp predict` command for evaluating completion performance and support for ingesting existing Claude Code and Codex prompt histories to bootstrap predictions on new installations.
- Added `omp skill list [dir] [--json]` to report skills resolved for a session directory, including discovery warnings in JSON output.
- Added a centralized progress display for background tool and model downloads, including support for downloading the SmolLM2-135M word-completion model.
- Added dynamic evaluation guidance through hidden session notices.
- Added a required `complexity` rationale to the `task` tool to improve automatic thinking-depth selection.
- Agents using `task` or `bash` now receive the `wait` tool for background-process coordination, and subagents can receive it when explicitly requested.
- Added context-aware suggestions to empty composers based on agent activity and effort.
- Added optional global or per-project memory scopes to the `retain` and `learn` tools when Mnemopi scoping is enabled.
- Added `/btw` to focused subagent views for asking questions about that agent's transcript with separate side-conversation history.

### Changed

- Completion behavior now uses the N-gram engine for standard `auto` completion across platforms, with blended N-gram and SmolLM confidence scoring where applicable; the SmolLM2 model uses a 145 MB GGUF (Q8_0) download and is prefetched only when explicitly activated.
- Updated `spelling.autocomplete` to use an enum-based engine configuration.
- Completion ghost text is now preserved through manual keystrokes.
- Window input actions now default to background execution; set `takeover: true` to opt into foreground activation, with clarified cross-platform coordinate and activation behavior.
- `omp tiny-models download` can now download the word-completion model.
- Updated `/play` help, read-tool summaries, platform-aware shortcut labels, and other UI hints for clearer interaction guidance.
- Updated the empty-submit behavior to account for live-steered messages and surface pending live-steering status in the UI.
- `ps --all` now includes exited global services, while the default view shows live global services.
- Orchestrator task documentation now follows a Target/Change/Acceptance format.
- Slash-command and hint usage tracking is now persistent and namespaced.

### Fixed

- Preserved MCP `structuredContent` in live tool-result details so evaluation callers can consume server data without reparsing model-facing JSON; spilled results continue to retain an artifact reference without duplicating the payload in session history.
- Fixed Collab hosts becoming unable to reclaim a room after a brief network interruption; hosts now retry room recovery without losing guests or queued updates.
- Fixed one-shot commands that stopped before completing, such as `omp config set` on a fresh Windows profile, incorrectly exiting successfully without output; they now report failure with diagnostic guidance.

## [18.3.2] - 2026-09-25

### Added

- Added `ctx.agent` to the extension context, reporting whether the session is the top-level agent or a subagent, plus its registry id, agent definition name, task depth and parent id, so handlers rebound to subagent sessions can tell which agent they serve ([#13314](https://github.com/can1357/oh-my-pi/pull/13314) by [@andrebrait](https://github.com/andrebrait))
- Added tracking of Anthropic's usage-limit wrap-up allowance for Claude subscription accounts: after the 5-hour or weekly limit is reached, the status line and `/slow status` show `limit reached · wrapping up · resets HH:MM`, and the agent is told to wrap up when neither low priority nor extra usage will continue the work ([#13340](https://github.com/can1357/oh-my-pi/pull/13340) by [@H4vC](https://github.com/H4vC))

### Changed

- `providers.anthropic.slowMode` now controls only the low-priority lane; the usage-limit wrap-up allowance is tracked for every first-party Claude subscription account ([#13340](https://github.com/can1357/oh-my-pi/pull/13340) by [@H4vC](https://github.com/H4vC))
- Enter on the `/model` hub sidebar now moves focus to the model list (like →) instead of acting on the highlighted row ([#13347](https://github.com/can1357/oh-my-pi/pull/13347) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed the Windows bash tool exporting `TEMP`, `TMP`, and `TMPDIR` with 8.3 short names such as `ADMINI~1`, so they now match the long-form `pwd`/`$PWD` after `cd "$TEMP"` ([#13265](https://github.com/can1357/oh-my-pi/pull/13265) by [@CoderTCY](https://github.com/CoderTCY))
- `edit` and `write` no longer refuse handwritten files named `generated.go`, `generated.ts`, `generated.js`, or `generated.py`; these are treated as auto-generated only when their header carries a generated-code marker ([#13138](https://github.com/can1357/oh-my-pi/issues/13138), [#13139](https://github.com/can1357/oh-my-pi/pull/13139) by [@radkawar](https://github.com/radkawar))
- Fixed the `edit` tool warning that valid Go 1.26 `new(expr)` calls (e.g. `new(f(x))`) introduced a syntax error, and `ast_grep`/`ast_edit` reporting parse errors on them ([#13148](https://github.com/can1357/oh-my-pi/issues/13148), [#13149](https://github.com/can1357/oh-my-pi/pull/13149) by [@radkawar](https://github.com/radkawar))
- Fixed hashline `PUT N*` / `CUT N*` on the first statement of a block (for example a Go or Python function that opens with an `if`) also replacing or deleting every statement after it ([#13153](https://github.com/can1357/oh-my-pi/issues/13153), [#13154](https://github.com/can1357/oh-my-pi/pull/13154) by [@radkawar](https://github.com/radkawar))
- Fixed the `Full output: artifact://` link on large background bash and eval results pointing at a truncated copy with `[…elided…]` gaps instead of the complete output ([#13142](https://github.com/can1357/oh-my-pi/issues/13142), [#13143](https://github.com/can1357/oh-my-pi/pull/13143) by [@radkawar](https://github.com/radkawar))
- Fixed `grep` paths like `dir/*.go` also matching files in subdirectories of `dir` ([#13146](https://github.com/can1357/oh-my-pi/issues/13146), [#13150](https://github.com/can1357/oh-my-pi/pull/13150) by [@radkawar](https://github.com/radkawar))
- Fixed auto-compaction re-sending a failed native (server-side) compaction on every turn, re-reading the full context each time; after a failure a retry would repeat, the next configured method runs instead until a compaction succeeds ([#13310](https://github.com/can1357/oh-my-pi/pull/13310) by [@alphastorm](https://github.com/alphastorm))
- Fixed a `/slow off` session resending requests indefinitely when another session had activated the shared Anthropic low-priority lane ([#13340](https://github.com/can1357/oh-my-pi/pull/13340) by [@H4vC](https://github.com/H4vC))

## [18.3.1] - 2026-09-25

### Added

- Added a filter to the Esc Esc rewind selector: press `f` and type to show only items containing every word, then Enter to rewind ([#13295](https://github.com/can1357/oh-my-pi/pull/13295) by [@H4vC](https://github.com/H4vC))
- Added native filesystem support for `local://` and `omp://` URLs across file-search, content-search, AST, shell, and related tools, including support for virtual working directories.
- Added a native `cp` builtin for filesystem copy operations.
- Added IDA Pro integration for opening executables and IDA databases, browsing pseudocode, assembly, imports, exports, strings, and cross-references, and performing database-aware actions such as renaming, commenting, type editing, function creation, saving, and persistent Python execution.
- Added shared, project-scoped IDA database access with broker-managed host processes, configurable concurrency and idle cleanup via `ida.maxOpen` and `ida.idleCloseSec`, automatic autosaving, and universal Mach-O architecture selection with `:@<arch>` syntax and host-architecture detection. IDA features can be configured with `ida.enabled`, `ida.python`, and `ida.installDir`.
- Added the `/slow [on|off|status]` command for opting into lower-priority service tiers on OpenAI, Google, and Anthropic subscription sessions, including automatic continuation when Anthropic session limits are reached.
- Added the `providers.openaiLiveSteering` setting to control whether input can be delivered while a response is in progress.
- Added session-wide approval for configuration changes through an `Always for this session` option in `cfg://` prompts, with clear timeout handling for unanswered prompts.
- Added the `cfg://` protocol and a configuration registry for reading, modifying, unsetting, and reactively managing layered agent settings with approval and precedence feedback.
- Added paged reading for large files, with metadata that allows clients to recover and continue displaying results.
- Added per-agent compaction thresholds for task and evaluation subagents, configurable as percentages or fixed token limits without changing the main session threshold.
- Added trusted additional context for extension and hook tool results, including `ctx.addAdditionalContext()`, allowing instructions to reach the model without altering displayed tool results.
- Added dictation support to `/btw` follow-up input.
- Added support for multiple simultaneous browser instances, including concurrent Chrome and Edge connections.
- Added detailed benchmark phases for measuring single-user throughput, parallel scaling, and prefill performance, with automatic prefill sizing based on model context limits.
- Added opt-in CUDA support to the Nix package for tiny-model inference through ONNX Runtime.
- Added reliable RPC prompt lifecycle reporting with `prompt_result`, structured provider errors, session-settled state, prompt identifiers, event filtering, and `--no-ui` support for non-interactive hosts.
- Added RPC session management through `open_session`, plus corresponding TypeScript and Python client APIs including `openSession`, `setEventFilter`, `onPromptResult`, `onSessionSettled`, and `waitForSettled`.
- Added `attachment://` and `conflict://` resource URL handlers.
- Added a per-server MCP `instructions: false` option to keep a server's guidance out of the system prompt while retaining its tools.
- Added stale tool-result eviction for advisors: before each review, an advisor replaces its own `read`/`grep`/`glob` output from reviews older than the latest one with a short placeholder, so it stops re-sending that output on every request. The deltas it reviews, the notes it wrote, and other tool results such as `recall` are never touched. Turn it off with `advisor.evictStaleResults` ([#13238](https://github.com/can1357/oh-my-pi/pull/13238) by [@alnaggar-dev](https://github.com/alnaggar-dev))

### Changed

- Improved recovery from output-length and context-window limits so truncated but actionable turns can be retained and retries are handled more accurately.
- Shortened the default system prompt by approximately 150 tokens while preserving its guidance.
- Improved Anthropic fallback handling so credit tokens and signed thinking context are preserved across same-provider fallbacks.
- Improved filesystem safety and path consistency across virtual URL protocols, including symlink and containment validation and correct Windows long-path reporting.
- Improved IDA database resource management with project sharing, bounded concurrency, idle cleanup, autosave, and clearer database status in listings.
- Improved runtime configuration behavior with type-safe layered settings, live updates, and safe sequential saves.
- Improved authentication and credential management to support live broker and credential-store changes.

### Fixed

- Fixed concurrent project access by enforcing file locking across processes.
- Fixed Windows file reads with line selectors such as `:1-40`.
- Fixed `omp update` and startup update checks to honor configured npm registries, including scoped registries and authentication tokens.
- Fixed invalid auto-QA grievance reports blocking the rest of the upload queue; rejected reports are now surfaced with the server error while other reports continue.
- Fixed advisor reviews making unnecessary follow-up requests, losing context after pruning, using the wrong thinking effort, or sending excessively large edit diffs.
- Fixed `/login` crashes in source-link and development installs after extension loading.
- Fixed retry fallback loops that could continue indefinitely when the fallback resolved to the same effective request.
- Fixed setup wizard detection for Gemini web search when Antigravity OAuth is active.
- Fixed headless print mode failing to complete an advisor review when a configured fallback reviewer was available.
- Fixed embedded shell startup when the inherited working directory had been deleted.
- Fixed Codex usage displays showing stale subscription plans and corrected usage views that combined separate quota limits.
- Fixed explicit model and provider selections bypassing `disabledProviders`; disabled providers are now refused and skipped during fallback.
- Fixed memory storage errors so failed items and underlying storage failures are identified.
- Fixed malformed user-level `mcp.json` files preventing valid MCP sources from loading.
- Fixed Anthropic server-side fallback requests using invalid model names.
- Fixed large-output model requests failing near the context limit by adjusting the output allowance to the remaining context.
- Fixed tool references in system prompts for tools exposed only through `xd://` devices.
- Fixed dictation remaining active after a recording restart during transcription.
- Fixed automatic account sign-outs going unannounced; sessions now report the affected account and login action through interactive, print, JSON, and RPC output.
- Fixed duplicate MCP tool listings in the system prompt.
- Fixed supervised service exits being missed or repeatedly replayed instead of being delivered to the session that started the service.
- Fixed memory backend failures to identify the affected item and underlying storage error.
- Fixed `write xd://<tool>` validation behavior so devices can return precise schema-mismatch responses.

## [18.3.0] - 2026-09-24

### Breaking Changes

- The `hub` tool is deprecated; use `wait`, `write`, and the `proc://` protocols instead.
- The `irc.timeoutMs` configuration setting has been removed.
- The edit mode syntax now uses `*** Edit File:`, `*** Find`, and `*** Replace` headers instead of `SM:` headers.
- Cancelling a process through `write` now requires an explicit `proc://<id>/kill` target; other write targets validate content normally.

### Added

- Added `omp://` documentation scopes for `find` and `omp find`. Search all embedded harness documentation with `omp://` or a specific document with `omp://<file>.md`; results are returned as canonical URLs that `read` can open, including range selectors.
- Added extension support for ephemeral, `/btw`-style side turns through `ctx.runEphemeralTurn()`, with optional tool suppression and output/context limits without adding the turn to session history.
- Added background job and service management through the `wait` tool and `proc://` URLs, including supervised services in `bash` and direct agent messaging through `agent://` write targets.
- Added `*** Insert Before` and `*** Insert After` edit operations for adding lines without replacing existing code.
- Added the `toks` command for offline token counting, including support for Jev (TypeSafe Jev 1.13) encodings.
- Added automatic discovery of Apple Foundation Models on supported Apple silicon devices.
- Added `/changelog last [N]` for viewing the latest release or a selected number of recent releases.
- Added terminal-based OAuth authentication with `omp login`, including browser-assisted login, account and organization details, and automatic model discovery refresh. Added provider support for `org-scoped-identity`, `oauth-token-env`, and per-account OAuth priority/reserve policies through `auth.accountPolicies`, with policy state shown by `omp usage`.
- Added the `daybreak` badge to `omp usage` for enabled accounts.
- Added `/export` and `/usage` to focused subagent views for exporting a focused transcript and viewing account usage without returning to the main session.
- Pasted clipboard images are now saved in the session artifact directory, allowing agents to read, copy, or upload them by file path.
- Added `/annotate` for attaching notes to diffs, replies, session messages, files, or quoted text and inserting or sending those notes in prompts and reviews.
- Added configurable MCP startup behavior through `MCP_STARTUP_TIMEOUT_MS`/`mcp.startupTimeoutMs` and `OMP_MCP_REQUIRE_READY=1`, allowing headless runs to require MCP servers to become ready before the first turn.
- Added native judgment usage reporting, including error stop reasons and messages, and added `openrouter/~typesafe/jev-latest` as a native judge candidate.

### Changed

- Session compaction now supports native Anthropic snapshot branches and rewinds.
- The default `bash.autoBackground.strategy` is now `catalog`.
- The `Launch` configuration group has been renamed to `Services`.
- Terminal OAuth behavior is now consistent between `omp login` and `omp auth-broker login`.
- Judgment fallback now uses only native candidates, preventing prompted models from replacing failed native judges.
- Browser screenshot comparisons now tolerate minor rasterizer differences.

### Fixed

- Fixed credential-aware API key resolution during authentication rotation.
- Fixed comma-separated line selectors in `read`, `grep` paths, and `fetch`; selectors now read the requested range, while a bare number selects only that line.
- Fixed `write` reporting JavaScript character counts instead of UTF-8 byte counts.
- Fixed background job and service status reporting, including incorrect durations, reused job IDs, stale logs after named-service restarts, and foreground calls incorrectly appearing as background jobs.
- Fixed `wait` and agent messaging so completed subagent results and peer messages are delivered reliably, including when a wait is interrupted by an incoming message.
- Fixed headless print mode dropping or silently ignoring MCP servers that start slowly; it now waits within the configured timeout and warns when a server is not ready.
- Fixed reader-mode `fetch` sending inline SVG icons and base64 images as unreadable model input; alt text is retained instead.
- Fixed long non-Latin judged TTSR output exceeding token limits by applying token-aware truncation.

## [18.2.11] - 2026-09-23

### Fixed

- Fixed nested `eval` Todo updates not being reflected by the Todo tracker, including cases where a cell fails after committing an update.
- Fixed strict-mode structured-output validation for JSON Schemas without a root `type`, preserving their `items` and `required` keywords.
- Improved streamed TTSR whole-buffer matching to avoid repeated scans from the beginning of the buffer.
- Fixed plural browser queries when compiled binaries provide shallow stack traces.
- Fixed browser `tab.fill` timing out on pages whose animation frames stall.
- Fixed the first LSP diagnostics request returning no results while a newly started language server is still analyzing.
- `/shake thinking` now reports the number of tokens freed.

## [18.2.10] - 2026-09-22

### Added

- Added live benchmark results table with real-time model ranking and per-kind performance metrics
- Added dedicated prefill throughput reporting for prefill-focused benchmarks
- Added `/record` slash command to capture terminal sessions as replayable `.ompcast` files
- Added `omp play` CLI for terminal-based playback of session recordings
- Added intent descriptions to judgment batching
- Added live progress tracking for judgment batches in the TUI

### Changed

- Refined AI-assisted git staging verification to reduce false positives
- Updated `omp bench` default profile to `chat` and improved CLI flag documentation
- Coalesced judgment batch drain operations for better performance under high load

## [18.2.9] - 2026-09-22

### Added

- Added Claude saved resets to usage views and `/usage reset`, with automatic blocked-limit recovery and expiring-reset redemption controlled by `claudeResets`.
- Added support for searching embedded harness documentation with `find` and `omp find` using `omp://` scopes, including file-specific searches and `:start-end` selectors; results open directly through canonical `omp://` URLs.

### Changed

- Updated server-side fallback documentation and logic to target claude-opus-5-5
- Added support for claude-opus-5-5 to model priority registry
- Updated the read tool guidance to decode images inline by default and require an explicit `:img` selector for SVG rendering.
- Improved model discovery and fallback behavior: authentication failures are surfaced in the `/models` hub, and models without a matching role-specific fallback now use the default fallback chain.
- Improved resilience for subagents by retrying provider stream failures that occur after partial output and preserving configured ordered model fallbacks at startup.
- MCP OAuth with Google issuers now requests offline access so refresh tokens can be issued; repeated auth-broker token rotations also preserve the required refresh and client metadata.
- MCP servers from omp-plugins now expand `${CLAUDE_PLUGIN_ROOT}` and `${OMP_PLUGIN_ROOT}` in commands, arguments, and working directories.
- `/review` now uses the session's current working directory after `/move` or `/wt`.
- Pasted and dragged image files now retain their original filesystem paths so the agent can act on the source files directly.
- Custom sessions can now be moved across filesystems without losing transcripts or artifacts.
- `hub jobs` now returns a compact, non-consuming status summary instead of replaying completed output or consuming pending auto-delivery.
- The display-reset shortcut now works while the ask dialog has keyboard focus, and `tab.press()` provides a clear error for the legacy argument order.
- Wayland keyboard input now follows the compositor's active XKB layout instead of assuming a US layout.
- LSP diagnostics now refresh when watched files are created or deleted and after a server reload.
- Compiled bytecode binaries now start correctly when bundled dependencies use `import.meta.resolve`.

### Fixed

- Fixed JavaScript `eval` assignments in cells containing top-level `await` so they persist into subsequent cells.
- Fixed skill hints becoming out of sync with the active prompt after discarded rebuilds and in advisor sessions.
- Restored `pi.pi.askToolRenderer` for extensions that replace the built-in ask tool, preserving native rendering.
- Fixed npm plugin upgrades and reinstalls leaving stale or duplicate manifest entries that could break `bun install`.
- Fixed `eval` waits longer than approximately 24.8 days returning immediately because of native timer overflow.
- Fixed deleted sessions being resurrected from stale rewrite backups.
- Fixed `/collab` relay connections honoring `HTTPS_PROXY` and `NO_PROXY`.
- Fixed sessions remaining blocked by queued turns or Hindsight auto-recall after disposal or cancellation.
- Fixed edits to auto-generated files aborting the entire turn; they now return a tool-scoped error.
- Fixed Edit handling of invalid overlapping selections in multibyte text so the worker reports a match error instead of panicking.
- Fixed local memory consolidation on case-insensitive filesystems when project path casing changes between launches.
- Fixed first-time Xcode MCP connections on macOS by allowing the signed `omp` binary to request Apple Events permission.
- Fixed stale or duplicated TTSR trigger events during streaming.
- Fixed MCP OAuth credentials retaining their refresh endpoint and client metadata across repeated token rotations.
- Fixed local model and provider retry behavior for streamed and partially buffered failures.
- Fixed memory and session cleanup issues that could leave stale artifacts or inconsistent state.
- `lsp.formatOnWrite` now prefers a dedicated `isLinter` formatter server when a type-checker also claims the file ([#12847](https://github.com/can1357/oh-my-pi/pull/12847) by [@roboomp](https://github.com/roboomp)).
- `/extensions` no longer shows OMP-installed marketplace capabilities as disabled behind the foreign-plugin opt-in gate ([#12849](https://github.com/can1357/oh-my-pi/pull/12849) by [@roboomp](https://github.com/roboomp)).

### Removed

- Removed support for image query parameters (`?q=`) and bare image paths in the read tool.
- Custom models now honor provider-level `transport: pi-native` and send requests to the native gateway ([#12845](https://github.com/can1357/oh-my-pi/pull/12845) by [@joshrzemien](https://github.com/joshrzemien)).
- Fixed live models that match no `retry.fallbackChains` role primary (e.g. Fable after `/model`) resolving no chain, so a wait longer than `retry.maxDelayMs` aborted the session instead of walking `default` ([#12421](https://github.com/can1357/oh-my-pi/issues/12421)).
- Fixed skill hints drifting from the active prompt after discarded rebuilds or in advisor sessions ([#12148](https://github.com/can1357/oh-my-pi/pull/12148) by [@jerome-benoit](https://github.com/jerome-benoit)).
- Restored `askToolRenderer` on the extension namespace (`pi.pi.askToolRenderer`) after the pi-tui renderer migration dropped it, so extensions that shadow the built-in ask tool can keep the native rendering again. ([#12694](https://github.com/can1357/oh-my-pi/pull/12694) by [@xiechimon](https://github.com/xiechimon))
- Model discovery rejected with 401/403 now surfaces an authentication error in the /models hub instead of a silently empty model list. ([#12436](https://github.com/can1357/oh-my-pi/pull/12436) by [@xiechimon](https://github.com/xiechimon))
- Pasted or dragged image files now reach the agent with their original filesystem path, so it can read and act on the source file directly; clipboard screenshots keep working unchanged. ([#12404](https://github.com/can1357/oh-my-pi/pull/12404) by [@xiechimon](https://github.com/xiechimon))
- `/review` now runs VCS operations against the live session cwd after `/move` or `/wt` instead of the session-start checkout ([#12712](https://github.com/can1357/oh-my-pi/pull/12712) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Reinstalling or upgrading an npm plugin no longer leaves stale or duplicate manifest edges that broke `bun install` ([#12727](https://github.com/can1357/oh-my-pi/pull/12727) by [@F0Rextasy](https://github.com/F0Rextasy)).
- TTSR now emits one `ttsr_triggered` event per streamed violation instead of one per evaluation pass ([#12729](https://github.com/can1357/oh-my-pi/pull/12729) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Eval `wait()` timeouts above ~24.8 days no longer overflow the native timer and return immediately ([#12731](https://github.com/can1357/oh-my-pi/pull/12731) by [@F0Rextasy](https://github.com/F0Rextasy)).
- MCP OAuth against Google issuers now requests `access_type=offline` so refresh tokens are issued ([#12737](https://github.com/can1357/oh-my-pi/pull/12737) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Deleting a session now also removes its stale `.bak` rewrite backups so the picker cannot resurrect it ([#12746](https://github.com/can1357/oh-my-pi/pull/12746) by [@F0Rextasy](https://github.com/F0Rextasy)).
- `/collab` relay WebSockets now honor `HTTPS_PROXY`/`NO_PROXY` like other transports ([#12762](https://github.com/can1357/oh-my-pi/pull/12762) by [@jacobcolyvan](https://github.com/jacobcolyvan)).
- `tab.press()` now rejects the inverted `press(selector, key)` call with a hint naming the corrected `(key, { selector })` form, instead of the key parser's opaque `Unknown key: <selector>` ([#12136](https://github.com/can1357/oh-my-pi/issues/12136)) ([#12266](https://github.com/can1357/oh-my-pi/pull/12266) by [@danilouchoa](https://github.com/danilouchoa)).
- The display-reset shortcut (`app.display.reset`, `alt+l` by default) now fires while the ask dialog holds keyboard focus, instead of being dropped silently; the #11215 global-listener promotion covered the other four editor display actions but missed this one ([#12217](https://github.com/can1357/oh-my-pi/issues/12217)) ([#12262](https://github.com/can1357/oh-my-pi/pull/12262) by [@danilouchoa](https://github.com/danilouchoa)).
- Custom sessions can move across filesystems without losing their transcript or artifacts ([#12360](https://github.com/can1357/oh-my-pi/issues/12360), [#12378](https://github.com/can1357/oh-my-pi/pull/12378) by [@Dante-dan](https://github.com/Dante-dan)).
- Fixed `hub jobs` replaying full output for every settled job and consuming pending auto-delivery; it now returns a compact non-consuming status summary ([#12547](https://github.com/can1357/oh-my-pi/pull/12547) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Compiled bytecode binaries now start correctly when bundled dependencies use `import.meta.resolve` ([#12133](https://github.com/can1357/oh-my-pi/pull/12133) by [@andrebrait](https://github.com/andrebrait)).
- Subagents now retry provider stream errors that arrive after buffered partial output, and such failures are reported as transport errors instead of schema-invalid results ([#12752](https://github.com/can1357/oh-my-pi/pull/12752) by [@bse-ai](https://github.com/bse-ai)).
- Edits targeting auto-generated files now return a tool-scoped rejection instead of aborting the whole turn ([#12499](https://github.com/can1357/oh-my-pi/pull/12499) by [@Dante-dan](https://github.com/Dante-dan)).
- Subagents with an ordered model fallback keep it reachable on startup when the parent default role shares the same primary model ([#12377](https://github.com/can1357/oh-my-pi/pull/12377) by [@Dante-dan](https://github.com/Dante-dan)).
- omp-plugins MCP servers now substitute `${CLAUDE_PLUGIN_ROOT}`/`${OMP_PLUGIN_ROOT}` in `command`, `args`, and `cwd` ([#12801](https://github.com/can1357/oh-my-pi/pull/12801) by [@holny](https://github.com/holny)).

## [18.2.8] - 2026-09-21

### Added

- Added comprehensive browser automation tools for accessibility auditing, React inspection, console and network monitoring, performance tracing, semantic DOM queries, tab management, screen recording with cursor overlays, downloads, custom initialization scripts, persistent storage, and WebMCP cross-frame tool discovery.
- Added support for buffered cloud transcription with OpenAI-compatible models.
- Added visual change detection for video processing, including FFMPEG analysis and SVG overlays.
- Added support for declaring native judges through custom providers using the `typesafe` and `openrouter-decisions` API values, with configurable base URLs, API keys, and headers.

### Changed

- Expanded browser security and resilience controls with configurable HTTPS error handling, domain allow-listing, and automatic tab recycling when security-sensitive state changes.
- Updated background job notifications to deliver output as follow-up messages and discourage unnecessary polling.
- Expanded the bash tool's documented auxiliary utilities and removed its truncation footer notice.

### Fixed

- Improved responsiveness in long sessions by significantly reducing the time required to scan provider context for credential patterns.
- Fixed native judges failing to honor configured request headers, enabling authenticated and header-routed judge providers to work as configured.
- Fixed LSP requests hanging when aborted while waiting for an earlier write to complete.

## [18.2.7] - 2026-09-21

### Breaking Changes

- Image-generation overrides now use model selectors, and web-search CLI overrides use --model instead of --provider.
- Removed the bash tool's env parameter.
- Eval judge(state, questions) is now awaited and returns answers directly; JudgmentHandle and judgment support in wait() have been removed.

### Added

- Added `find` tool for semantic workspace searching, allowing agents to locate behaviors and symbols using natural language
- Added `find` CLI command for performing semantic workspace searches
- Added batch evaluation with judge_batch(states, questions) / judgeBatch(...), including bounded background execution, incremental result and status access, per-item failure reporting, and the ability to wait for or reattach to jobs across turns or after a reset.
- Added the jevify magic keyword to have the agent establish an evaluation rubric before classifying bulk items and inspect only items flagged by the judge.
- Added omp web-search as an alias for omp search.
- Added tui.titleSpinner configuration to select the terminal-title working-state spinner (braille, dots, or line).
- Added Handlebars-based system prompt templates through SYSTEM_TEMPLATE.md, --system-prompt-template, and the SDK, with access to live settings and tool data.
- Added configurable image, web, speech, dictation, judge, and memory model roles with ordered fallbacks, legacy backend-setting migration, and omp models --kind filtering.
- Added native OpenRouter image generation, model-selected web-plugin search, and live discovery of TypeSafe judge models.

### Changed

- Updated agent system prompts to prioritize the `find` tool over `grep` and `glob` for behavioral lookups
- Refined system prompt instructions for XML tag handling and agent persona
- Updated sloppy edit tool syntax to use plain text headers instead of XML tags
- Improved startup performance by validating provider-qualified model selectors against only the relevant provider catalog.
- Reduced launch time for npm and compiled builds by embedding the model catalog more efficiently.

### Fixed

- Fixed system prompt configuration validation so systemPromptTemplate and customSystemPrompt cannot conflict with a full systemPrompt replacement, including when values are empty.
- Added browser-relay support for listing eligible pages without attaching to or claiming them.
- Fixed Codex compatibility with the sloppy edit tool.
- Capped concurrent eval judge and completion requests to prevent large fan-outs from overwhelming judge and fallback models.
- Temporarily avoids retrying judgment requests with credentials that recently failed due to authorization or billing errors.
- Fixed image and speech fallback models disappearing after discovery and eliminated incorrect incompatibility warnings for providers without credentials.
- Fixed resume and continue flows to hide empty sessions.
- Fixed edit operations that could loop after empty insertions or fail on Unicode no-op and overlapping duplicate matches.
- Fixed live subagent messages being delayed by agent discovery and roster discovery looping on dot-named transcripts.
- Fixed llama.cpp discovery and routing for PrismML Bonsai 2 27B GGUF models, including support for cached models and the Qwen 3.8 thinking-level ladder.

## [18.2.6] - 2026-09-18

### Fixed

- Fixed clipboard paste stalling on an empty clipboard; image and text clipboard reads now run concurrently so the empty-clipboard status surfaces after the slower read instead of the sum of both.
- Fixed memory recall blocks carrying a minute-resolution `Current time` stamp that dirtied the cached system prompt on every refresh; recall rows already carry dates, so the stamp is removed.
- Fixed `omp auth-broker token` and `omp auth-gateway token` exiting silently without creating a token on Windows when no token file exists yet; token and config reads now use `node:fs` instead of `Bun.file`.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@2a4691429ee6](https://github.com/can1357/oh-my-pi/blob/2a4691429ee6cc22be24b566e2f5e0ad96b208f1/packages/coding-agent/CHANGELOG.md).
