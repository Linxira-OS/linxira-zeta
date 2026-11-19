## [Unreleased]

## [1.5.10] - 2026-11-19
## [19.0.0] - 2026-11-18

### Breaking Changes

- Changed SDK cache warming controls: createAgentSession.cacheWarming now accepts the mode cap "off", "streaming", or "idle"; the lower of this value and providers.cacheWarming applies. Use "off" instead of false.
- Replaced artifact://N links with readable, listable, and completable local://N.log files at the session's local:// root. artifact:// links in existing sessions are not migrated.
- Replaced session.handoff(focus) with session.compact(focus, { mode: "handoff" }); use abortCompaction() to cancel it.
- Consolidated shared background processes under one per-user daemon rather than project-specific brokers. Daemons and services from older versions are not adopted; omp ps now reports global, project, and session units together, removes --global, changes --json output to {daemon, reports}, and no longer adds ?project= to dsm:// handles.
- Renamed SDK deferSkillDescriptionCompression to deferHintCompression and startSkillDescriptionCompression() to startHintCompression(); these settings and methods now also cover MCP namespace hints.

### Added

- Added built-in MCP transforms, including the Codex Desktop node_repl replacement. Built-ins can be disabled with mcp.builtinTransforms; /mcp list identifies replaced servers and /mcp enable node_repl can explicitly connect one.
- Added optional MCP eval namespaces through mcp.evalNamespaces, exposing servers as JavaScript and Python namespaces with documentation at xd://eval/<server>. Results preserve text and structured data, and binary resources are saved as local:// files.
- Added model-generated names for /tan agents and their tray cards, with a readable random fallback when naming fails or times out.
- Added configurable cache-warming strategies (auto, keepalive, and compact), including long-tool-call keepalive and pre-expiry prompt compaction. Cache-warming events now report the selected method and costs.
- Added optional cross-instance task discovery and messaging with task.crossInstance, exposing same-folder instances through agent://peers.
- Added btw mode: drafts beginning with ? submit as /btw questions and receive distinct UI indication.
- Added Tern live cards for running subagents and background jobs, including progress, tool counts, status, controls, transcripts, and restored access to finished agents.
- Added daemon update survival and optional TCP hosting through OMP_DAEMON_TCP, preserving running services, PTYs, and language servers across daemon upgrades.
- Loaded speech-to-text and text-to-speech models once per machine, unloading them after 15 minutes of inactivity.
- Added ovnfs worktree support to /wt, the project resume picker, and omp worktree list/clear, while preserving session resume from the source repository after checkout removal.
- Added Claude subscription plans to omp usage and /usage output.
- Added progress reporting for background skill-description and MCP namespace hint generation.
- Added excludeFromContext to pi.sendMessage payloads so extensions can display and save per-turn messages without sending them to the model.
- Added a 30-second retry window for CLI and print-mode commands while the authentication broker restarts or is briefly unavailable.
- Added a notify option to the bash tool for reporting matching output from background commands and named services, waking idle sessions or ending blocked waits.

### Changed

- Improved cache warming for Anthropic-compatible providers with no-output prewarming where supported and billing based on actual replay costs; task subagents now keep prompt caches warm during long tool calls when streaming warming is enabled.
- Generated skill descriptions and MCP namespace hints once per machine, sharing results and progress across omp windows.
- Preserved thinking levels when switching models, adjusting only when the selected model cannot support the current level; model defaults apply only when no level is set.
- Extended repeated reply and subagent waits to use the session's prompt-cache lifetime, and made subagent waits follow the live parent's next message when appropriate.
- Made /handoff run as background compaction while preserving the current response and newly arriving messages.
- Redesigned ask prompts as a single scrolling form above the composer, preserving partial answers and allowing users to skip pending questions by sending a message.
- Enabled composer predictions by default, showing the active model's suggested next message after completed turns; disable them in Settings → Interaction.
- Disabled tool-call intent tracing by default in print, RPC, ACP, and SDK sessions; enable it with tools.intentTracing or PI_INTENT_TRACING.
- Updated ovnfs checkout guidance and git guard messages to explain how to land, pull, or discard changes.
- Improved subagent completion probes and side requests so they focus on deliverables and do not include still-streaming reasoning as plain history.
- Standardized wait behavior to a 5-second initial idle wait followed by four-minute back-to-back waits.
- Always provide subagents with the shared LSP tool; task.enableLsp now controls only LSP formatting and diagnostics for edits.
- Improved bash services, PTYs, and embedded shells with session environment inheritance, session-file URL support, clearer readiness validation, and more transparent minimized output.
- Named managed Chromium clearly when running in a window and improved browser, screenshot, upload, frame, selector, network, and CDP behavior across tabs and browser backends.
- Improved hashline editing with verbatim replacement bodies, safer range and path validation, clearer parse and syntax diagnostics, support for larger files and SSH files, and more predictable raw reads and line selectors.
- Improved MCP reliability with ten-minute tool-call deadlines, longer deadlines when progress is reported, clearer timeout and connection errors, and one retry after expired HTTP sessions.
- Expanded the embedded shell with portable built-ins and internal-URL support for common workflows, including file inspection, archiving, process control, environment loading, file watching, locking, speech, opening files, and patch application.
- Improved LSP and debugging diagnostics, language coverage, workspace detection, references, rename, code actions, and server lifecycle reporting.
- Improved eval tooling with Python 3.9+ validation, UTF-8 execution, package installation refreshes, full tool results, protocol-file access, threaded Python helpers, and clearer kernel-loss and timeout messages.
- Improved commit drafts and summaries to handle hooks, amend operations, worktrees, filters, line endings, large untracked trees, review files, and JavaScript/Python API parity more accurately.
- Improved URL, archive, GitHub, Terraform Registry, package documentation, web search, and remote-file handling, including filtering, pagination, binary conversion, archive member access, and clearer provider errors.
- Improved usage and account policy reporting so subscription limits and scoped exhaustion identify the affected plan or meter accurately.
- Improved worktree, process, wait, agent messaging, session restore, memory retention, Spotlight, Windows shell, and macOS performance behavior.

### Fixed

- Fixed MCP resource links and binary resources so they remain accessible as readable files or inline content rather than being dropped or shown only as placeholders.
- Fixed commit drafts after pre-commit hooks and partial prior commits so the index, diff, selected blocks, amended parent, review files, and generated summaries remain accurate.
- Fixed automatic Hindsight and Mnemopi retention during runs with async work, subagents, or peer messages, preventing duplicate or overlapping retention.
- Fixed blocked agents and waits by reporting waiters and dependency chains, delivering messages to queued agents, and correctly handling killed, evicted, resumed, or empty-output jobs.
- Fixed session resume and process-result handling across unified-daemon upgrades.
- Fixed thinking-level display and model-switcher behavior for subagents, auto-thinking sessions, and manually adjusted levels.
- Fixed worktree cloning, ovnfs/Git transitions, service readiness checks, shell environment inheritance, Windows junction removal, process substitution, checksums, and background command cancellation.
- Fixed browser automation reliability across screenshots, clicks, fills, tabs, frames, dialogs, uploads, CDP endpoints, stale connections, concurrent evaluations, browser startup, viewport emulation, clipboard, and platform-specific input.
- Fixed hashline, AST editing, generated-file detection, numbered content, remote-file editing, syntax diagnostics, path handling, and line-ending behavior.
- Fixed eval kernels, Python and JavaScript helpers, package imports, nested tool calls, internal URLs, and moved working directories.
- Fixed LSP, language-server startup, diagnostics, references, rename, code actions, project loading, file types, and debugger adapter selection.
- Fixed command-output summarization so relevant context, metadata, Git output, test timing, AWS output, lint diagnostics, and binary detection are preserved instead of being misclassified.
- Fixed read, grep, glob, URL, archive, SQLite, video, RSS, GitHub, package-documentation, SSH, and web-search handling across selectors, filters, pagination, archives, binary content, and provider failures.
- Fixed todo operations, ask compatibility and timeout behavior, image generation validation, GitHub PR pushes, plan proposals, and session accounting for side-channel model calls.
- Fixed MCP OAuth reauthentication errors to expose registration endpoints, status details, and remedies, and fixed auth-broker shutdown so refreshed tokens are saved safely.
- Fixed Spotlight retry and account handling, including waitlisted accounts, rate limits, outages, and request identification.
- Fixed cross-platform shell and desktop behavior, including macOS startup and redraw performance, Windows file operations and application lookup, speech output, and desktop opening.

## [18.22.2] - 2026-11-18

### Added

- Computer `el.setValue(75)` now writes the number as `"75"` instead of refusing a non-string; `NaN`, `Infinity`, booleans and objects are still refused, as are a whole number past 2^53 and a number that prints with an exponent, which are passed as text in digits instead ([#19405](https://github.com/can1357/oh-my-pi/pull/19405) by [@will-bogusz](https://github.com/will-bogusz))
- Added a report of native windows to browser results on macOS for visible managed browsers, spawned Chromium browsers and a loopback relay: a `<select>` menu, colour or date picker, or a print, save, sign-in, passkey or permission sheet or bubble a call raised over its tab is named with its `computer.window()` id while the browser's tab list shows that tab in front of its window, by the next call when it shows just after the call returned, and on failed calls too; connected CDP endpoints, remote relays and page-backed popup windows are excluded ([#18925](https://github.com/can1357/oh-my-pi/pull/18925) by [@will-bogusz](https://github.com/will-bogusz))
- Added Kiro as a built-in provider: run `/login kiro`, pick Identity Center, Builder ID, or an API key, and choose a discovered `kiro/<model-id>` model. Each `/login kiro` adds an account ([#18955](https://github.com/can1357/oh-my-pi/pull/18955) by [@Xytronix](https://github.com/Xytronix), based on [#14215](https://github.com/can1357/oh-my-pi/pull/14215) by [@ajdiyassin](https://github.com/ajdiyassin))
- Added Google and GitHub to `/login kiro`: approve a one-time code at `app.kiro.dev`, then sign in with that account ([#18955](https://github.com/can1357/oh-my-pi/pull/18955) by [@Xytronix](https://github.com/Xytronix), based on [#14215](https://github.com/can1357/oh-my-pi/pull/14215) by [@ajdiyassin](https://github.com/ajdiyassin))
- `/usage` and `omp usage` now show Kiro credits: the monthly plan credits with their reset date, active bonus credits with their expiry, and overage credits and charges when overage is enabled ([#18955](https://github.com/can1357/oh-my-pi/pull/18955) by [@Xytronix](https://github.com/Xytronix), based on [#14215](https://github.com/can1357/oh-my-pi/pull/14215) by [@ajdiyassin](https://github.com/ajdiyassin))

### Changed

- Model registries in one process (SDK embedders, tests) now share discovered-model builds, so refreshing another registry skips rebuilding models an earlier one already built

### Fixed

- Fixed the UI freezing briefly when a prompt is submitted: prompt history is now written to disk in the background (within 100 ms, and on exit) instead of on the Enter keystroke
- Fixed the UI freezing while discovered models from large provider catalogs are merged: the merge now runs in slices that yield to the event loop
- Fixed closing omp's headless browser taking about 7 s when Chromium never finishes a graceful shutdown (seen with Chrome for Testing 150 on macOS 27): a browser on an omp-created profile is now killed at once
- Failed computer runs retain text and screenshots already produced in JavaScript and Python Eval, so agents can inspect partial actions without losing the error; direct computer calls also show the failure's name and message alongside partial output ([#19100](https://github.com/can1357/oh-my-pi/pull/19100) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Exa and Firecrawl web searches silently falling back to their keyless public endpoints when a configured credential failed to resolve (for example a failing `!command`); they now report the credential error
- Fixed eval cells being able to call `yield` (directly or through `xd://yield`) without finishing the delegated task; eval now rejects `yield` and points to the direct tool ([#19470](https://github.com/can1357/oh-my-pi/pull/19470) by [@alphastorm](https://github.com/alphastorm))
- Fixed service `ready.log` and wait patterns not matching `^` and `$` at line boundaries after earlier output ([#19471](https://github.com/can1357/oh-my-pi/pull/19471) by [@alphastorm](https://github.com/alphastorm))
- Fixed the shell's `stat`, `diff` and `find` builtins ignoring `TZ` when printing file times; `find -ls` now prints times in the shell's time zone instead of UTC, and `find -newermt` reads dates like `Nov 15, 2023` in the shell's time zone ([#19482](https://github.com/can1357/oh-my-pi/pull/19482) by [@alphastorm](https://github.com/alphastorm))
- With TTSR rules active, large `write` and `edit` calls no longer slow down as their arguments stream ([#19494](https://github.com/can1357/oh-my-pi/pull/19494) by [@H4vC](https://github.com/H4vC))
- Fixed `/commit` and eval `commit` creating a single-parent commit during a merge; committing now refuses while a merge, cherry-pick, revert, rebase or `git am` is in progress or the index has unresolved conflicts ([#19474](https://github.com/can1357/oh-my-pi/pull/19474) by [@alphastorm](https://github.com/alphastorm))
- Fixed the `apply_patch` tool description calling it a shell command and forbidding absolute paths ([#19325](https://github.com/can1357/oh-my-pi/issues/19325), [#19468](https://github.com/can1357/oh-my-pi/pull/19468) by [@alphastorm](https://github.com/alphastorm))
- Fixed the shell's `rg` builtin ignoring `--glob` patterns that contain a slash ([#19476](https://github.com/can1357/oh-my-pi/pull/19476) by [@alphastorm](https://github.com/alphastorm))
- Fixed eval `commit` `only(...)` failing when one of its paths or globs matched no changed file; unmatched ones are now reported ([#19472](https://github.com/can1357/oh-my-pi/pull/19472) by [@alphastorm](https://github.com/alphastorm))
- Fixed a Tern browser block answering every later browser call with "Tab is busy: another call on this tab is still running" after a call whose page evaluation never returned, such as one cut off by a redirect; such a call now ends at its time limit or when cancelled, and the tab takes the next call
- Fixed the browser tool reporting a JavaScript `confirm` or `prompt` as still open, and failing page calls on it, after the user clicked it away or another CDP client answered it ([#19481](https://github.com/can1357/oh-my-pi/pull/19481) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `computer` `setValue` on a `<select>` in Chrome or an Electron app on macOS failing with an empty list of options; it now chooses the option the value names ([#19224](https://github.com/can1357/oh-my-pi/pull/19224) by [@will-bogusz](https://github.com/will-bogusz))
- A relay tab is no longer closed when another extension's frame, such as a password manager's autofill menu that undoes the relay clearing it, keeps Chrome refusing omp: the call fails saying what holds the tab, the tab stays open as the user left it, and the next call reattaches to it ([#19178](https://github.com/can1357/oh-my-pi/pull/19178) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the computer tool telling the model that only an X11 takeover can end with nothing sent because the user kept typing; a macOS takeover now waits for the user's pause too and reports `UserIntervened` the same way ([#19296](https://github.com/can1357/oh-my-pi/pull/19296) by [@will-bogusz](https://github.com/will-bogusz))
- When the browser relay hides another extension's frame in a tab omp drives (a password manager's inline menu or save card), the call that ran into it, or a later one on that tab, now names the frame's page, the extension's id and the page's own title, and says the frame is hidden for the user too ([#19001](https://github.com/can1357/oh-my-pi/pull/19001) by [@will-bogusz](https://github.com/will-bogusz))
- Anthropic web search now passes `site:`-scoped queries to Claude with the domain and path still in the text, and tells Claude to always search, so those lookups and queries it thought it could answer from memory no longer fail with "returned no sources" ([#18125](https://github.com/can1357/oh-my-pi/pull/18125) by [@will-bogusz](https://github.com/will-bogusz))
- Anthropic web search on models with a refusal fallback (Opus 5 and 5.5, Sonnet 5.5, Fable 5) has Anthropic retry a query the safety classifier declines on another Claude model, and reports a refusal or a failed search (`too_many_requests`, …) by name instead of "returned no sources" ([#18125](https://github.com/can1357/oh-my-pi/pull/18125) by [@will-bogusz](https://github.com/will-bogusz))
- Subagents without an output schema (including eval `agent()` calls without `schema`) no longer get a `yield` tool; their final message is the result.
- A `yield` without `data` no longer uses the subagent's last message as the result; it only finalizes incremental sections that were already submitted.
- A `computer` key press that opens a macOS popup button's or menu button's menu in the background now fails listing the items and naming the press or click that chooses one, instead of leaving the menu open with your keyboard ([#19179](https://github.com/can1357/oh-my-pi/pull/19179) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Claude not seeing the reasoning of earlier Codex, Kimi, Grok and other non-Claude turns after a model switch, including turns kept through a compaction; it now gets that reasoning as text. When Claude refuses a turn with `Refusal (reasoning_extraction)` because of that carried reasoning, the turn is retried once without it, and the session stops sending it to Claude ([#7241](https://github.com/can1357/oh-my-pi/issues/7241)) ([#17610](https://github.com/can1357/oh-my-pi/pull/17610) by [@will-bogusz](https://github.com/will-bogusz))
- After an Anthropic refusal, later turns no longer resend the refusal text with the tool calls it stopped: those calls now replay as "not executed" only, so one `reasoning_extraction` refusal stops making every following turn of the session likely to be refused too ([#19419](https://github.com/can1357/oh-my-pi/pull/19419) by [@flosrn](https://github.com/flosrn))
- Fixed selective commits skipping updated submodule pointers; existing initialized gitlinks can now be reviewed and explicitly selected without committing changes inside the submodule ([#19556](https://github.com/can1357/oh-my-pi/pull/19556) by [@kim-dali](https://github.com/kim-dali))
- Fixed git reads such as `/commit`'s status scan hanging when a background git process kept the output pipe open ([#19478](https://github.com/can1357/oh-my-pi/pull/19478) by [@alphastorm](https://github.com/alphastorm))
- Fixed the browser falling back to Chromium on the first launch of a new WebKit engine build on macOS: the WebKit host now gets 60 seconds instead of 10 to answer its greeting while macOS scans the engine's binaries and libraries ([#19423](https://github.com/can1357/oh-my-pi/pull/19423) by [@shgew](https://github.com/shgew))
- Fixed `--continue` opening a new empty session when the terminal's last session was started in another directory and closed before its first message; it now resumes the current directory's newest session ([#19495](https://github.com/can1357/oh-my-pi/issues/19495)).
- Fixed a rejecting `pre-commit` hook's stdout (e.g. the `pre-commit` framework's per-hook report) missing from the error raised by the eval `commit` namespace and `omp commit` ([#19449](https://github.com/can1357/oh-my-pi/issues/19449))
- `/commit` now shows the subject a commit-msg hook wrote onto the commit, instead of the subject from before the hook ran ([#19448](https://github.com/can1357/oh-my-pi/pull/19448) by [@eggpeat](https://github.com/eggpeat))
- `^model` references followed by sentence punctuation now register their model agent instead of remaining literal ([#19445](https://github.com/can1357/oh-my-pi/pull/19445) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Selective commits in sparse checkouts no longer report paths outside the cone as unstaged deletions to commit hooks ([#19453](https://github.com/can1357/oh-my-pi/pull/19453) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Custom providers pointing at the Zhipu Coding Plan endpoint now retry at the Beijing-time quota reset instead of waiting eight hours too long ([#19446](https://github.com/can1357/oh-my-pi/pull/19446) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- `/copy` now copies what a mid-turn `out://` reply showed, instead of the reply tool's own "Shown to the user." result, and lists the reply's code blocks in the turn's blocks ([#19551](https://github.com/can1357/oh-my-pi/pull/19551) by [@bannert1337](https://github.com/bannert1337))
- Fixed tools enabled during goal mode becoming unavailable after leaving it ([#19514](https://github.com/can1357/oh-my-pi/pull/19514) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Fixed the status-line usage segment showing another account's quota for multi-credential API-key providers such as `opencode-go`; it now follows the credential row the session router actually serves from ([#19456](https://github.com/can1357/oh-my-pi/issues/19456)) ([#19492](https://github.com/can1357/oh-my-pi/pull/19492) by [@thekitaev](https://github.com/thekitaev)).
- Fixed Objective-C message results and arm64 retain-register data flow in Ghidra analysis of Mach-O binaries, including previously analyzed cache-extracted frameworks ([#19558](https://github.com/can1357/oh-my-pi/pull/19558) by [@shgew](https://github.com/shgew)).
- With a modal dialog open, browser `fill`, `type` and `press` aimed at a field behind it now fail naming what covers it, as `click` does, instead of typing into the dialog's button and reporting success (on Chromium tabs and Tern tabs without native DOM reads); `press` also refuses a disabled element (on Chromium tabs and Tern tabs without native DOM reads), and Chromium `drag` refuses a covered start or end ([#19524](https://github.com/can1357/oh-my-pi/pull/19524) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed RPC `login` refusing providers with an at-your-own-risk warning (`antigravity-cli`, `google-antigravity`): the warning now reaches the host as an `extension_ui_request` `input`, and login continues on "yes" and cancels on anything else ([#19523](https://github.com/can1357/oh-my-pi/issues/19523))
- On Linux, file watching for language servers no longer puts an inotify watch on every directory under `node_modules` and `.git/objects`, which could use up the system's inotify watch limit and keep other programs such as systemd from adding watches ([#19459](https://github.com/can1357/oh-my-pi/issues/19459))
- `/restart` now re-execs through the launcher omp was started by, so an open session moves onto an upgraded binary instead of re-running a retained old install ([#19529](https://github.com/can1357/oh-my-pi/pull/19529) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- RPC hosts now always receive a terminal `agent_end` after an over-quota 429: usage-limit bookkeeping is bounded so a stalled usage report can no longer hold the event ([#19411](https://github.com/can1357/oh-my-pi/issues/19411), [#19417](https://github.com/can1357/oh-my-pi/pull/19417) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Rex and other OSC 7501 terminals no longer play a success sound mid-run when a stale agent end arrives after another run has opened ([#17307](https://github.com/can1357/oh-my-pi/issues/17307), [#19418](https://github.com/can1357/oh-my-pi/pull/19418) by [@yuzu-octopus](https://github.com/yuzu-octopus))

## [18.22.1] - 2026-11-17

### Breaking Changes

- The JavaScript eval `commit` helper now validates its arguments strictly: unknown option names and non-object options throw a `TypeError` that lists the supported options. Update scripts that pass extra options. Committing an unchanged draft repository now reports that it is unchanged instead of suggesting `take()`.

### Added

- Added the `providers.webKeyless` setting, enabled by default, to control whether web search and URL reading may use keyless services. Disable it to restrict these operations to configured providers; individual `omp q --model web/<engine>` requests can still explicitly run a keyless engine.
- Added configurable live voice endpoints and API keys through `live.endpoint` and `live.apiKey`. Live voice can now connect to any OpenAI Realtime WebRTC-compatible server without Codex or ChatGPT sign-in, including offline use, and `live.voice` accepts arbitrary voice names.
- Computer `el.setValue()` now accepts finite safe integer and decimal numbers and writes them as text, while continuing to reject unsupported values such as booleans, objects, `NaN`, and `Infinity`.
- On macOS, browser results now report relevant native windows—such as pickers, print or save sheets, sign-in prompts, passkey dialogs, and permission bubbles—with their `computer.window()` identifiers.
- Browser `select()` now accepts label-, value-, and zero-based index-based choices, including mixed choices for multi-select controls, across Chromium, Tern, and cmux tabs.

### Changed

- Keyless Parallel searches no longer send session or model identifiers; only the search query is sent.
- The `computer` tool's macOS takeover messages now describe the actual keyboard handoff state and explain the behavior of background window moves and hover-only controls.
- Chromium `tab.observe()` and `tab.ariaSnapshot()` now wait briefly for page updates triggered by preceding actions, producing more reliable post-action results.
- When another agent controls the desktop, `InputBusy` now identifies that agent and its omp process.
- Subagents now use their own browser context by default instead of opening tabs in the user's Chrome, Tern, or cmux session; relay or Tern access can still be requested explicitly.
- Browser task guidance is now delivered automatically after the first browser call, with safety guidance available before the first call and restored after compaction or rewind.
- Named-menu reads now include nested commands with their complete command paths.
- The eval `commit` helper now runs configured Git hooks in addition to hooks in `.git/hooks/`, matching `git commit` behavior. Configured hooks may cause commits to take longer or be rejected.
- Service readiness patterns now match line boundaries correctly, and shell file-time commands honor the configured `TZ` timezone.
- Large `write` and `edit` calls remain responsive while their arguments stream.
- Selective commits now handle initialized submodule pointers and sparse checkouts more accurately, and report unmatched paths explicitly.
- Git commit operations now provide clearer status and hook feedback, including unchanged repositories, hook output, hook-modified commit subjects, and repositories with an in-progress operation or unresolved conflicts.
- `/continue` now resumes the newest session for the current directory when the most recent session was created elsewhere before receiving its first message.
- `/copy` now copies the content displayed by mid-turn `out://` replies and preserves their code blocks.
- Tools enabled in goal mode remain available after leaving that mode.
- Status-line usage now reflects the credential actually selected for multi-credential providers.
- Custom providers using the Zhipu Coding Plan endpoint now retry at the correct Beijing-time quota reset.
- `^model` references followed by sentence punctuation now resolve as model-agent references.
- `/restart` now restarts through the original launcher so upgraded installations are used by the resumed session.
- RPC hosts reliably receive completion events after quota errors, and OSC 7501 terminals no longer play stale success notifications during a newer run.

### Fixed

- Fixed configured Exa and Firecrawl credentials silently falling back to keyless endpoints when credential resolution failed; credential errors are now reported.
- Fixed eval cells bypassing delegated-task completion with `yield`; use the direct tool instead.
- Fixed `/commit` and eval commits creating incorrect single-parent commits during merge and other Git operations; commits are now refused while an operation is in progress or conflicts remain.
- Fixed the `apply_patch` tool documentation incorrectly describing it as a shell command and disallowing absolute paths.
- Fixed the shell `rg` builtin ignoring slash-containing `--glob` patterns.
- Fixed `eval commit only(...)` failing when a selected path or glob matched no changed files.
- Fixed browser calls becoming permanently busy after interrupted page evaluation, and fixed stale JavaScript `confirm` or `prompt` dialogs causing subsequent calls to fail.
- Fixed macOS Chrome and Electron `computer.setValue()` failing to select an option from an empty option list.
- Fixed browser relay tabs being closed when another extension—such as a password manager—holds the tab; the tab now remains available for reattachment.
- Fixed macOS computer takeovers failing to report user intervention when the user continued typing.
- Improved browser relay errors for hidden extension frames by identifying the frame, extension, and page involved.
- Fixed Anthropic web search for `site:` queries and safety-refused searches, including clearer refusal and provider-error reporting and appropriate retry behavior.
- Subagents without an output schema no longer receive an unnecessary `yield` tool, and `yield` without data no longer incorrectly uses the last message as its result.
- Fixed macOS popup and menu interactions that could leave menus open or press the wrong control.
- Fixed Claude losing reasoning from earlier non-Claude model turns after model switches or compaction, and prevented refusal text from contaminating later requests.
- Fixed selective commits skipping updated submodule pointers and incorrectly reporting sparse-checkout paths as deletions.
- Fixed Git status scans hanging when background Git processes kept output pipes open.
- Fixed first-launch WebKit startup on macOS falling back to Chromium while the engine was still initializing.
- Fixed rejecting pre-commit hook output being omitted from commit errors.
- Fixed Ghidra analysis of Objective-C message results and arm64 retain-register data in Mach-O binaries, including cached frameworks.
- Fixed browser interactions behind modal dialogs incorrectly reporting success; covered fields and disabled elements are now rejected, and covered drag endpoints are detected.
- Fixed RPC login for providers that require an at-your-own-risk confirmation; the confirmation is now presented to the host and login proceeds only after approval.
- On Linux, language-server file watching no longer consumes excessive inotify watches in `node_modules` and `.git/objects`.

## [18.22.0] - 2026-11-16

### Breaking Changes

- `secrets.yml` regex rules are now Rust `regex` patterns run natively, in linear time: lookarounds and backreferences are no longer supported, and a `(?P<secret>…)` group marks the part to redact (text around it is context that stays); `\d`, `\w` and `\s` are Unicode-aware. A regex rule that does not compile stops startup with an error naming the file and entry instead of being skipped. Migrate `(?<=password=)\S+` to `password=(?P<secret>\S+)`; see [docs/secrets.md](https://github.com/can1357/oh-my-pi/blob/main/docs/secrets.md) ([#18965](https://github.com/can1357/oh-my-pi/pull/18965) by [@H4vC](https://github.com/H4vC))
- Secret placeholders are now four camelCased words after the friendly name, e.g. `GitHubToken_correctHorseStapleBattery`, with no ` delimiters, and the transcript shows the real value wherever the model wrote one. Placeholders in the old `$NAME_HASH:CASE form, in sessions saved before this change, stay literal text, including in tool calls the model copies them into; start a new session to get working placeholders ([#19014](https://github.com/can1357/oh-my-pi/pull/19014) by [@H4vC](https://github.com/H4vC))
- What the model writes from placeholders (replies, thinking, tool calls, summaries) is stored as written and replayed byte-identical, keeping thinking signatures and prompt caches valid; model output that still holds a value (written while redaction was off, or before the secret was configured) is redacted on replay. Values a regex rule finds later no longer rewrite earlier history. A `friendlyName` is shown to the model as written and is dropped only when it spells out its own secret ([#19014](https://github.com/can1357/oh-my-pi/pull/19014) by [@H4vC](https://github.com/H4vC))
- `ask` over RPC hosts without a form dialog now shows each prompt with the form's surrounding paragraphs, lists, preformatted blocks and tables instead of only the question ([#18927](https://github.com/can1357/oh-my-pi/issues/18927))
- Moved binary analysis from the standalone `ida` and `ghidra` tools into the backend-neutral `dsm` namespace (`xd://eval/dsm`).
- Replaced the `ida.enabled`, `ida.maxOpen`, and `ida.idleCloseSec` settings with `disassembler.backend`, `disassembler.maxOpen`, and `disassembler.idleCloseSec`; shared disassembler database APIs are now available under `@linxiraos/zeta/disasm`.
- Updated the `AgentSession` run lifecycle API: `agent_end` is emitted once when a run can no longer resume, and `agent_pause` reports runs that stop while awaiting work. Replaced `hasPendingAsyncWork()`, `settleAsyncWork()`, and `suppressAutoResumeUntilPrompt()` with `isRunActive`, `wakeSources`, and `waitForRunEnd()`. Calling `abort()` now also ends runs paused on background work; RPC, JSON print, and extension streams retain their existing per-loop `agent_end` behavior.
- Renamed the browser `tab.clickAt()` option from `clickCount` to `count`, matching `tab.click()`.
- Browser viewport screenshot coordinates now use the displayed image coordinates when the screenshot is scaled for the model; pass `css: true` (or `{ x, y, css: true }` for drag points) to provide viewport CSS pixels explicitly.
- Added opt-in `mnemopi.recallRelevance` (`off`, `auto`, or `on`; default `off`) to filter automatic memory recall for task relevance using the `judge` role.
- Added path-scoped entries for `bash.patterns` and `bashInterceptor.patterns`, resolved per working directory. Project and `--config` overlays now prepend these rules to global rules instead of replacing them.
- Added `bash.allowedEnvVars` and per-rule `env` lists to permit explicitly named environment-variable prefixes on matching `allow` rules.
- Subagents now preserve `@upstream` provider pinning on inherited models.
- Added `--no-judge`, `--no-spotlight`, and `--offline` options to restrict auxiliary services to the active model's provider or disable cross-provider services.
- Added per-rule TTSR `repeatMode` frontmatter (`once`, `after-gap`, or `always`) to override the global repeat policy.
- Compound bash approval prompts now show each command segment separately, distinguishing allowed segments from those requiring approval.
- Removed the `seance` agent, `/seance` command, and the task tool's `sourceSession` parameter.

### Added

- IM entrances can explicitly select the same existing Agent conversation and share its canonical native transcript and id; the binding UI lists conversation names, `!session list/use` is scoped to the exact instance/chat/thread/sender, and delayed replies return to their originating entrance (ADR-0061).
- Automatically generated session titles and spawned-task labels follow the effective UI language: Chinese selection produces Chinese-preferred names through the tiny/fork/refresh/task paths while explicit names, ids, paths and card codes stay unchanged (ADR-0062).
- Added the Gemini Decision 1 judge (`google/gemini-decision-1`) for the `judge` role, and `models.yml` accepts the `google-decisions` API ([#19060](https://github.com/can1357/oh-my-pi/pull/19060) by [@kevcube](https://github.com/kevcube))
- `ssh://` host listing, `ssh://` autocomplete and `/ssh list` now include the `Host` aliases from `~/.ssh/config` and `/etc/ssh/ssh_config` (following `Include`); `ssh.json` entries win on a name clash
- Added `find.verifyModel`, a model selector whose judge answers only `find`'s passage verification while filename and sketch ranking stay on the `judge` role ([#19006](https://github.com/can1357/oh-my-pi/pull/19006) by [@alphastorm](https://github.com/alphastorm))
- Added `zetacode bench --account` to benchmark a specific stored OAuth account, and report rejected priority requests instead of silently benchmarking standard speed.
- Text a browser or computer call types into a page or app, such as a password, no longer appears in plain text in an eval cell's status lines or the session file ([#18981](https://github.com/can1357/oh-my-pi/pull/18981) by [@will-bogusz](https://github.com/will-bogusz))
- Chromium main-world `waitForFunction` calls no longer expose Puppeteer's internal ARIA query bindings to page scripts ([#18883](https://github.com/can1357/oh-my-pi/pull/18883) by [@will-bogusz](https://github.com/will-bogusz))
- On macOS a `computer` run that ends while secure input is on now starts with a note naming the app holding it and saying the user's Escape and typing go unseen until it ends, instead of nothing while `capabilities()` still reported `globalEscape: true` ([#18982](https://github.com/can1357/oh-my-pi/pull/18982) by [@will-bogusz](https://github.com/will-bogusz))
- Windows computer runs now explain when a locked or disconnected session, or a secure desktop, prevents capture and input from confirming your app's state ([#18947](https://github.com/can1357/oh-my-pi/pull/18947) by [@will-bogusz](https://github.com/will-bogusz))
- Computer helpers now reject unknown option and filter keys instead of silently ignoring them, including keys unused by the selected `wait` or element `press` overload, and name valid keys and likely spelling corrections ([#18753](https://github.com/can1357/oh-my-pi/pull/18753) by [@will-bogusz](https://github.com/will-bogusz))
- Selector waits on Chromium-backed browser tabs and their frames now accept `state: "attached" | "detached" | "visible" | "hidden"` alongside Puppeteer's `visible`/`hidden` forms, including live snapshot refs and waits that span a navigation, and reject unknown options, invalid values or conflicting visibility flags instead of silently ignoring them. Frame wait timeouts remain catchable later in the same run ([#18924](https://github.com/can1357/oh-my-pi/pull/18924) by [@will-bogusz](https://github.com/will-bogusz))
- Chromium main-world `waitForFunction` calls rearm across navigation after an earlier wait instead of rejecting with "Waiting failed" ([#18884](https://github.com/can1357/oh-my-pi/pull/18884) by [@will-bogusz](https://github.com/will-bogusz))
- In Chromium browser tabs, `tab.hover` and element-handle `hover()` on a hidden match now wait for it to appear and, if it never does, fail with the reason (and a selector's match count), as clicks do, instead of failing at once with Puppeteer's "Node is either not clickable or not an Element" ([#18750](https://github.com/can1357/oh-my-pi/pull/18750) by [@will-bogusz](https://github.com/will-bogusz))
- Treating the result of browser `tab.console()` or `tab.errors()` as an array now fails with a message saying to read its `.entries`, instead of `slice is not a function`, and the browser docs state the `{ entries, nextSeq, dropped }` shape ([#18738](https://github.com/can1357/oh-my-pi/pull/18738) by [@will-bogusz](https://github.com/will-bogusz))
- A printed browser `tab.observe()` result, including a full observation returned through `tab.run()` (not arbitrary objects with an `elements` array), or one left as a JavaScript Eval cell's last value, shows every element, one line each, instead of the first 100 followed by `... N more items`; an observation changed after it returned, including in-place prototype edits, prints as plain inspect output, every element included ([#18772](https://github.com/can1357/oh-my-pi/pull/18772) by [@will-bogusz](https://github.com/will-bogusz))
- Added Ghidra support with automatic setup of Ghidra, JDK, and PyGhidra when analysis is explicitly requested; Auto mode uses an installed IDA Pro when available and otherwise falls back to Ghidra.
- Added support for sharing live analysis databases with child agents through `db.handle()` and `dsm.open(handle)`.
- Added a `Force Remove` option to `worktree.onExit` that removes session-created worktrees without prompting, including worktrees with uncommitted changes; new commits remain on the worktree branch.
- Added configurable automatic subagent prewalk through `task.agentPrewalkAuto`, allowing per-agent `on`/`off` settings or model patterns while preserving unconditional subagent prewalk.
- Unknown custom and discovered models now automatically detect reasoning support and remember supported reasoning effort levels for future sessions.
- Added inline image and web-page replies: supported terminals can display local, data, and HTTP(S) images and embedded pages, while other terminals receive linked fallbacks. Added `tui.renderEmbeds` to disable this rendering.
- Bash redirects can now write to all writable internal URLs, including job cancellation endpoints and handler-backed `agent://`, `cfg://`, `ssh://`, and `xd://` URLs.
- Added image pasting to `ask` form notes and `ui.formDialog` options via `acceptImages`; pasted images are returned with `[Image #N]` markers and described for text-only models. Unsupported prompts now clearly reject image pastes.
- Added `mnemopi.embeddingQueryPrefix` and `mnemopi.embeddingInputType` configuration for asymmetric and instruction-tuned embedding models, including providers that require an `input_type`.
- Added the `antigravity-cli` provider for Google Antigravity over ACP, with managed binary installation, `/login antigravity-cli` Google sign-in, host tool execution, and retained conversations across tool steps and history changes.
- Added `/commit` to create commits containing only changes made by the agent or a selected subagent, while preserving other agents’ and the user’s work. The workflow is also available through the eval `commit` namespace, supports targeting repositories outside the session directory, handles binary and non-UTF-8 files, symlinks, file mode changes, and initial commits, and can optionally skip commit hooks with `no_verify`; use `commit.enabled` to disable it.
- Added `auth.unpausedProviders` (the **Unpaused Providers** setting) to re-enable paused providers such as Google Antigravity at your own risk while preserving their stored login state.
- Added configurable long-turn todo reminders through `todo.midRunNudges`, including options to disable reminders, limit them to two, or continue with increasing intervals.
- Pasting styled content into the composer now preserves Markdown formatting and places embedded images at their original positions, while code copied from editors remains plain text.
- Added the `session_clear` hook and extension event, emitted when `/clear` resets the current session context without changing its session ID.
- Added path-scoped Bash allow rules, project and configuration overlay precedence, and environment-variable controls through `bash.allowedEnvVars` and per-rule `env` settings.
- Subagents now preserve `@upstream` provider pinning when inheriting models.
- Added deletion of individual prompts from Ctrl+R history with the Delete key.
- Added `--no-judge`, `--no-spotlight`, and `--offline` options to restrict or disable auxiliary services outside the active model’s provider.
- Added per-rule TTSR `repeatMode` settings (`once`, `after-gap`, or `always`) to control reminder repetition.
- Bash approval prompts now show compound command segments individually and identify which segments are allowed or require approval.
- Todo `done`, `drop`, and `rm` operations now accept multiple tasks in a single request, including newline-, semicolon-, comma-, or space-separated input without splitting exact task-name matches.
- Todo status lines now display task counts when multiple targets are involved.
- **TUI `/channels`** — an operator entry that lists configured IM channels with their live health (state, detail, last error, since, last inbound), runs `login`/`status`/`logout`/`unbind`, and takes a per-channel pairing lock so two processes cannot pair the same account at once. A backend-attached client refuses the command and leaves pairing to the owning process ([#283](https://github.com/Linxira-OS/linxira-zeta/pull/283)).
- **Per-device tokens for remote access** — pairing mints its own `zdt_…` token and registry row (label, platform, scopes, created/last-seen) instead of handing every client the machine-wide `remote.token`; each device is listed and revoked independently, and rotation of the machine token no longer logs out paired phones. Tokens are stored hashed; a corrupt registry fails closed for device tokens while loopback and the machine token keep working ([#285](https://github.com/Linxira-OS/linxira-zeta/pull/285)).
- **Work Studio IM Channels settings** — one pane for WeChat, Feishu, Telegram, Discord and QQ driven by the runtime's channel registry: live status, WeChat QR login, credential entry for the token-based adapters, and chat bindings (`remote.sessionMappings`) with workspace/bot-session selection; the pane reads and writes the same `web.yml` as the CLI ([#286](https://github.com/Linxira-OS/linxira-zeta/pull/286)).
- **Discord and QQ (OneBot v11) channel adapters** — Discord uses the official Bot API (Gateway v10, `MESSAGE_CONTENT` intent, guild/DM routing, @mention and reply triggers, attachments with a size cap, 2 000-character splitting, 429 handling, resume/reconnect, health states); QQ is a generic OneBot v11 client (forward or reverse WebSocket, Bearer token, `echo` correlation, group/private peers, images, reconnect, `get_status` probing). Both are deny-by-default and require `channels.discord.allowedChannels` / `channels.qq.allowedGroups|allowedUsers`; `zetacode channels login discord|qq` verifies before writing credentials ([#288](https://github.com/Linxira-OS/linxira-zeta/pull/288)).
- **Device two-factor authentication (TOTP)** — RFC 6238 enrollment with ten single-use recovery codes, `/2fa` command surface, a configurable `required` policy, per-device verification (12 h for remote writes, 10 min for sensitive operations such as revoking a device or rotating the token), and local-only enrollment so a stolen token cannot install an attacker-controlled factor. The base32 secret is stored at `<agentDir>/auth/totp.json` with mode `0600` ([#292](https://github.com/Linxira-OS/linxira-zeta/pull/292)).
- **`/cd` changes the session's working directory from inside the TUI** — a folder-only picker that lists the real Windows volumes (drive type and volume label, so a phone or a CD is not an internal disk; A:/B: only when present) or the POSIX mount points from `/proc/mounts`, with pinned paths, type-to-filter, keyboard and mouse selection, and `Ctrl+R` to open the session resume tree on a folder instead of switching to it. Switching relocates the session file and artifacts into the destination bucket and re-scopes project settings, memory, plugins, skills and commands; a home-directory launch keeps its `~/tmp` workspace and now says so in a startup notice ([#287](https://github.com/Linxira-OS/linxira-zeta/pull/287)).
- **Official `adr` and `prd` skills** — two bundled skills ship beside the document skills: `adr` records architecture decisions (context, options, consequences) and `prd` writes product requirement documents with acceptance criteria, both cross-referenced from `grill-me` and discovered from the same `skills/official` provider ([#293](https://github.com/Linxira-OS/linxira-zeta/pull/293)).
- **Zeta Team (1.5 line)** — the ownerless Team root, database-backed Hub and rooms, `/lead` PM mode, PM Secretary and Studio Team graph shipped in 1.5.0 and remain unchanged here; 1.5.1 adds no Team schema change.
- **Team graph in Work Studio** — `team.graph.get` projects one snapshot of the Team database plus the live main-agent registry: a dashed ownerless Team boundary, PM workspaces, canonical repos and `binding` edges, engineers (recorded `vibe`/`normal` mode; an unattached row is `offline`, never a fabricated agent), linked worktrees, DB rooms with membership edges, and Secretary `spawn` edges; the UI adds PM/room/repo filters and Vibe/normal, persistent/ephemeral and home/task badges.
- Extensions can reopen a dismissed plan review while the session is idle (`ctx.openPlanReview()`) and pick the execution tier on `ctx.resolvePlanReview` (`input.role`); `plan_review_requested` now reports the slider's tiers ([#15552](https://github.com/can1357/oh-my-pi/pull/15552) by [@Shadorain](https://github.com/Shadorain))
- Added a microphone button beside Send in Tern: click to record, click Stop to finish, then review and submit the transcription yourself. Clicking while it says **Starting…** cancels a slow first model load ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- Added local Nemotron streaming dictation: words appear while you speak, and the microphone waits for the recognizer to be ready before recording ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- Added agent frontmatter `structured: true`: that agent's task spawns keep the `yield` tool and its `output` schema validation while `task.structured` is off ([#15717](https://github.com/can1357/oh-my-pi/pull/15717) by [@alphastorm](https://github.com/alphastorm))
- The composer stays usable while a tool approval is pending: sending a message denies the call and steers the turn with it, so the agent knows why it was denied ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- Session entries record which omp build wrote them, so a transcript shows whether a fix was live even in a session left open across an upgrade: the version, plus commit, branch, and uncommitted-diff hash when run from a source checkout, and `OMP_BUILD_LABEL` when set. `/session` lists the builds that wrote the session ([#15680](https://github.com/can1357/oh-my-pi/pull/15680) by [@will-bogusz](https://github.com/will-bogusz))
- Added `plugin_manager` and `plugin_inspect` tools for main-agent plugin install/enable/inspect workflows; they are hidden from subagents and guarded at execution time.
- Added a cached Git branch/ahead/behind/staged/unstaged/untracked and recent-commit widget to the TUI right sidebar.
- The bundled office skills (`docx`, `xlsx`, `pptx`, `pdf`) are installed into your own skills directory (`~/.zeta/agent/skills/`) as files you can edit and version, on first session startup or with `zetacode skill install-official`; files you edited are never overwritten, and `--uninstall` hands the names back to the built-in provider.
- Added the tea tool suite: a `tea` CLI integration for self-hosted Gitea (and gitea.com) covering repo/issue/pull-request/checkout/merge/release ops (`repo_view`, `repo_create`, `issue_*`, `pr_*`, `release_*`), with every create-type operation verified by reading back through the API (`tea repo create` has a history of silent failure). Enabled via `gitea.enabled`, off by default.
- Added WeChat `/api/v1/wechat` login (QR + status polling) with legacy iLink fallback, persisted peer→context_token bindings in `web.yml` (`channels.wechat.peerTokens`), and a `POST /api/channels/wechat/unbind` gateway route that resets the channel and clears credentials.
- Added `POST /api/channels/send` to the `zeta serve` gateway: any process outside the server (the desktop shell, a script) can push one IM message through a running WeChat/Feishu/Telegram channel with `{channelId, to, text}`; 404 when that channel is not running here, 400 when the peer is not paired (WeChat needs a `context_token` from an earlier inbound), 500 when the platform refused. Same access gate as `/api/channels/status` — loopback passes, a non-loopback caller needs `remote.token`.
- Added an interactive confirm to `zeta update` before installing a new version (default no on non-TTY input); `--yes`/`-y` skips it.
- Added `lsp.requestTimeout` setting to configure wait durations for language server diagnostics and requests
- Added `omp auth-gateway serve --clients=<file>`: per-client bearer tokens, each limited to listed models and broker OAuth accounts with no fallback to other accounts or API keys, re-read while serving ([#5098](https://github.com/can1357/oh-my-pi/issues/5098), [#15900](https://github.com/can1357/oh-my-pi/pull/15900) by [@alphastorm](https://github.com/alphastorm))
- OMP v18.1.10 sync baseline (`f241301c8372`): native Rust edit engine (EditStore/EditSession/DiffStream) behind the `edit` tool, `skillful` setting + `/skillful` per-session skill listing, agent emoji reactions (`tui.reactions`), plan-aware read window preserved for plan files, upstream security-scan command family rebranded, extension/agent discovery hardening.
- TUI settings page fully localized (zh): tabs, group headings, option values, footer hints, preview chrome and slash-command descriptions now follow the configured language; `/language` applies live.
- Web search now tells the agent about its X post operators (`site:x.com`, `from:<handle>`) when you are logged in to xAI, so questions about reactions on X reach X search.
- Reduced memory retained after merging unchanged discovered and cached models ([#14252](https://github.com/can1357/oh-my-pi/pull/14252) by [@iliaal](https://github.com/iliaal)).
- Added a Copy button that leads the turn footer under an answer in Tern (`⧉ · 2m13s · 71K tok · $0.85 this turn`, in place of the clock), which copies that answer
- Added `/fork` support for creating a new Tern pane while a turn is streaming, preserving the original session
- Added hiding a pending `ask` question without answering it: `Alt+H` (`app.ask.hide`) or the Hide button in Tern collapses the dialog to one line; the same key, `Enter`, or Show brings it back ([#15400](https://github.com/can1357/oh-my-pi/pull/15400) by [@H4vC](https://github.com/H4vC))
- Added `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` support: set it to stop Anthropic requests sending experimental beta fields that a company `ANTHROPIC_BASE_URL` gateway rejects, such as the Sonnet 5.5 `thinking.adaptive.block_binding` 400 ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))
- Added the `task.structured` setting (default off) for structured task results: when on, the task tool accepts `outputSchema`/`schemaMode` and subagents return results through `yield` as before
- Added `task.agentSoftRequestBudget` to give named subagents their own soft request budget, so a long-running agent can get more requests (or `0` for no guard) while scout, sonic and other agents keep theirs ([#15419](https://github.com/can1357/oh-my-pi/pull/15419) by [@will-bogusz](https://github.com/will-bogusz))
- Added `o200k` as a `tokenizer` value for custom models and overrides in `models.yml` ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))
- Extensions can observe and answer the interactive plan review, including refinement feedback and save-and-quit ([#14250](https://github.com/can1357/oh-my-pi/pull/14250) by [@rlfleming93](https://github.com/rlfleming93))
- Added opt-in `omp gc --compress` (or `gc.compress`), which stores sessions idle for `gc.compressAfterDays` (default 7) with filesystem transparent compression (APFS, NTFS); they stay resumable and searchable ([#15600](https://github.com/can1357/oh-my-pi/pull/15600) by [@wolfiesch](https://github.com/wolfiesch))

### Changed

- Simplified Chinese settings now call the taste layer “写法先进”. Existing `taste.*` keys and preference stores carry over.
- TUI Settings now opens nested Identity & devices and IM runtime pages, also reachable through `/2fa` and `/channels`. Mouse and configured keys share navigation; temporary QR/credential editors use the existing local serve, and bindings explicitly select an existing native conversation while retaining its target/Profile/model locks (ADR-0067).
- Coding-agent package packing now executes the rebuilt CLI and checks its embedded source commit, refusing missing or stale provenance before a release can pack the artifact (REQ-036).
- Studio maintenance compares explicit official release tags in one mapped three-way batch, preserves Zeta Host/transport contracts for review, and records safe applications with backups. Reusable quick/behavior/final gates report per-step evidence; final accounting rejects stale decisions and missing source ancestry (ADR-0044).
- Studio v0.2.1 shared contracts remove obsolete mirrored request/result validators and the unused frontend protocol copy. The existing Zeta Host keeps the actual launch, browser/Computer, private IPC, workspace and native-work input checks (ADR-0052).
- Secret redaction no longer rescans the whole conversation on every request: text already redacted in an earlier request is reused until a new secret changes the outcome, and `secrets.yml` regex rules skip text missing their leading literal, cutting redaction on a large session from 17–55 ms to about 1 ms per request and the first request after loading by 2–4×
- Trimmed the default system prompt: the tool-choice rules now only point to `read`, `edit` and `find`; the reasoning-format, AST and subagent-limit guidance is gone (`ast_edit`/`ast_grep` state their preference in their own summaries); the workflow, delivery and critical rules are shorter and no longer repeat each other; Spotlight's note on how tool results are shaped is a short list under Tool I/O instead of a paragraph at the end; and xd:// devices are listed by bare name
- `edit.modelVariants` now picks the longest matching model pattern instead of the first, so a specific key like `openai/gpt-5` wins over `gpt` whatever the config order ([#17835](https://github.com/can1357/oh-my-pi/pull/17835) by [@DeprecatedLuke](https://github.com/DeprecatedLuke))
- Browser tabs open in omp's own headless WebKit engine instead of managed Chromium when the engine, ABKit, is installed (`~/.o2/lib/abkit/ABHost`, `ABHost.exe` on Windows, the location Tern uses too; or the `browser.webkitPath` setting / `PI_BROWSER_WEBKIT_PATH`): pages see a visible, focused window with no automation flag, and a default tab runs no omp script in the page (console, errors and the request log come from the engine; `route`, geolocation/locale/offline emulation, `vitals` and `reactEnable` add page code only when called; response bodies are unavailable there). Chromium still opens `headed` tabs where the engine ships no viewer and takes over, saying why, when the engine cannot start; `app: "chromium"` picks Chromium for one open and `app: "webkit"` requires WebKit (with `headed: true` its tab opens in a window), and the `browser.webkit` setting or `PI_BROWSER_WEBKIT=0` turns it off. On macOS the engine has WebGL, WebGPU, silent video and audio playback, Web Audio, WebRTC, WebAuthn, gamepads and Web Share, and its TLS handshake, HTTP/2 settings and request headers are the ones Safari sends
- omp downloads its WebKit engine, ABKit, from build.stencil.so into `~/.o2/lib/abkit` (checked against the build's SHA-256) for `app: "webkit"` when it is missing, and before Chrome for Testing when an open finds no browser installed; a failed download leaves that open on Chromium and says why
- The `task` tool description now lists only the delivery rules (results auto-deliver, `wait`, unverified `completed`); the `read proc://`, `write proc://<id>/kill`, job-expiry and `write agent://` reference arrives with the session's first spawn result
- The `ask.timeout` setting, README and RPC schema docs now describe the `ask` tool as an HTML form that submits its current values on timeout, not a question picker that auto-selects an option
- The `bash` tool description lists the embedded shell's in-process builtins again, straight from the shell, so it follows every `PI_DISABLE_*` switch and the platform
- `read`'s selectors for SQLite, archives, JSON queries, executables, video and SVG, and the sub-path grammar of `proc://`, `ssh://` and `issue://`/`pr://`, no longer ship with every request: the model reads them on demand at `xd://read/sources` and `xd://read/urls`, and they stay inline when `read` is off
- `/browser visible` and `/browser headless` now show and hide the windows of omp's WebKit tabs at once instead of waiting for the next open: where the engine ships its viewer (macOS), each tab gets a window of its own that the user can also click, scroll and type in, and `headed: true` or `browser.headless` off keeps a tab on WebKit with a window instead of sending it to Chromium. Chromium tabs still change mode with the next open
- In a Tern whose engine reads the DOM natively, browser `observe`, selectors, clicks, typing, element reads and waits no longer run script in the page: the engine finds elements (across frames and closed shadow roots) and every action is trusted input at the point it resolved; `type` then types at the caret its click places, and `text/` selectors ignore case
- A browser screenshot's text is one line (the size the model sees, the full-size file when one was kept, and the coordinate factor for `tab.clickAt`) instead of four lines with byte sizes and formats, and `browser.open` reports the tab, the page it landed on when that is not the requested URL (using navigation's normalized URL comparison), and the title on one line ([#18776](https://github.com/can1357/oh-my-pi/pull/18776) by [@will-bogusz](https://github.com/will-bogusz))
- RPC `select` requests carry `initialIndex`, `selectionMarker`, `checkedIndices` and `markableCount`, so hosts can show which `ask` checkbox options are already checked instead of letting users toggle them blind ([#18929](https://github.com/can1357/oh-my-pi/pull/18929) by [@andrebrait](https://github.com/andrebrait))
- Every language server now hands file watching to omp (it was only TypeScript 7); set `watchFiles: false` on a server to keep its own watcher
- A failed JavaScript Eval cell prints the error's message and the cell's own frames, with one line counting the hidden frames from omp's runtime, its dependencies and the engine, instead of the full host stack; project-local dependency frames stay visible, cached stacks whose headers no longer match the error stay intact, floating rejections retain their current message and missing-await hint even with a cached stack, and `print(e.stack)` in a `catch` still shows every frame ([#18775](https://github.com/can1357/oh-my-pi/pull/18775) by [@will-bogusz](https://github.com/will-bogusz))
- Snapcompact compaction resolves the frame shape once in its preflight and passes it to `compact()`, which re-derived it with the `auto` shape setting; the preflight scans the transcript once instead of twice, runs as the `compaction.snapcompact` loop phase, and yields to the event loop before rendering ([#15689](https://github.com/can1357/oh-my-pi/issues/15689), [#18867](https://github.com/can1357/oh-my-pi/pull/18867) by [@wolfiesch](https://github.com/wolfiesch))
- Full session file rewrites (pruning, image drops, rescue stamping) run as the `session.rewrite` loop phase, so their stalls are attributed in `ui.loop-blocked` logs ([#15027](https://github.com/can1357/oh-my-pi/issues/15027), [#18867](https://github.com/can1357/oh-my-pi/pull/18867) by [@wolfiesch](https://github.com/wolfiesch))
- Plain executable reads now display Mach-O, ELF, and PE metadata without opening an analysis database or downloading a backend; request an overview, function details, or `dsm.open()` to begin analysis.
- Overlapping Bash calls now share shell state, including variables, functions, aliases, options, and traps, and background jobs started by those calls continue running independently.
- Extensions enabled or reconfigured through `extensions` or `disabledExtensions` now load into the active session without requiring a restart.
- Rich-text pastes made during approval steering or in dialogs now preserve Markdown formatting and images when inserted into the chat editor.
- Moving a task or resuming a session in another project now switches its agents, extensions, custom tools, and MCP servers to match the destination project without a restart.
- Browser screenshots are delivered to the model in CSS pixels up to the supported unscaled size, making viewport screenshot coordinates directly usable with browser actions; scaling guidance remains for scaled full-page and element captures.
- Browser `waitForUrl`, `waitForResponse`, and `requests({ filter })` now support `*` glob patterns in URL strings, while other strings retain substring matching.
- Pressing Delete at the end of the Ctrl+R search field removes the selected prompt from history.
- `/copy` now works while viewing a subagent and copies from that subagent's transcript.
- `find` now returns unranked literal keyword matches when all judge requests fail.
- `take()` and `drop()` now reject nonexistent hunk units with a clear error.
- `edit` rejection messages now suggest the file's current tag, and edits made before conflict resolution carry over to the resolved file.
- `/marketplace` and marketplace install/uninstall commands now report picker and catalog-load errors without exiting the session.
- ACP sessions honor `mcp.startupTimeoutMs` for MCP servers declared by the client, and ACP form elicitations no longer repeat field labels unnecessarily.
- Task progress from every `task.steps` subagent step is now preserved, rather than only the final step's report.
- Pasting HTML into the composer now preserves spaces from whitespace-only inline elements and indentation inside `<pre>` blocks.
- Queued follow-ups edited with Alt+Up are restored as queued messages instead of being sent into the active turn.
- `/fork` and fork-from-transcript now abort an active response and fork immediately.
- Reduced default `grep` output by showing only matching lines and limiting matches per file; configure `grep.contextBefore` and `grep.contextAfter` to include surrounding context.
- Changed the default `spotlight.thinking` level from `low` to `med` for deeper result analysis and improved ranking, at a higher request cost.
- When Spotlight is enabled, commonly reread source and issue or pull-request content is shown more completely before outlining, including support for additional source file types.
- Integrated OMP v18.22.0 runtime contracts into Zeta while preserving source-owned background results and the standalone serve authority (ADR-0068); Tern, WebKit, collaboration, and audio product holds remain in force.
- **Vibe remains an execution mode, not a Team**: `/vibe` is the Super Agent director over persistent router/worker sessions. A Team engineer's `--execution vibe` only records the choice, no Team entry enables Vibe automatically, and Team Vibe v2 is not implemented.
- **Plugin boundary is explicit**: `pi-messenger` remains the bundled official plugin (Crew/Mesh); `/teamagent` is its crew layer and is not Zeta Team, reading `.zeta/messenger/team/` and never the Team database. Zeta Team commands (`/team`, `/team hub`, `/lead`, `/pm`) stay core, and a new proof test pins the core/plugin ownership cutover.
- Running agents and background jobs in Tern now share one compact counter over the composer (an icon and a count each, the words on hover) instead of two "N running" pills; each count still opens its own sheet
- In Tern, `/session pin` and `/usage reset` open the same picker sheet as the other small selectors (the active account checked, a confirm strip before a reset is spent, unusable accounts dimmed with the reason); the thinking level picker shows each level's depth as a meter, the plugin and queue mode pickers use badges (version, installed, scope, recommended) and plain-language names instead of bracketed text, and the theme picker no longer repeats "(current)" beside its check
- In Tern, the text editor an extension opens (and the ask tool's custom answer and note) is now a sheet in the composer's place: the title over its details, the text written straight on the sheet, and Open in editor, Cancel and Submit buttons whose keys show in their tooltips instead of a keycap hint row
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

- Include third-party notices in the standalone IDE and Editor npm packages and their platform payloads.
- IM turns include the sender and message body in the model input. Queued inputs enter the transcript in turn order, so compaction and replay preserve each question and its reply.
- Fixed Work Studio packaging when Vite runs under Bun during npm tarball preparation.
- Account/device 2FA fails closed when its store is damaged, keeps verification grants tied to the active factor and clears them after factor/policy changes. Recovery codes work from the global prompt and Settings; concurrent requests share one verification and cancellation settles late challenges. `/2fa status` and `zetacode 2fa status` expose secret-free terminal status (ADR-0060).
- **Z Work Studio identity** — sidebar, About, empty conversations, BTW labels, logs, session import/resume and bilingual previews use Z Work Studio / Zeta. Browser preferences consistently use `zeta.*`; the existing startup migration preserves earlier `omp.*` preferences. Existing IndexedDB databases and old recording files remain readable.
- Studio command terminals retain their selected workspace and launch a dedicated script process instead of dropping the command; the Host rejects conflicting profile/program inputs and retains device-binding ownership (ADR-0045).
- Studio workspace files have bounded, version-checked chunk reads and UTF-8/UTF-16 text editing with atomic saves and conflict detection through the existing authenticated Host. Optional Office controls reflect the actual signed-component capability (ADR-0046).
- Studio browser observation uses private authenticated pipes scoped to the active view and live session descendants; view/session disposal, revocation, expiry and ownership changes release captures and human-control leases without closing the target (ADR-0047).
- Managed desktop browser relays use the existing Host/session authority, keep private endpoints out of public replies, and retain desktop pages during Runtime cleanup. WebMCP uses a typed worker route and checks document identity before invocation (ADR-0047).
- Electron browser attachment validates the live Host PID and exact prepared descriptor, releases owners across navigation/crash/session changes, and keeps file leases pinned to Host versions. The isolated X3D viewer permits its required WASM without relaxing the main renderer CSP (ADR-0046, ADR-0047).
- Restoring concurrent Studio conversations after a Desktop/browser reload waits for the cookie/CSRF bootstrap before opening Host contexts, sharing concurrent bootstrap requests instead of sending an unauthenticated context mutation.
- The frameless Desktop root mounts one caption strip through `zetaStudioChrome`, restoring the minimize, maximize/restore and close buttons across concurrent conversations.
- Desktop Hindsight credentials use OS encryption per execution target and exact service URL, supplement the existing Host without entering settings/receipts, and stop applying on removal, owner disconnect, expiry or revocation. Sessionless settings read current project values, and session-only writes remain confined to their live conversation (ADR-0048).
- Studio Computer activity uses native session ownership, passive-only observation and exact Desktop view leases; private frame bytes stay out of public state, and unsupported binary artifact saving is hidden (ADR-0047).
- Studio evaluations execute through native benchmark, instruction, judgment and Ratchet paths with session-owned cancellation, retained results and generation-bound reviews (ADR-0049).
- Studio Time Travel captures real workspace snapshots at awaited native turn boundaries and restores code, exact conversation positions or both with stale-preview protection, workspace admission fencing and safety backups (ADR-0050).
- Studio service controls now use the existing workspace broker with exact launch-instance checks, preventing stale restart/stop/input requests from targeting a replacement process. Agent-declared web previews retain their URL, owner and PID across native restart/recovery without publishing launch configuration (ADR-0051).
- Studio composer prediction now has real producers: the existing native text-prediction daemon runs under an isolated Studio corpus/profile, next-message alternatives reuse the native composer controller, and drafts travel only over bounded authenticated private sockets owned by one live view. Desktop adopts the prepared channel through trusted top-frame IPC and imports history only through a file picker; settings, session disposal and window loss release the channel. Clearing the corpus stops that exact daemon without touching the shared model cache or TUI history (ADR-0053).
- `session.create` applies the chosen provider/model inside session creation instead of a post-create switch, so the first turn cannot run on the default model.
- Managed desktop WebMCP now works on Chromium 156 and 157 (both `WebMCPTesting` and `WebMCP` are enabled), keeps a stable document identity across same-document navigation, invalidates catalogs/references on cross-document commit or renderer crash, and closes private observation on inspector crash/detach while releasing the human-control lease (ADR-0054).
- `session.delete` cancels the resident native session and closes its sealed writer before moving the transcript to trash; late teardown cannot recreate a ghost transcript, and the receipt does not wait for unrelated memory consolidation.
- Palette and topbar terminal openers expand a collapsed bottom region instead of selecting a tab nobody can see.
- Integrated terminal grids shrink with the bottom panel instead of keeping a clipped 24-row surface. Terminal rows and input inherit the configured terminal font; native floating windows read their own mirrored typography and theme.
- Studio history rename and explicit pin controls now persist through the existing native writers, enforce the selected workspace and device session binding, and report the saved title. BTW image-path paste uses the native image loader within the live selected conversation.
- Native terminal recordings use their own recorder URL authority. Artifact imports retain their declared kind despite conflicting filename suffixes; Desktop export rechecks the invoking Host context immediately before committing the destination file.
- Studio local-resource commands accept the renderer's kindless input and keep live-view fences through asynchronous reads and saves. BTW promotion rekeys the resident wrapper and preserves a later conversation selection; recorded shell sources and portability secondary targets obey workspace/device binding.
- Queue mutations retain their invoking view while waiting in the serialized queue and discard staged takeback images on revocation. Session transfers retain per-invocation authority, so another window's status read cannot authorize an older transfer.
- With the Spotlight experiment on, a `read` with `:raw` returns the selected bytes instead of an outlined, compacted, collapsed or cut rendering ([#18713](https://github.com/can1357/oh-my-pi/pull/18713) by [@eggpeat](https://github.com/eggpeat))
- With the Spotlight experiment on, a `;`/`,` path `read` is shaped as one call: each part as that read alone would be (an outlined source file beside a `:raw` part kept verbatim), no part collapsed as already shown against another, and one trace whose notice opens the original ([#18713](https://github.com/can1357/oh-my-pi/pull/18713) by [@eggpeat](https://github.com/eggpeat))
- Fixed false unknown-model fallback warnings on cold or stale caches for authenticated `openai-codex`, `google-antigravity`, and `google-gemini-cli` providers, stopped disabled cold-cache providers from deferring fallback warnings, and stopped lazy catalog loads from overwriting completed or failed discovery states ([#19017](https://github.com/can1357/oh-my-pi/pull/19017) by [@PGupta-Git](https://github.com/PGupta-Git))
- ACP clients such as Orca now show an `ask` HTML form's "Other" text box inside its radio/checkbox question instead of as a second, duplicate question ([#19028](https://github.com/can1357/oh-my-pi/issues/19028))
- Fixed background jobs (`&`), subshells and command substitutions in the `bash` tool seeing changes the parent shell made after they started; they now keep the variables, positional parameters (`$1`, `$@`), functions, aliases and shell options they started with, as in bash ([#19072](https://github.com/can1357/oh-my-pi/pull/19072) by [@H4vC](https://github.com/H4vC); reported in [#18990](https://github.com/can1357/oh-my-pi/pull/18990) by [@alphastorm](https://github.com/alphastorm))
- MCP tools returning lists or strings no longer repeat their payload in the model's context when the server also sends SDK-wrapped structured content ([#18894](https://github.com/can1357/oh-my-pi/issues/18894), [#18920](https://github.com/can1357/oh-my-pi/pull/18920) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- In Chromium browser tabs, `page.evaluate`, `evaluateHandle`, `$eval`, `$eval` and `waitForFunction` inside `tab.run` now see the page's own globals and custom elements, as `tab.evaluate` does, instead of `null` or `undefined`; waits support concise methods, poll at page-side intervals, reject invalid polling options, preserve abort reasons and stop polling on cancellation, disposing late results ([#18751](https://github.com/can1357/oh-my-pi/pull/18751) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `omp bench --account`, `omp dry-balance --bench`, and security scans pinned to one OAuth account sending the raw access token to providers whose API key is a structured credential (GitHub Copilot, Gemini CLI, Antigravity, Snowflake); they now send the same key normal requests do ([#19030](https://github.com/can1357/oh-my-pi/pull/19030) by [@Xytronix](https://github.com/Xytronix))
- A hashline `PUT` whose body repeats the line just outside its range and otherwise leaves the range unchanged now adds that copy, instead of silently doing nothing while reporting an auto-repaired boundary echo ([#18234](https://github.com/can1357/oh-my-pi/pull/18234) by [@eggpeat](https://github.com/eggpeat))
- `omp --help` lists the tool names `--tools` accepts, grouped into enabled-by-default and optional; browser and computer use are documented as `eval` features ([#19064](https://github.com/can1357/oh-my-pi/pull/19064) by [@nibblebot](https://github.com/nibblebot))
- Added Liquid AI judges (`liquid/d1.1`, `liquid/d1-ultra`) for the `judge` role; images are resized to fit Liquid's per-request patch budget ([#18076](https://github.com/can1357/oh-my-pi/issues/18076), [#18100](https://github.com/can1357/oh-my-pi/pull/18100) by [@SuperUserA](https://github.com/SuperUserA))
- Added Nace Drex judges (`nace/drex-max-v1.1`, `nace/drex-max-finance`, `nace/drex-v2.0`) for the `judge` role, including Drex Max image judgments ([#18950](https://github.com/can1357/oh-my-pi/pull/18950) by [@alphastorm](https://github.com/alphastorm))
- Added the `find.hitThreshold` setting (above 0, up to 1; unset keeps 0.2): the probability a verified passage needs before `find` and `omp find` report its file or list its range, so a judge other than TypeSafe Jev can run at the cutoff that fits its calibration ([#18963](https://github.com/can1357/oh-my-pi/pull/18963) by [@alphastorm](https://github.com/alphastorm))
- GitHub Actions watches now show per-step progress, states, and durations, with Ctrl+O expansion and native Tern Surface Protocol views ([#18945](https://github.com/can1357/oh-my-pi/pull/18945) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Computer instructions now describe macOS `StaleRef` refusals for relabelled controls, including the new ref and the weaker role-and-label recovery candidate from a partial window read ([#18892](https://github.com/can1357/oh-my-pi/pull/18892) by [@will-bogusz](https://github.com/will-bogusz))
- Computer-use guidance tells the agent to reread the window after `UserIntervened` on X11 as well as macOS, without undoing or replaying over the user's input ([#18784](https://github.com/can1357/oh-my-pi/pull/18784) by [@will-bogusz](https://github.com/will-bogusz))
- Computer raise refusals say that on X11 a covered window's screenshot needs a compositing manager, instead of promising one plain X11 cannot supply ([#18783](https://github.com/can1357/oh-my-pi/pull/18783) by [@will-bogusz](https://github.com/will-bogusz))
- The `computer` tool's takeover `type` on Windows no longer loses the end of the text in apps that read keys slowly, such as Chrome, while reporting success, and says in its output when the text was sent but the app was not seen reading it ([#19037](https://github.com/can1357/oh-my-pi/pull/19037) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `wait` returning "Nothing to wait for" after a directly messaged agent sent an `agent://all` broadcast before replying, instead of blocking for its direct reply ([#18976](https://github.com/can1357/oh-my-pi/pull/18976) by [@alphastorm](https://github.com/alphastorm))
- Fixed the TUI marking pending or in-progress todos completed when a subagent with a matching or similar description finishes; matching todos still highlight while the subagent runs and are marked completed only through `todo` or `/todo` ([#18975](https://github.com/can1357/oh-my-pi/pull/18975) by [@alphastorm](https://github.com/alphastorm))
- Fixed worker-thread subagents logging `Failed to bind extension … <inline-0>` on every spawn and subagents reporting themselves to Warp as separate sessions; an SDK inline extension that worker threads cannot load now logs one warning naming it ([#18980](https://github.com/can1357/oh-my-pi/pull/18980) by [@alphastorm](https://github.com/alphastorm))
- Fixed the shell's `ls` builtin so non-numeric `-T`/`--tabsize` values (such as `ls -laT dir`, which previously listed the working directory) and overflowing `-w`/`--width` values with trailing non-digits now fail with exit 2 ([#18985](https://github.com/can1357/oh-my-pi/pull/18985) by [@alphastorm](https://github.com/alphastorm))
- Fixed `read` JSON queries (`archive.tar:member.json?q=.x`) on text archive members failing with `not found inside archive` while preserving literal `?` member names and member or query-output line selectors ([#18970](https://github.com/can1357/oh-my-pi/pull/18970) by [@alphastorm](https://github.com/alphastorm))
- Fixed `write` LSP diagnostics warning that a `#!` script is not executable (such as Ruff `EXE001`) on calls that mark the file executable (`chmod +x`) ([#18978](https://github.com/can1357/oh-my-pi/pull/18978) by [@alphastorm](https://github.com/alphastorm))
- Fixed `read xd://<tool>` and `write xd://<tool>` for unambiguous wire aliases of enabled tools (such as `xd://apply_patch` when `edit` uses `apply_patch` mode) so they return tool docs, run with the tool's approval tier, and no longer fail with `No such tool` ([#18977](https://github.com/can1357/oh-my-pi/pull/18977) by [@alphastorm](https://github.com/alphastorm))
- Fixed `yield` rejecting a JSON-string `data` payload with `expected object, received string` when the decoded value fails the output schema; it now reports the decoded field violations ([#18971](https://github.com/can1357/oh-my-pi/pull/18971) by [@alphastorm](https://github.com/alphastorm))
- Fixed `github` `run_watch` marking failed-job logs unavailable when they contain ANSI or other terminal escape sequences, returning plain-text logs on both current and older GitHub CLI (`gh`) releases ([#18968](https://github.com/can1357/oh-my-pi/pull/18968) by [@alphastorm](https://github.com/alphastorm))
- Fixed `edit` results after `lsp.formatOnWrite` (or an editor's format-on-save) reformatted the file showing the lines as sent under the formatted file's `[path#TAG]`; the result now shows the written lines and no longer blames the editor ([#18998](https://github.com/can1357/oh-my-pi/issues/18998))
- Fixed prewalk handing off to the cheaper model on exec-tier `xd://` device calls (test runners, remote commands, extension devices) and on `proc://` service stdin or mode writes, before any file was changed ([#19002](https://github.com/can1357/oh-my-pi/issues/19002))
- TypeScript 7 (`typescript-native`) no longer runs its own file watcher: omp watches the files it registers and reports changes, including ones made outside omp, so on Linux it sees edits from other tools instead of keeping stale diagnostics, and on network drives such as ovnfs checkouts its watcher no longer loops, keeping the drive's file server busy and stalling every checkout on it. Other servers opt in with the `watchFiles` server setting ([#18964](https://github.com/can1357/oh-my-pi/pull/18964) by [@H4vC](https://github.com/H4vC))
- Folders moved into a watched project now report their files to language servers, and folders moved out or renamed report their deletion, so servers no longer keep stale or missing files after `mv` or a package install
- Language servers that watch files through omp no longer get changes under `node_modules` packages or `.git` object stores unless they asked for those directories, matching VS Code's default watcher excludes
- On Linux, a project too large for inotify's watch limit is watched one directory at a time instead of losing all file watching, and on network drives a lagging server clock no longer hides changes found after a watcher overflow
- Fixed the `grep` tool so directly named files containing NUL bytes are searched as text, directory and glob searches name skipped binary files that match instead of reporting `No matches found`, and returned match and context lines strip NUL, ANSI escape, and control characters ([#18988](https://github.com/can1357/oh-my-pi/pull/18988) by [@alphastorm](https://github.com/alphastorm))
- Added the `encourageEdits` setting (default on), which makes the system prompt require the `edit` tool and forbid sed/perl/python file edits; turn it off to drop that guidance.
- A browser call from Eval that sets no timeout of its own, such as `tab.evaluate(…)` or `tab.run(fn)`, now runs as long as the Eval cell's `timeout` instead of failing at 30 seconds, and a call that runs out of time says what happened to the tab and how to give it longer ([#18737](https://github.com/can1357/oh-my-pi/pull/18737) by [@will-bogusz](https://github.com/will-bogusz))
- Cancelling a browser call now releases an unresponsive worker after its cancellation grace instead of waiting for the full call budget, and recovery after a timeout has its own bounded startup budget ([#18737](https://github.com/can1357/oh-my-pi/pull/18737) by [@will-bogusz](https://github.com/will-bogusz))
- Cmux browser helpers now use the active browser call's remaining time instead of cutting long evaluations off at the socket's 30-second default or giving late helpers a fresh full timeout; cancelling discards queued helpers and interrupts active socket requests so later calls can proceed ([#18737](https://github.com/can1357/oh-my-pi/pull/18737) by [@will-bogusz](https://github.com/will-bogusz))
- MCP tools called through `write` to `xd://` devices now honor their device names in `model.toolCallLoopGuard.exemptTools`, in both the main agent and advisor ([#18860](https://github.com/can1357/oh-my-pi/issues/18860))
- `computer.close()` no longer disables desktop control for the rest of the session: the next `computer` call opens a fresh desktop session instead of failing with `Computer session is closed`
- An extension provider with an `oauth.modifyModels` hook no longer loads the whole model catalog at registration while that provider has no login ([#18821](https://github.com/can1357/oh-my-pi/pull/18821) by [@iliaal](https://github.com/iliaal))
- Saving each session entry no longer blocks the UI for several milliseconds on Windows, where on-access scanning delayed the two re-opens of the session file that every write performed ([#18819](https://github.com/can1357/oh-my-pi/pull/18819))
- A `retry.fallbackChains` model key written with a dotted revision (`anthropic/claude-sonnet-5.5`) now applies to the model it names ([#18951](https://github.com/can1357/oh-my-pi/pull/18951) by [@wolfiesch](https://github.com/wolfiesch))
- Sharpshooter consolidation no longer gets stuck retrying every minute once the memory files grow large: the output budget now fits three full files, a cut-off reply is reported as truncated instead of `must call replace_memory_files exactly once`, and failed runs back off (one interval, doubling up to 6 hours) ([#18938](https://github.com/can1357/oh-my-pi/issues/18938))
- The advisor now backs off between failed turns (doubling per failure, with jitter) and waits for a provider `Retry-After` hint, instead of retrying every second in step with other sessions ([#18957](https://github.com/can1357/oh-my-pi/pull/18957) by [@joshuaswarren](https://github.com/joshuaswarren))
- In ACP mode, an `ask` form the client fails to show (e.g. a JSON-RPC `-32602` for an unsupported field) now returns the client's error to the agent instead of reporting `Ask tool was cancelled by the user` and aborting the turn ([#18887](https://github.com/can1357/oh-my-pi/issues/18887))
- `omp update` runs mise, Homebrew, bun, and npm on the terminal's own output, so their progress bars redraw in place instead of printing every frame as a new line ([#18874](https://github.com/can1357/oh-my-pi/pull/18874) by [@a-glapinski](https://github.com/a-glapinski))
- Fixed Anthropic prompt caching freezing for the rest of a turn when a `context` extension rewrites messages the same way on every request (for example a stable tag prefix on each message): every rewritten message was marked per-call, so the rolling breakpoint could not land on anything the tool loop appended and each step re-billed the whole tail as uncached input. A rewritten message is now per-call only once its bytes differ from the previous request; streamed assistant messages are no longer marked per-call just because `structuredClone` dropped their streaming symbols ([#12392](https://github.com/can1357/oh-my-pi/issues/12392), [#18869](https://github.com/can1357/oh-my-pi/pull/18869) by [@tsankotsanev](https://github.com/tsankotsanev))
- Fixed the `ts-import-type` rule missing inline type imports whose member name is non-ASCII, such as `import("./units").温度` ([#16242](https://github.com/can1357/oh-my-pi/pull/16242))

Older entries are archived in [packages/coding-agent/CHANGELOG.md@98457bf8eab0](https://github.com/can1357/oh-my-pi/blob/98457bf8eab0e58e6e523e7ffea11f0635b8ed78/packages/coding-agent/CHANGELOG.md).
- Deleting or moving large directory trees inside a project no longer stalls language-server file watching ([#19490](https://github.com/can1357/oh-my-pi/pull/19490) by [@H4vC](https://github.com/H4vC)).
- Reduced CPU and memory usage for long-running subagents as their sessions grow ([#19486](https://github.com/can1357/oh-my-pi/pull/19486) by [@H4vC](https://github.com/H4vC)).
- Fixed `commit.draft()` incorrectly classifying files deleted or renamed through bash or eval as “Not yours”; they now appear under Review.
- Fixed status indicators incorrectly showing the agent as idle while subagents or background work could still resume the run.
- Fixed subagents and security scans completing while child agents were still running or queued peer messages remained.
- Fixed conflict-region resolution when a selected side is empty or shares edge lines with surrounding code.
- MCP stdio server failures before a response now report the process exit code or terminating signal instead of only reporting closed stdout.
- Fixed prewalk handoffs so model and reasoning-effort changes are preserved, and automatic handoffs return to the planning model when automatic prewalk is changed or disabled.
- Fixed `ida` `exec` output on IDA 9.5+ by suppressing helper deprecation warnings and preserving the updated function metadata API.
- Expired Perplexity logins and cookies no longer return an error page as a search answer; the provider is reported as expired and the search chain continues.
- Fixed browser WebMCP discovery and invocation on Chrome and Chromium 157 and later.
- Private hosts written with a trailing dot are now correctly handled by Ask and `always-ask-cached` before file tools access them.
- Fixed the TUI freezing when switching sessions from an open tool-approval prompt.
- Fixed `/commit` and eval `commit` dropping UTF-8 BOMs or mishandling quoted and Unicode filenames during change tracking and selective commits.
- Fixed misleading Wayland clipboard warnings when pasting an image or when the clipboard is empty.
- Fixed JavaScript evaluation after an in-place Linux upgrade by keeping session workers tied to the session's build.
- Deleting a session that cannot be removed no longer deletes its prompt history and statistics.
- Fixed `read` and `write` handling of line selectors on `xd://` device URLs.
- Fixed `eval wait()` rejecting or mishandling numeric delays; browser waits now direct users to the appropriate wait helpers.
- Fixed browser timeout and busy-page errors to include the current URL, affected tab, and actionable recovery guidance.
- Fixed Mnemopi embedding failures being silently downgraded to keyword search; provider errors now produce a warning, including in print mode on stderr.
- `/loop` now pauses after a provider error such as a rate limit instead of resubmitting the same prompt and attaching its `@file` mentions again ([#19272](https://github.com/can1357/oh-my-pi/issues/19272)).
- Resuming a session whose directory was deleted now continues in the current directory with a warning instead of failing.
- Model mentions and `/switch` completions now recover discovered models after provider discovery fails at startup, retrying discovery when needed.
- Background job results that arrive after an ACP prompt ends are now carried into the next prompt instead of starting an invisible turn.
- OpenAI server compaction failures now proceed to the next available compaction method instead of retrying server compaction on another model.
- Language servers now recognize edits made shortly after a file is created, including on macOS.
- Bash commands displayed in the Pseudo shell view now remain accurate while streaming through heredocs, substitutions, loops, continuations, arithmetic expressions, and background execution.
- Resuming a session or reviving a subagent after a retry fallback with a thinking suffix (e.g. `:xhigh`) now restores the primary model's own thinking level instead of keeping the fallback's ([#19273](https://github.com/can1357/oh-my-pi/issues/19273)).
- i18n: zh catalog no longer carries OMP self-references; `/security` descriptions use the clean Zeta keys.
- Idle compaction now starts or reschedules when its enabled state, threshold, or delay changes while a session is already idle ([#10242](https://github.com/can1357/oh-my-pi/issues/10242)).
- 修复 `/language` 与 `/tracking` 指令在 OMP v18.0.3 合并后未注册的问题（输入被当作普通消息；现已恢复注册并加合并护栏测试）。
- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).
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

- Removed `task.file` and the task tool's `taskFile` field; subagent instructions are always inline
- Todo tasks can no longer be blocked: the `blocked` status and `blocker` note are gone from the `todo` tool, `/todo edit` (`[!]` is now an unknown marker), the HUD, ACP plans, goal continuation (which no longer pauses on a blocked-only list) and the RPC `TodoStatus`/`TodoItem` wire types and SDKs (Go, Python, Rust). A saved todo list that still holds a blocked task reads back with it pending on resume
- Removed the legacy standalone disassembler tools and their associated prompt instructions.

### Known limitations

- **No Android native app or Tier 1 mobile client ships in 1.5.1.** Remote access is the mobile browser UI plus the Work Studio browser edition; the planned thin WebView shell (roadmap, deferred) is not built, and no APK/AAB or mobile app store package exists.
- **Chat → PM / `agentId` binding is not shipped.** IM chat bindings map a chat to a workspace alias or a bot session only; the `agentId`/PM column is marked unimplemented and the settings pane never writes that key.
- **2FA secret protection is filesystem-only.** `<agentDir>/auth/totp.json` is mode `0600`; there is no OS keychain/TPM integration and no WebAuthn/passkey second factor. 2FA defends against a stolen device or machine token, not against a compromised local account.
- **Remote Work Studio token injection is still incomplete.** Opening Work Studio from a remote workspace does not yet inject the device token end to end; the operator still carries the pairing token through the URL fragment/localStorage flow, and the browser edition hands the URL to the system browser without provisioning credentials.

## [1.5.2] - 2026-11-13

### Changed

- Released as part of Zeta 1.5.2 asset review; no package-specific user-visible changes.

## [1.5.1] - 2026-11-10

### Added

- **Work Studio browser terminal** — the Studio UI runs a real terminal in the browser over the gateway PTY (xterm.js), with selectable and creatable shell profiles (shell, arguments, working directory, environment), live PTY resize, a session list that survives navigation, and reconnect/replay instead of a dead pane. Terminal profiles are validated server-side; a profile cannot escape the workspace roots ([#282](https://github.com/Linxira-OS/linxira-zeta/pull/282)).

### Changed

- **Large-session replay is windowed** — resuming a multi-thousand-entry transcript hydrates a bounded window instead of materialising the whole session before the first frame, so long sessions open promptly and the remainder pages in on scroll ([#284](https://github.com/Linxira-OS/linxira-zeta/pull/284)).
- **Startup is lighter** — plugin registries (Claude Code, agent, Zeta) resolve their ancestor walk and project/cwd realpaths once per project instead of once per capability surface, removing repeated filesystem work from skill and slash-command discovery.
- **QQ bridges are bring-your-own** — Zeta bundles, downloads and installs no QQ bridge. NapCat, LLOneBot and SnowLuma are documented as user-run processes; SnowLuma is experimental and points at its community mirror. Their licences and any account risk stay with the user.

### Fixed

- A `task` batch no longer repaints its transcript card once per spawn progress tick: spawn updates are coalesced to at most one cumulative snapshot per 100 ms (the same cadence as the subagent HUD), so fan-out no longer turns every spawn's 150 ms report into its own full-card rebuild and deep sanitize on the TUI thread. Terminal spawn snapshots still publish immediately, and the tool's final result is unchanged.
- `/channels` is refused on a backend-attached client instead of racing the owning process for the channel pairing lock.
- Channel help, `/channels` descriptions and Studio IM strings are backed by the i18n catalogue, and the CLI help inventory is re-pinned for the Discord/QQ flags.
- Work Studio keeps IM binding row keys out of DOM attributes, and the QR route returns an additive SVG field the pane can consume.

## [1.5.0] - 2026-11-09

### Added

- **Zeta Team foundation** — `zetacode team` creates and manages an ownerless Team root (`<root>/.zeta/team.json`; no Agent, `AGENTS.md`, Git repository, or Team-root session), PM workspaces (`pms/<pm>/`), canonical base repositories (`repos/<repo>/`, or registered in place with `repo link`), PM↔repo bindings, engineers, and real linked Git worktrees (`home` and per-task) under `worktrees/<repo>/<pm>/<engineer>/`. One SQLite database (`~/.zeta/data/zeta.db`, `ZETA_TEAM_DB` override) records teams, PMs, repos, bindings, engineers, worktrees, rooms and agents, and `team doctor` reports drift between the markers on disk and the database.
- **Team Hub** — launching at the Team root or a PM workspace opens a database-backed Hub of rooms, PMs and engineers (rooms show kind, owner, member count and latest `seq`; engineers show their recorded execution mode and worktrees), with `r` reload, `s` post as a real member, `/` filter, and no session, transcript, or fabricated agent behind it.
- **Team rooms** — PM, shared coordination, and custom rooms are database rows only (`rooms`, `room_members`, append-only `room_events`) with host-assigned monotonic `seq`, `@mentions`, reply links, and `room_read`/`room_post`; a room post never enters session JSONL.
- **Team session origin and resume grouping** — sessions created under a Team location carry `origin: { kind: "team", teamId, pmId, engineerId, repoId, roomId, workspaceAlias }`; the resume picker/list APIs hide Team rows from personal scopes by default, and a Team scope groups them Team → PM → engineer → repo → conversation.
- **Lead (PM) mode** — `/lead` (alias `/pm`) runs the PM main agent in a registered PM workspace with a coordination-only toolset (`read`, optional parent-owned `todo`, `room_read`/`room_post`, `secretary`, plus configured `channel_send`/`board`/`calendar`); it refuses worktrees, base repositories and the Team root, is mutually exclusive with plan/goal/vibe, and restores the exact prior toolset on exit.
- **PM Secretary** — one persistent keep-alive subagent per PM, created idempotently by Lead mode's `secretary spawn` and continued with `secretary send`; the Team database owns its row and resumable transcript, and its profile is limited to `read`, `todo`, `calendar`, `board` and read-only `room_read`.

### Changed

- Synced with upstream OMP **v18.18.1, v18.18.2 and v18.18.3** (baseline v18.18.3), bringing the shell `sd` builtin, forked session shells for overlapping bash calls, and the Cursor, compaction and session fixes from those tags.
- `ask` now takes one HTML `<form>` (`{ html }`) instead of a `questions[]` array: radios, checkboxes, selects, text inputs and textareas with the recommendation preselected, pictures (`<img>` from an http(s) URL, a `data:` URI or a local file, and inline SVG), free-text "Other" answers, extension `ui.formDialog`, ACP form elicitation, and partial submission on inactivity timeout; results return a unified `answers` object.

### Fixed

- Resume picker: rows pre-loaded from the title index now carry their session's recorded cwd, so a conversation stays under its own project and workspace instead of moving to whichever directory the picker was opened from ([#274](https://github.com/Linxira-OS/linxira-zeta/pull/274))
- The stats dashboard follows the host CLI/desktop language and uses language-independent compact units (`K`/`M`/`B`) with locale dates, so switching to English leaves no Chinese labels behind ([#275](https://github.com/Linxira-OS/linxira-zeta/pull/275))
- IM project routing: bot sessions can be bound to a repository (`!session new <name> project:<alias>`, `!session project <alias>`), run in that repo's cwd, and route inbound messages by their project instead of the global default workspace; a chat's selected session supersedes a stale direct binding
- Tool-call isolation: `workspace_run` only accepts registered workspaces and a project-bound session cannot delegate into another repo (the relay coordinator keeps its cross-repo role); `channel_send` enforces `channels.allowedPeers`; `workspace_run`/`channel_send` reports and defaults follow the invoking session's chat
- A workspace that fails to open now answers with an explicit error instead of silently falling back to the default-workspace coordinator, and fresh bot transcripts record their project as cwd rather than the process cwd
- `im_control` gained `project=` for `new_session` and a `bind_project` operation, and its session listing shows each session's project
- Base system prompt refresh only re-applies on byte-level changes, keeping the inherited provider prompt-cache key stable across explicit refreshes.

### Removed

- Dropped unused Team DB accessors and stale export metadata.
- Removed Codex Code Mode and its `providers.openai-codex.codeMode` / `providers.openai-codex.codeModeDirectTools` settings; Codex models always use the full direct tool surface.

## [1.4.13] - 2026-11-08

### Added

- Work Studio's in-process host now answers the operations its surfaces call but the host left unadvertised: `operator.invoke` (builtin slash commands through the gateway's own dispatch, with the command's real output lines), `tokens.count` (every embedded offline tokenizer), `session.resume`, `workspace.open`, `workspace.file.create`, `artifacts.saveText` (raw request bytes, so the stored text is the text), `runtime.ensure` and the diagnostics page's `diagnostics.get`, plus the task-agent inventory `agents.definitions.get`. The bridge gained multipart and raw-body modes, which is what the two write operations needed.

## [1.4.12] - 2026-11-08

- Synced with upstream OMP v18.18.0.

### Added

- Work Studio ships as a desktop application again, in two editions built from one staged runtime (compiled kernel + native addons + `web-app`): an Electron edition (bundled Chromium; Windows NSIS/zip, Linux AppImage/deb/tar.gz) and a browser edition with no bundled engine whose launcher starts `serve` and opens the default browser. Both carry the same `zeta` kernel, so the desktop shell no longer depends on the frozen `web-ui`; it points `serve` at the bundled `web-app` through `ZETA_WEB_APP_DIR`. `serve`/`web` help text and the desktop menu now say Work Studio.
- Automatic session titles now start when the agent's reply begins rather than when you submit, so a slow-thinking first reply gets a card title (icon and code) instead of a plain fallback title.
- `read file.jsonl?q=…` keeps the other lines' results when a line before the last fails and shows jq's error ahead of them, instead of failing the read; anything else the query wrote to stderr, such as `debug` output, now leads the result too ([#14659](https://github.com/can1357/oh-my-pi/pull/14659) by [@will-bogusz](https://github.com/will-bogusz))
- Title card icons now picture each session's specific subject instead of a generic bug, flask, speedometer, gear, or terminal, or the project's language logo, so sessions in the same project are easier to tell apart.
- Agents whose tool list omits `write` but still get it to run `xd://` tools can now also write `local://` files (reports, notes) outside plan mode; working-tree writes stay blocked.
- Added `worktree.onStart` and `worktree.onExit` settings to start each session in its own worktree and clean it up on exit ([#14908](https://github.com/can1357/oh-my-pi/pull/14908) by [@gitpushoriginmaster](https://github.com/gitpushoriginmaster))
- Added `speech.speed` and `tts.localSpeed` settings (0.5–2.5, default 1) to speed up or slow down local Kokoro speech for live vocalization and the `tts` tool / `omp say`, plus an `omp say --speed` flag; ACP voice clients find both settings and their presets in `speech.models.list` ([#5868](https://github.com/can1357/oh-my-pi/issues/5868))
- `omp update` and the startup update notice leave an omp installed by another app (Tern) to that app instead of replacing its files.
- The startup update notice no longer appears when omp runs from a source checkout.
- Added per-model auto-compaction points: the `/models` preview shows where each model compacts, and in the Roles view `k` (or the **Compaction limit** button) sets it for the selected role's or fallback's model (`90000`, `90k`, `1M`, `80%`; empty resets). Also configurable as `compaction.modelThresholds` with `provider/model-id` or `provider/*` keys ([#14952](https://github.com/can1357/oh-my-pi/pull/14952) by [@H4vC](https://github.com/H4vC))
- Write-tool previews now render as files stream: SVG files appear as images, and Mermaid files (`.mmd` and `.mermaid`) appear as diagrams. Tern also previews supported 3D model formats (`.obj`, `.ply`, `.wrl`, `.x3dv`, `.stl`, `.gltf`, and `.usda`) and renders SVG writes as SVG figures.
- Added the `title.icons` setting to show session title cards with a Nerd Font glyph and emoji fallback (`nf+emoji`, default), always the emoji (`emoji`), or as plain titles (`boring`).
- Plugins may declare native GUI panels in their manifest (`ui.panels[]`: `list`, `form`, `chart`, `html`); `zetacode plugins panel <plugin> <panel> --json` feeds the desktop shell, and HTML panels are served through `/plugins/view/…`
- A user board lives in `.zeta/board/` (markdown with front matter) with gateway endpoints under `/api/board*`, a GUI right-column tab and a TUI pane
- Remote access: `zetacode serve` gained `--host`, `--tls`, `--tls-cert`, `--tls-key` and `--allow-plain-http` (plain HTTP off-loopback is refused), a pairing QR, and SHA-256-hashed tokens that can be rotated and revoked; failed auth is limited to 10 attempts per 60 s per address
- Settings are scoped per session working directory: `Settings.sessionForCwd(cwd)` keeps the project layer with its own repo, live sessions reload after a write, and `GET /api/settings` accepts `x-zeta-cwd`
- `channels.reportPolicy` decides whether a channel session reports into its IM thread
- A `/models` compaction limit set past a model's standard context window now runs that model on its extended window instead of being silently clamped; the hub warns (noting long-context pricing) and saves on a second Enter, in the terminal and in Tern, and rejects limits past the model's largest window ([#15048](https://github.com/can1357/oh-my-pi/pull/15048) by [@H4vC](https://github.com/H4vC))
- A token compaction limit set in `/models` (or `compaction.modelThresholds`) is now the base omp scales with its usual policy, as if it were the model's window (85% of it by default for bases above ~109k, or `compaction.thresholdPercent` of it), instead of the exact point. Plain numbers saved since 18.8.5 therefore compact earlier; rewrite one as `"f<tokens>"` (or type `f400k` in the hub) to keep it an exact trigger. The `/models` limit field shows where the model would compact as you type (`compacts at 340K · 85% of 400K base`), the preview's **Compacts at** row says why, and the saved message repeats it ([#15065](https://github.com/can1357/oh-my-pi/pull/15065) by [@H4vC](https://github.com/H4vC))
- Skills in nested router trees (up to 3 levels, e.g. `.agents/skills` router → category → leaf) are now all discoverable, and `skills.enableOfficial` actually toggles the bundled official skills.

### Fixed

- Deferred misleading cold-cache `retry.fallbackChains` warnings until provider discovery completes.
- Fixed `--prewalk-into @default` so an explicitly selected startup model does not replace the configured default role, including ordered fallbacks and discovery-backed candidates.
- A corrupted or externally modified session file no longer leaves the session impossible to close; a subsequent Ctrl+C exits without rewriting the session log.
- Fixed silent MCP requests being terminated by an undeclared idle timeout; closing a legacy SSE connection now also cancels pending requests and notifications.
- Fixed `grep` on a single file showing in Tern as separate boxed snippets with no file row or syntax colors; it now looks the same as a `grep` over a directory
- Fixed every session loading its own copy of the local mnemopi embedding model and keeping it in memory until exit; one server per model is shared across sessions and exits after 15 idle minutes ([#9908](https://github.com/can1357/oh-my-pi/issues/9908))
- Fixed the first-use mnemopi embedding-model download never completing for sessions shorter than the download; it now finishes in the shared embedding server after the session exits ([#10240](https://github.com/can1357/oh-my-pi/issues/10240))
- Fixed `RpcClient.stop()` occasionally waiting forever because the agent process was never signaled.
- Fixed blank rows opening under the input after an `ask` dialog, command report or todo list closed in a session that had filled the screen; the transcript now refills the screen ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Fixed blank rows appearing between the last paragraphs of a streamed answer when the turn ended ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
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
- Fixed compiled-binary extensions importing `@linxiraos/pi-tui` subpaths such as `terminal-capabilities`, `chat/svg-figure` or `theme/index` loading a second copy from their own `node_modules` instead of sharing the host's terminal, theme and figure state ([#15659](https://github.com/can1357/oh-my-pi/issues/15659))
- Fixed marketplace plugins that keep their version in `.claude-plugin/plugin.json` never being reported by `omp plugin upgrade` or auto-updated; for plugins shipped inside the marketplace, `plugin.json`'s version now also takes precedence over the catalog entry's, as in Claude Code ([#15585](https://github.com/can1357/oh-my-pi/issues/15585))
- Fixed a steer (queued user or peer message) waiting behind a `bash` service's readiness wait (`name` + `ready`) for up to `ready.timeout`; the call now returns early with the service still starting, inspectable via `proc://<name>` ([#15653](https://github.com/can1357/oh-my-pi/issues/15653))
- Fixed `omp install`/`omp plugin install`, `upgrade`, `uninstall` and `doctor --fix` failing with `Executable not found in $PATH: "bun"` for npm and Git plugins on machines without Bun installed, such as standalone-binary installs ([#15480](https://github.com/can1357/oh-my-pi/issues/15480))
- Fixed `/plugins enable` and `/plugins disable` in the TUI not refreshing skills, commands, task agents and MCP servers until a reload, and rejecting npm plugins ([#15383](https://github.com/can1357/oh-my-pi/issues/15383))
- Fixed local memory injection and `learn` using the `Settings` directory instead of the session's project directory, so SDK hosts sharing one `Settings` across projects injected another project's lessons and never the project's consolidated summary; sharpshooter memory follows the session directory too ([#15375](https://github.com/can1357/oh-my-pi/issues/15375))
- Fixed ACP bash approvals ignoring `bash.patterns`, and an earlier "Always allow" letting critical commands such as `rm -rf /` run without a prompt ([#15473](https://github.com/can1357/oh-my-pi/issues/15473))
- Fixed hashline edits silently dropping the tail of a line that `read` or `grep` had cut at the column limit; such an edit is now refused until a `:raw` read shows the full line ([#15649](https://github.com/can1357/oh-my-pi/issues/15649))
- Fixed isolated tasks failing on linked worktrees with initialized recursive submodules and leaving updated submodule pins unreachable after cleanup ([#15457](https://github.com/can1357/oh-my-pi/issues/15457))
- Fixed `/tan` missing the parent's prompt cache by advertising `xd://` tools top-level and omitting `ask` ([#15578](https://github.com/can1357/oh-my-pi/issues/15578)).

## [1.4.10] - 2026-11-05

### Added

- Added a workspace-scoped OpenDesign bridge: `/design status|enable|disable` and a single `design` tool that wraps the OpenDesign MCP project/artifact/run surface and the allowlisted `od` CLI. It is off unless `.zeta/design.yml` enables it; no global MCP server or CLI registration is written.

### Changed

- Legacy OMP model and dotenv imports are now opt-in with `ZETA_OMP_COMPAT=1`. By default Zeta does not read `~/.omp/agent/models.yml`, `agent.db`, or `.env`; the explicit `copy-from-omp` import endpoint remains available.
- Explicit `copy-from-omp` remains a one-click import and no longer depends on ambient OMP compatibility being enabled.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@6eb3ab5f5890](https://github.com/can1357/oh-my-pi/blob/6eb3ab5f58900774fb767318f88de7c0fd94c691/packages/coding-agent/CHANGELOG.md).
### Fixed

- `/usage`, session statistics, and `omp stats` now include session title spend from both the default fork title and the tiny title model, and tiny-model titles count toward `--max-cost` ([#18177](https://github.com/can1357/oh-my-pi/issues/18177), [#18491](https://github.com/can1357/oh-my-pi/pull/18491) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Retries after `--model pi/<role>` (or `@<role>`, `<role>`) now walk that role's `retry.fallbackChains` entry instead of the `default` chain, including on `--continue` ([#18389](https://github.com/can1357/oh-my-pi/issues/18389), [#18534](https://github.com/can1357/oh-my-pi/pull/18534) by [@harshaygadekar](https://github.com/harshaygadekar))
- Fixed a `->` / `=>` list sent to an idle session running its second item before its first; if the first item can't start (Esc, a refused or failed setup), the whole list goes back to the editor ([#10802](https://github.com/can1357/oh-my-pi/issues/10802))
- Fixed auto-compaction repeating every turn when the system prompt and tool schemas alone exceed the compaction budget; it now warns once instead ([#18589](https://github.com/can1357/oh-my-pi/issues/18589)).
- Fixed a blank per-call `model` (`""` or whitespace) failing the gate for task calls, eval `agent()` and eval `workpool()` instead of using the agent's configured model ([#18576](https://github.com/can1357/oh-my-pi/pull/18576) by [@iwangjie](https://github.com/iwangjie))
- `task` tool calls with an empty model string or empty model array now use the agent's normal model routing ([#18554](https://github.com/can1357/oh-my-pi/pull/18554) by [@xiangnan0811](https://github.com/xiangnan0811))
- Fixed `todo append` without a phase failing instead of adding tasks to the active phase, the last phase, or a new `Tasks` phase ([#17265](https://github.com/can1357/oh-my-pi/issues/17265), [#18575](https://github.com/can1357/oh-my-pi/pull/18575) by [@taotao7](https://github.com/taotao7)).
- Learned-only memory guidance no longer tells the model to read a missing `memory_summary.md` ([#18523](https://github.com/can1357/oh-my-pi/pull/18523) by [@nick-maderight](https://github.com/nick-maderight)).
- A `wait` that times out now says how long it waited and how long a back-to-back wait allows, instead of returning a bare still-running snapshot that agents read as an empty result, and the back-to-back reminder tells agents not to start `sleep` jobs to wait longer ([#18612](https://github.com/can1357/oh-my-pi/pull/18612) by [@alphastorm](https://github.com/alphastorm)).
- `auth-gateway stdio` now follows a role's configured fallback chain even when `modelRoles` does not set the role (a chat role without its own chain inherits the `default` chain) ([#18509](https://github.com/can1357/oh-my-pi/pull/18509) by [@enieuwy](https://github.com/enieuwy))
- In the Pseudo shell visualization, a `;`-separated chain no longer draws its statement separators as rows of their own, so `echo a; echo b` reads as two statements ([#18258](https://github.com/can1357/oh-my-pi/issues/18258), [#18497](https://github.com/can1357/oh-my-pi/pull/18497) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Autoresearch `update_notes` with `append_idea` now creates an `## Ideas` section instead of inserting the bullet before the first heading when notes contain only a similarly named heading such as `## Ideas backlog` or `### Ideas` ([#18505](https://github.com/can1357/oh-my-pi/pull/18505) by [@eggpeat](https://github.com/eggpeat))
- Exclusive tools (`edit`, `write`, `eval`, …) called as Cursor MCP tools now keep their place in the tool batch, so a check sent right after an edit sees the new file and an edit no longer starts before an earlier read finishes ([#18502](https://github.com/can1357/oh-my-pi/pull/18502) by [@eggpeat](https://github.com/eggpeat))
- Quarantined Hindsight memories are now deleted once their 30-day review period ends even when no new memory is quarantined ([#18504](https://github.com/can1357/oh-my-pi/pull/18504) by [@eggpeat](https://github.com/eggpeat))
- The compaction display summary no longer requests reasoning, so thinking models return a summary instead of spending the 512-token cap on reasoning and returning nothing ([#18541](https://github.com/can1357/oh-my-pi/pull/18541) by [@phillipxkang](https://github.com/phillipxkang))
- Retries on the same model now stop after three consecutive generic aborts instead of spending the whole retry budget ([#18535](https://github.com/can1357/oh-my-pi/pull/18535) by [@nick-maderight](https://github.com/nick-maderight))
- `lsp.formatOnWrite` no longer re-indents 2/4-space files at 1 space per level when they contain JSDoc/block comments or one-off odd indents, and no longer converts tab-indented files that open with a JSDoc block to spaces ([#18544](https://github.com/can1357/oh-my-pi/issues/18544))
- Isolated task sandboxes now finish cleanup after a SIGHUP or other signal even when releasing them takes longer than the agent shutdown grace period ([#18519](https://github.com/can1357/oh-my-pi/issues/18519)).

## [18.18.3] - 2026-11-09

### Breaking Changes

- The `ask` tool takes one HTML form (`{ html }`) instead of `questions[]`: the model writes a `<form>` of radios, checkboxes, selects, text inputs and textareas with its recommendation preselected, and receives the submitted form data as JSON. `AskToolDetails` is now `{ answers: { name, question, answer }[]; timedOut? }`; `QuestionResult`, the "Other", "Chat about this", answer-note and answer-image paths of the tool are removed, and `/tree` re-answer reopens the original form (`NavigateTreeResult.reopenAsk` carries `html`).

### Added

- In Tern, right-clicking an `ask` answer offers Note, which annotates that answer without picking it ([#18551](https://github.com/can1357/oh-my-pi/pull/18551) by [@H4vC](https://github.com/H4vC))
- `task.eager` (`preferred`/`always`) now shapes only the main agent's system prompt; subagents fall back to their model's own delegation policy instead of being pushed to spawn further subagents
- `ask` forms can show pictures: `<img src>` from an http(s) URL, a `data:` URI or a local file (relative to the session's working directory), and inline `<svg>` diagrams, drawn in the terminal form and natively in Tern
- `ask` forms give every radio and checkbox group a free-text "Other" answer: its text is the radio's value or is appended to the checkbox group's array (field-by-field fallback, collab guests and ACP elicitation included)
- Extension UI gains optional `ui.formDialog(html, options)`, which renders an HTML `<form>` and resolves to `{ data, timedOut? }` (undefined when cancelled). The interactive TUI renders it as a form dialog, ACP clients with form elicitation get one elicitation with a property per field, and hosts without it (RPC) answer the `ask` tool field by field through `select`/`input`/`editor`.
- Eval cells can run shell commands with `sh`: `sh("git status")` in Python, `` await sh`ls ${dir}` `` or `await sh("make", { cwd })` in JavaScript. Commands run on the embedded bash engine to completion (never auto-backgrounded), return their output, and raise `ShellError` with the exit code on failure.
- `omp zsh` on Windows runs omp's builtin utilities (`ls`, `cat`, `head`, `jq`, …) for commands `PATH` does not have, unless a `command_not_found_handler` handles them ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).

### Changed

- Clarified tool and internal-URL descriptions for `history://` concise transcripts, `proc://` job retention and parked-agent lookups, and `read` JSON query text output ([#18553](https://github.com/can1357/oh-my-pi/pull/18553) by [@xiangnan0811](https://github.com/xiangnan0811))
- Models without a delegation rule (Claude, Gemini, …) no longer get pushed to delegate: the "map unknown code via task" rule and the "Task + scout" nudges in search tool descriptions are replaced by a light suggestion to explore unfamiliar subsystems with a scout
- In Tern, clicking an `ask` answer and then Note now annotates the answer highlighted on the question shown instead of the one just clicked ([#18551](https://github.com/can1357/oh-my-pi/pull/18551) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed `ask` notes added with `n` right after picking an answer landing on the previous question instead of the one shown; a Tern click then Note still notes the answer just clicked, and the Note button names it ([#18317](https://github.com/can1357/oh-my-pi/pull/18317) by [@DonMikone](https://github.com/DonMikone))
- Fixed `/export` failing on Windows when saving in the current directory, including relative paths such as `sub/../session.html`; the export message now shows the full path of the written file ([#18369](https://github.com/can1357/oh-my-pi/issues/18369), [#18525](https://github.com/can1357/oh-my-pi/pull/18525) by [@minhngoc25a](https://github.com/minhngoc25a)).
- Todo initialization now names empty phases `Tasks`, so subsequent updates can address them ([#18552](https://github.com/can1357/oh-my-pi/pull/18552) by [@xiangnan0811](https://github.com/xiangnan0811))
- `omp zsh` and the bash tool on Windows: background commands without job control ignore Ctrl-C (`INT`, and `QUIT` in zsh) as zsh and bash do, so the console's Ctrl-C leaves them running ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` finds the system zsh's function library (`compinit` loads) on Debian, Ubuntu and Arch, and on Windows from an MSYS2, Cygwin or Git for Windows zsh ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` on Windows: typed commands no longer end in `^M`, programs are found through `Path`, piped scripts run every line, `cd` takes `C:\…`/`C:/…`, `..` and `~` (keeping `$PWD` as `C:/…`), `>/dev/null` works, the prompt is `%` rather than root's `#`, `$OSTYPE` is `msys`, and no `USERNAME` warning is printed ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` on Windows edits lines with ZLE (history, Tab completion, key bindings, `$COLUMNS`); Ctrl-C abandons the line, runs an `INT` trap, or interrupts a `read` that then goes on, instead of ending the shell ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` on Windows: Ctrl-C interrupts the foreground program, `jobs`, `fg` and `bg` work (a job brought back with `fg` gets Ctrl-C too), and process substitution reaches Windows programs (`diff <(…) <(…)`, `prog >(…)`) ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- On Windows, `/dev/null` works in the bash tool (`>/dev/null`, `cat /dev/null`, `[ -c /dev/null ]`) ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- On Windows, `/dev/tty` opens the console in `omp zsh` and the bash tool (`prog >/dev/tty`), and an MSYS or Cygwin program killed by Ctrl-C reports status 130 instead of 512 ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` prints the `[n] pid` line for a background pipeline under job control, as it does for a single command ([#18532](https://github.com/can1357/oh-my-pi/pull/18532) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` starts `compinit` many times faster: single array and association elements are assigned and read without copying the whole parameter, and `autoload -r` no longer re-reads the `.zwc` digests in `$fpath` for every function it resolves ([#18533](https://github.com/can1357/oh-my-pi/pull/18533) by [@H4vC](https://github.com/H4vC)).
- `omp zsh`'s `read -k` and `read -q` read a key from the terminal without waiting for Enter, as zsh does, instead of reading standard input ([#18533](https://github.com/can1357/oh-my-pi/pull/18533) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` completion listings mark file types again (`dir/`, `exe*`), `print -c` lays words out in columns without a terminal, and `${x?msg}` ends a non-interactive shell with status 1 as zsh does ([#18533](https://github.com/can1357/oh-my-pi/pull/18533) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` floats keep full precision in arithmetic (`s=$EPOCHREALTIME; print $(( EPOCHREALTIME - s ))` no longer drifts by up to a second) and still print in their `-F`/`-E` style ([#18533](https://github.com/can1357/oh-my-pi/pull/18533) by [@H4vC](https://github.com/H4vC)).
- `omp zsh`'s `typeset -U path` / `typeset -U fpath` (and `local -U path`) drop repeated entries as zsh does ([#18533](https://github.com/can1357/oh-my-pi/pull/18533) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` and the bash tool: `$!` of a background pipeline is its last program's pid, as in bash and zsh, so `kill $!` signals that program; `omp zsh`'s `[n]` line for a background pipeline lists the pid of each of its processes, as zsh does ([#18547](https://github.com/can1357/oh-my-pi/pull/18547) by [@H4vC](https://github.com/H4vC)).
- `omp zsh` is faster: function calls, loops and arithmetic run 2–3× faster, `compinit` almost 4× faster, and building a large array or association one element at a time (`a+=(x)`, `h[k]=v`) or reading `$a[i]` from a large array no longer slows down with its size ([#18565](https://github.com/can1357/oh-my-pi/pull/18565) by [@H4vC](https://github.com/H4vC)).

## [18.18.2] - 2026-11-08

### Breaking Changes

- `logoutCredential()` now accepts an `AgentSession` instead of a model registry and session ID. Hosts must install a scoped-model refresher with `AgentSession.setScopedModelsRefresher()`; `InteractiveMode` and `InteractiveModeContext` no longer accept `refreshScopedModelsAfterLogin`.
- `SessionStorage.hasAssistantTurn()` is replaced by the optional `scanLines(path, visit)`, which session listings use to recover both a missed assistant record and a first prompt past the 4 KB head; custom storages that implemented `hasAssistantTurn()` must implement `scanLines()` instead.

### Added

- The shell's `ls` builtin supports macOS/BSD `-O`: a long listing gains the file-flags column (`hidden`, `compressed`, `uchg`, `restricted`, …) instead of rejecting the option, so `ls -lO` works and flags are visible again.
- The shell ships `sd` as a builtin, so `sd FIND REPLACE [FILES]…` find-and-replace (regex or `-F` literal, in place or `-p` preview) works without the binary installed.
- Added `omp gc --strip` (or `gc.strip`), which removes provider replay data (thinking signatures, encrypted reasoning, cached native responses, request controls) from sessions idle for `gc.stripAfterDays` (default 30, `--strip-after-days`), including subagent and archived transcripts; stripped sessions still resume on any model.

### Changed

- The `sloppy` edit tool (`*** Find`/`*** Replace`) now rejects only the operations that fail to match and applies the rest, including across files; the result lists each rejected operation against the file as written, and the call fails only when no file changes. Payloads that do not parse still apply nothing.
- A `bash` call that overlaps another one (parallel calls, or a call while one runs in the background) now runs in a copy of the session shell, so it sees the session's variables, functions, options, and working directory from before the other command; what it sets still does not persist.
- The `.`/`c` continue shortcut now interrupts a running turn and continues it, in the main session and in focused subagent views, instead of failing with "Agent is already processing" or doing nothing.
- Updated system prompts with the ⁂ section marker and improved task completion guidance, including proportional verification, efficient file reading, batching independent operations, and stopping after changes are verified.
- Added faster isolated-subagent startup for ovnfs-backed checkouts, while preserving the existing baseline behavior for repositories with nested repositories or submodules.
- Improved extension and plugin management: `/extensions` now lists and toggles extensions from configured extension packages and installed plugins, and marketplace sources resolve relative and bare-name paths consistently with Claude Code.
- Scoped model lists now refresh after logout, model-catalog refreshes, and RPC login or logout, so available models stay synchronized with authentication and provider changes.
- Added source actions to LSP `code_actions`, including actions such as Organize Imports, with application by title or index.
- Browser automation now supports downloads from relay tabs and broader `role/` selectors for implicit landmarks and structural roles.
- Improved skill and session workflows: skills created or installed during a session become immediately discoverable, and user-attributed custom messages that start a turn receive the appropriate prompt setup.
- Validated security findings now display validation status, timestamp, and summary information.
- Dual-mode language servers retain pushed diagnostics alongside pull diagnostics, preserving build and lint errors across edits.
- Improved session navigation and reliability when switches, forks, branches, context resets, or new sessions overlap; requests are processed in order without freezing or misrouting messages.
- Improved eval and interactive execution behavior, including preservation of JavaScript state and output across asynchronous failures, clearer startup and runtime errors, and better reporting when kernels or runtimes terminate.
- Parent-to-subagent messages now appear as IRC cards in live and Agent Hub transcripts.
- Paused agent turns can allow the machine to sleep at safe boundaries and restore sleep prevention when resumed.
- Improved JSON-mode shutdown handling so final tool events and buffered output are preserved.
- Improved task efficiency and responsiveness for isolated subagents, file search, browser guidance on Linux/X11, and long-running or cancellable operations.
- Updated the `tui.mouse` setting documentation to accurately describe wheel-scrolling behavior.
- `mnemopi.dbPath` values beginning with `~` now resolve relative to the home directory.
- Disabling the Codex provider now prevents its configuration from overriding omp settings, and providers can be disabled without applying their other settings.
- `omp gc` now shows a progress bar for each slow step (listing and scanning sessions, scanning transcripts for blob refs, archiving) on interactive terminals.
- `omp gc --strip` and `--compress` start work immediately instead of first reading every session's metadata, and `--strip` processes several sessions at once with a running tally of transcripts stripped.
- `omp gc` without `--apply` now says up front that it is a dry run.

### Fixed

- Fixed `omp --resume` showing `(no messages)` for sessions whose first prompt follows a large memory recall, image-only message, or `/skill:` reply ([#16495](https://github.com/can1357/oh-my-pi/issues/16495))
- In the shell visualization, a running command's inline script, heredoc, or `sh -c`/`ssh` script stays undimmed with the command instead of fading as inactive.
- The shell visualization highlights heredocs and inline scripts behind launchers (`uv run python -`, `timeout 60 python3 -c`, `env … bun -e`, `ssh host 'bash -s' <<EOF`, `ssh host <<EOF`, `docker run … bash -euc`), names a heredoc by its `#!` line or the file it writes (`cat > "$dir/lib.rs"`), and highlights Rust, Go, C-family and Swift heredocs.
- On Windows, commands run by the bash tool, including `nohup` background commands, get a console of their own, so programs that draw directly on the console (xperf and PowerShell progress bars, password prompts) no longer corrupt the TUI ([#18517](https://github.com/can1357/oh-my-pi/pull/18517) by [@H4vC](https://github.com/H4vC)).
- Reading Reddit URLs now works when Reddit blocks its API: posts, comment threads, subreddits, and user pages fall back to a Redlib mirror and then the Arctic Shift archive, and render full nested comment trees.
- Limited xAI `web_search` to two hosted-search turns per request to help prevent unexpected X search costs.
- Fixed extension event delivery so each extension receives events in emission order, even when another extension is slow to process an earlier event.
- `pi.sendUserMessage()` now rejects when a message is dropped before a turn begins, including the cost-cap reason when available.
- Prevented OpenTelemetry settings from omp-managed `.env` files from leaking into child processes or in-process extensions.
- Supervised-service waits now complete only after logs, metadata, and session-owner state have been published.
- Fixed Windows daemon metadata loss when another process temporarily reads `meta.json`.
- Improved image-generation errors to report why each model in a failed fallback chain was unsuccessful.
- Fixed model switching after remote compaction so the destination provider can recover the necessary conversation history instead of receiving only a placeholder summary.
- Remote MCP HTTP and SSE connections now honor `NODE_EXTRA_CA_CERTS` from the agent environment, including certificates loaded after startup.
- Preserved provider prompt-cache reuse across auto-learn captures, skill updates, and other session changes that do not require rebuilding the full system prompt.
- Closing `/btw` history during tool approval now correctly returns focus to the approval prompt.
- URL reads now handle bot-protection challenges more reliably, try alternate user agents, and report blocked or failed results instead of returning a protection page as content.
- Timed-out or cancelled JSON reads now stop their `jq` processing promptly.
- Fixed standalone binaries loading extensions that import top-level `@linxiraos/pi-utils` subpaths.
- HUD job status updates now continue to reflect elapsed time instead of freezing until matching output arrives.
- Generic remote compaction now supports `before_provider_request` payload hooks.
- Background completions no longer start hidden turns after an ACP prompt ends or incorrectly leave the session busy.
- Fixed shell behavior for exit status and `EXIT` traps in subshells to match Bash semantics.
- Preserved provider prompt-cache hits when resuming sessions after pruning, rewinding, branching, tree navigation, or other history changes.
- Cursor native edit operations now display accurate edit cards and diffs, including failed edits, instead of misleading separate read/write cards.
- `grep` and `glob` now respect timeout and cancellation when ovnfs status or daemon handshakes stall.
- Fixed `--mode json` shutdowns so tool completion events and the final JSON record are not lost or truncated.
- Commands beginning with `cd /` now execute from the filesystem root as intended.
- Edit auto-repair now accounts for retry costs and stops before exceeding the session cost cap.
- MCP prompt commands now correctly assign positional arguments that follow `key=value` arguments.
- `/shake thinking` now reports and preserves reasoning blocks that the provider continues to replay, avoiding inaccurate context-reduction claims.

## [18.18.1] - 2026-11-08

### Breaking Changes

- Rust SDK: `BashCommand` and `ReadyEvent` struct literals need `exclude_from_context: None` and `supports_bash_exclude_from_context: None` ([#18206](https://github.com/can1357/oh-my-pi/pull/18206) by [@andrebrait](https://github.com/andrebrait))

### Added

- RPC `bash` accepts `excludeFromContext: true` to keep a run out of model context like terminal `!!`; runtimes advertise support with `supportsBashExcludeFromContext` in the `ready` frame, and the Python SDK exposes that frame as `client.ready` ([#18206](https://github.com/can1357/oh-my-pi/pull/18206) by [@andrebrait](https://github.com/andrebrait))

### Changed

- Agent `bash` commands run with `LANG`/`LC_ALL=C.UTF-8` on every platform instead of the inherited locale, so sort order, number formats and tool messages no longer vary by machine; a locale in the command's `env` or `.envrc` still wins, and `!` commands keep yours
- omp's built-in shell (`omp bash`/`omp zsh` and the bash tool) parses scripts about a third faster, sources large function libraries about 20% faster, and re-runs a repeated `eval` or `source` without recompiling it.
- The `computer` tool's `el.perform()` takes any spelling of an action `ax()` lists (`perform("open")`), and `computer.backgroundFallback: refuse` refuses every spelling of a raise, open, context menu or popup press ([#15282](https://github.com/can1357/oh-my-pi/pull/15282) by [@will-bogusz](https://github.com/will-bogusz))
- The `computer` tool no longer takes over your screen for a macOS `win.drag` across the text of a native text view, such as a TextEdit document; it selects that text in the background and returns the selection ([#16223](https://github.com/can1357/oh-my-pi/pull/16223) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- A browser relay tab stays usable after a password manager's inline autofill menu opens in it; the call that opened the menu still fails once (reinstall the extension with `omp browser-relay install` and reload it) ([#16908](https://github.com/can1357/oh-my-pi/pull/16908) by [@will-bogusz](https://github.com/will-bogusz))
- A `%%bash` cell in Python eval no longer prints its exit status (a stray `0`) after the command's output; a failing cell reports `%%bash: exit status N` on stderr instead.
- Reusing an already running `omp stats` dashboard now exits successfully without stopping the existing server ([#18443](https://github.com/can1357/oh-my-pi/issues/18443)).
- A function defined inside a command substitution in a here-document body (`cat <<E` / `$(f() { …; }; f)` / `E`) no longer crashes the built-in shell.
- A Cursor tool call sent in the same batch as a native StrReplace or Write no longer runs before the edit is written, so a check right after an edit sees the new file ([#18434](https://github.com/can1357/oh-my-pi/pull/18434) by [@KadirBerkpolat1](https://github.com/KadirBerkpolat1))
- Pinned sessions color their pin icon with the theme accent in the status line and the band composer's title instead of taking the title's color or dim style, matching the resume picker ([#18401](https://github.com/can1357/oh-my-pi/pull/18401) by [@SuperUserA](https://github.com/SuperUserA))
- An ovnfs checkout stays recoverable with `omp worktree clear` when removing it fails, or when creating it fails after the daemon may already have it, instead of being forgotten ([#18337](https://github.com/can1357/oh-my-pi/pull/18337) by [@eggpeat](https://github.com/eggpeat))
- A `retain` call that fails midway no longer delivers part of itself to the Hindsight server while telling the model nothing was queued ([#18440](https://github.com/can1357/oh-my-pi/pull/18440) by [@eggpeat](https://github.com/eggpeat))
- A `bash.patterns` `deny` rule now blocks a command anywhere in a `;`, `|`, `||` or `&&` line even when an earlier `prompt` rule matches another part of it, and project settings can no longer override the operator's `deny` or `prompt` patterns with `allow` ([#18349](https://github.com/can1357/oh-my-pi/pull/18349) by [@asuffield](https://github.com/asuffield))
- A subagent stopped by the session cost cap (`--max-cost` / `session.maxCost`) now reports the cap's refusal instead of "Subagent ended without a final message" ([#18362](https://github.com/can1357/oh-my-pi/issues/18362))
- ERB templates open in ruby-lsp as `erb`, so valid templates no longer report dozens of bogus Ruby errors, and a diagnostics pull ruby-lsp answers with `null` no longer holds the call for its whole timeout ([#18372](https://github.com/can1357/oh-my-pi/pull/18372) by [@alphastorm](https://github.com/alphastorm))
- Mistral Vibe browser sign-in shows subscription billing in the status line and advisor spend instead of pay-as-you-go pricing ([#18374](https://github.com/can1357/oh-my-pi/issues/18374))
- Native OpenAI compaction no longer waits for a Hindsight memory recall it cannot use; fallback summaries still recall memory ([#18327](https://github.com/can1357/oh-my-pi/issues/18327))
- An eval `wait()` on jobs owned by a worker returns finished jobs and consumes their results instead of reporting them as running or delivering them again ([#18363](https://github.com/can1357/oh-my-pi/issues/18363))
- `/restart` no longer drops running subagents: they go on with their interrupted turns in the relaunched process and deliver their results to the agent that spawned them, as `omp --restore` now also does after a normal quit
- A shell command nested hundreds of levels deep (subshells, groups, command substitutions) is now a syntax error in the built-in shell instead of crashing omp with a stack overflow.
- Eval `wait()` progress rows for agents spawned by one `task` call show each agent's own tool count, context, cost and activity instead of the first agent's ([#18393](https://github.com/can1357/oh-my-pi/issues/18393))
- In the Pseudo shell visualization, an `&&` chain keeps its `and` rows while it runs and after it finishes, instead of switching to literal `&&` rows and a raw-bash tail when the output minimizer runs it one command at a time ([#18408](https://github.com/can1357/oh-my-pi/issues/18408))
- Autoresearch `update_notes` calls can now append an idea with only `append_idea`, without passing a replacement `body` ([#18439](https://github.com/can1357/oh-my-pi/pull/18439) by [@eggpeat](https://github.com/eggpeat))

## [18.18.0] - 2026-11-07

### Fixed

- Fixed transcript output freezing after provider restarts or switching sessions mid-stream ([#18358](https://github.com/can1357/oh-my-pi/pull/18358) by [@JustasMasiulis](https://github.com/JustasMasiulis))
- Bash tool cards for a command whose leading `cd <dir> &&` / `cd <dir>;` was hoisted into the working directory show that `cd` again above the visualized command, with the separator the model wrote, instead of dropping where it ran
- Bash commands starting with `cd <dir>; ...` now run in `<dir>` as their working directory when it exists, so its direnv environment loads and the directory shows on the tool card ([#18329](https://github.com/can1357/oh-my-pi/pull/18329) by [@harshaygadekar](https://github.com/harshaygadekar))
- Task-file approvals show and keep the checked file target through dispatch, so retargeted symlinks cannot silently substitute another assignment; replaced files require a retry ([#18314](https://github.com/can1357/oh-my-pi/pull/18314) by [@iliaal](https://github.com/iliaal)).
- Subagents receive task instructions with their blank lines, Markdown hard breaks, and table spacing intact, whether given inline or via `taskFile`.
- Hindsight `retain` and `learn` memories are no longer lost when delivery fails or omp exits: they are kept on disk, retried, and delivered by the next session without duplicates ([#18176](https://github.com/can1357/oh-my-pi/pull/18176) by [@alphastorm](https://github.com/alphastorm))
- Fixed the session crashing with `Native shell returned an invalid execution trace` when a bash command assigned a long value containing multi-byte characters such as Chinese text ([#18259](https://github.com/can1357/oh-my-pi/issues/18259))
- `grep -e` and `rg -e` in the bash tool accept patterns that start with `-` (e.g. `grep -e "--canary"`) instead of failing with an unknown-option error.
- The bash execution visualization keeps updating, and saved traces still restore, after a command handles bytes that aren't valid UTF-8 (e.g. `v=$(printf '\377')`)
- On Windows, `grep`, `glob` and isolated subagents no longer flash a console window when they query or start the ovnfs daemon.
- A bash command containing a bare `[` (e.g. `a && [` while still streaming) no longer crashes omp in the Pseudo shell visualization ([#18320](https://github.com/can1357/oh-my-pi/issues/18320))
- Fixed a prompt that mentions an internal-scheme URL with `@` (e.g. `@local://x`, `@vault://x`) aborting the run with "uses internal scheme ... not as a filesystem path"; such a mention is now left as plain text ([#16071](https://github.com/can1357/oh-my-pi/issues/16071))
- Fixed MCP OAuth login and token refresh failing with `JSON Parse error: Unexpected identifier "access_token"` against GitHub's token endpoint ([#18292](https://github.com/can1357/oh-my-pi/issues/18292))
- MCP OAuth requests tokens for the MCP server's own resource (from its protected-resource metadata) instead of a different `resource` advertised by the authorization server, fixing `401 invalid_token` after `/mcp reauth` on servers such as Firecrawl's hosted MCP ([#18315](https://github.com/can1357/oh-my-pi/issues/18315))
- Concurrent subagent MCP calls now grant newly loaded tools to the session that made each call, even when providers reuse call IDs. ([#18324](https://github.com/can1357/oh-my-pi/pull/18324) by [@eggpeat](https://github.com/eggpeat))
- LSP document symbols now show identifier lines, so those lines work with references, definition, and rename ([#18257](https://github.com/can1357/oh-my-pi/issues/18257)).
- Subagents on worker threads no longer fail with `Cannot send … instance across threads` when their model comes from an extension-registered provider with its own `streamSimple` ([#18310](https://github.com/can1357/oh-my-pi/pull/18310) by [@Dangerboi](https://github.com/Dangerboi))
- ⌘V in terminals with kitty enhanced paste (OSC 5522, e.g. Ghostty 1.4) now attaches macOS TIFF screenshots instead of reporting "Clipboard paste has no supported text or image data" ([#17696](https://github.com/can1357/oh-my-pi/issues/17696), [#18203](https://github.com/can1357/oh-my-pi/pull/18203) by [@roboomp](https://github.com/roboomp))
- Disabling `display.shellVisualization` now omits bash execution traces from tool updates and saved sessions, including in ACP ([#18267](https://github.com/can1357/oh-my-pi/issues/18267)).
- `/quit` and `/exit` no longer wait several seconds for an unresponsive OTLP telemetry collector ([#18255](https://github.com/can1357/oh-my-pi/issues/18255)).
- Cancelling a Python eval cell right as it starts now stops the cell cleanly instead of letting it run and killing the kernel ([#18242](https://github.com/can1357/oh-my-pi/pull/18242) by [@eggpeat](https://github.com/eggpeat))
- Browser `open` now returns the same tab with a recovery notice when Chrome detaches the relay during navigation and omp successfully reattaches, instead of failing the open and closing newly opened tabs ([#18252](https://github.com/can1357/oh-my-pi/pull/18252) by [@will-bogusz](https://github.com/will-bogusz))
- `tab.errors()` keeps the fields of plain-object and other non-Error rejections, bounded like console arguments, instead of reporting only `Object` ([#16959](https://github.com/can1357/oh-my-pi/issues/16959)) ([#18251](https://github.com/can1357/oh-my-pi/pull/18251) by [@Alex-Wengg](https://github.com/Alex-Wengg))
- An extension provider with `authHeader: true` keeps its cached `fetchDynamicModels` catalog when `omp models refresh` fails, instead of showing 0 models until the next successful forced refresh ([#18227](https://github.com/can1357/oh-my-pi/issues/18227))
- A session whose request carries no titleable text of its own — an attached `@brief.md`, a greeting, a bare number — is now named once from the assistant's reading of it, instead of staying untitled until the next message that happens to be titleable (which, for an agent launched from one brief and left to run, never came) ([#18238](https://github.com/can1357/oh-my-pi/pull/18238) by [@sjawhar](https://github.com/sjawhar))
- Prewalk no longer hands a subagent to its cheap model when the subagent messages its parent or another agent (`write agent://…`) before its first file edit ([#18322](https://github.com/can1357/oh-my-pi/pull/18322) by [@1vivy](https://github.com/1vivy))

## [18.17.0] - 2026-11-06

### Added

- Bash commands, foreground and background, now show a live execution visualization in Raw or Python-like Pseudo view, with variable values and replay history; disable with `display.shellVisualization` (default on).
- `grep` and `glob` inside an ovnfs checkout ask the ovnfs daemon to search the checkout in-process, avoiding per-file mount round trips; the daemon and its mount come from `ovnfs --json status` when the ovnfs binary is found. They fall back to the native search when the daemon is unavailable or rejects the request, and cancelling the tool cancels the daemon's search. ovnfs with admin protocol 5 is required.
- Added `skills.manualSkills` glob patterns to hide skills from the model catalog while keeping them manually invocable ([#18114](https://github.com/can1357/oh-my-pi/pull/18114) by [@Shadorain](https://github.com/Shadorain))
- Added Keenable web search (`web/keenable`), using `KEENABLE_API_KEY` or a stored `keenable` credential, or a keyless public endpoint when explicitly selected ([#17953](https://github.com/can1357/oh-my-pi/pull/17953) by [@KGKallasmaa](https://github.com/KGKallasmaa))
- `web_search` results list failed providers with reason and status code in `details.failures` ([#18124](https://github.com/can1357/oh-my-pi/pull/18124) by [@will-bogusz](https://github.com/will-bogusz))
- Added opt-in background auto-update (`update.auto`, offered in setup) that installs new releases via your install method and runs them next launch; skipped on Nix, source checkouts, and Tern.
- `omp update` refuses to run while another update (including auto-update) is installing.
- Added `none` to `edit.mode` (and `PI_EDIT_VARIANT`) to remove the `edit` tool; `bash` stays available even if `bash.enabled` is off.
- Added default-off `providers.openaiResponsesWebsockets` to use WebSockets for supported standard Responses models ([#17354](https://github.com/can1357/oh-my-pi/pull/17354) by [@TatsukiMeng](https://github.com/TatsukiMeng))
- Pinned sessions show a pin beside their title; `/unpin [session id]` unpins a session ([#17848](https://github.com/can1357/oh-my-pi/pull/17848) by [@SuperUserA](https://github.com/SuperUserA))
- Extensions can draw tool calls and `message`/`event` blocks full, compact, or hidden via `pi.registerTranscriptPresenter()`, and redraw with `ctx.ui.refreshTranscript(ids)`; enable with `extensionRenderers.transcriptPresenters` (default off) ([#17960](https://github.com/can1357/oh-my-pi/pull/17960) by [@materemias](https://github.com/materemias)) ([#17997](https://github.com/can1357/oh-my-pi/pull/17997) by [@materemias](https://github.com/materemias))
- Consecutive compact transcript blocks render as tight rows without blank gaps; extension renderers opt in via `isTranscriptBlockCompact()` ([#17997](https://github.com/can1357/oh-my-pi/pull/17997) by [@materemias](https://github.com/materemias))
- Added a fullscreen link browser for links in scrollback: press Alt+O again (or Page Up) while link tags are shown ([#16476](https://github.com/can1357/oh-my-pi/pull/16476) by [@materemias](https://github.com/materemias))
- Added a `cache` status-line segment (`full`/`nerd` presets) showing whether the next message hits the prompt cache; Tern and `/session` show why not and how much is resent ([#12677](https://github.com/can1357/oh-my-pi/issues/12677)) ([#17496](https://github.com/can1357/oh-my-pi/pull/17496) by [@will-bogusz](https://github.com/will-bogusz))
- `^` model tags accept a `:level` suffix (e.g. `^openai-codex/gpt-6-astra:high`) to set the subagent's effort (overriding `task.maxEffort`), with completion of each model's supported levels ([#17574](https://github.com/can1357/oh-my-pi/pull/17574) by [@a-glapinski](https://github.com/a-glapinski))
- Added the `chillax` magic keyword for brief, lowest-effort thinking on supported models; configure via `magicKeywords.chillax`
- Added `tui.colorfulMarkdown` (on by default): replies color headings by level, bold and italic text, inline code and table headers from the theme's palette; turn it off for the previous single heading color and plain bold/italic
- Added `tui.motion` (`full`/`reduced`/`none`), `tui.spinnerInterval` (`0` = static) and `tui.maxFps` to control animation and repaint rate, also via `--motion`/`--spinner-interval`/`--max-fps` and `PI_MOTION`/`PI_SPINNER_INTERVAL`/`PI_MAX_FPS`; an explicit `tui.spinnerInterval` beats `tui.motion`, and keystroke echo keeps 30 fps ([#14240](https://github.com/can1357/oh-my-pi/pull/14240) by [@mccraigmccraig](https://github.com/mccraigmccraig))
- Added `omp zsh`, `omp bash` and `omp sh` to run omp's built-in shell engine directly, passing all arguments through and exiting with the shell's status.
- `omp zsh`/`omp bash` keep shell history in your `$HISTFILE`, compatible with real zsh, including `!` expansion, `fc` and `history`.
- `omp zsh` runs interactively like zsh (line editor, `bindkey`, completion, job control, prompt hooks, common modules), so oh-my-zsh and powerlevel10k configs start.
- RPC `bash` results report truncated output via `elidedBytes`/`elidedLines` and `columnTruncated*`/`columnMax` fields, decoded by the Go, Python and Rust SDKs ([#17957](https://github.com/can1357/oh-my-pi/pull/17957) by [@H4vC](https://github.com/H4vC))
- Added `pi.getShortcutConflict(chord)` so extensions can check whether a key chord is free or who holds it ([#17961](https://github.com/can1357/oh-my-pi/pull/17961) by [@materemias](https://github.com/materemias))
- Exported `unwrapHashlineHeaderPath` from `@linxiraos/zeta` to turn a `[path#TAG]` target into its plain path ([#17961](https://github.com/can1357/oh-my-pi/pull/17961) by [@materemias](https://github.com/materemias))
- `devin-cli` login imports Devin CLI credentials, so the `devin` provider no longer requires `DEVIN_API_KEY` ([#13637](https://github.com/can1357/oh-my-pi/pull/13637) by [@pavel-kalmykov](https://github.com/pavel-kalmykov))
- `devin-windsurf` login authenticates the `devin` provider with an existing Windsurf Enterprise account ([#13288](https://github.com/can1357/oh-my-pi/pull/13288) by [@pavel-kalmykov](https://github.com/pavel-kalmykov))

### Changed

- ovnfs turns on by itself when its binary is found (`ovnfs.path`, else `ovnfs` on PATH): agents get the separate-checkout guidance, and isolated subagents use ovnfs checkouts when `isolation.backend` is `auto`
- Text Verbosity now defaults to low and applies to Codex too, matching the official Codex client: shorter answers that finish sooner; set `textVerbosity` to `medium` for the old length
- A cost cap set on the main thread now applies to running subagents immediately
- RPC wire protocol and task streaming have lower serialization overhead
- Local Whisper speech-to-text, Parakeet/Nemotron speech, and the local tiny model install their runtimes on first use, shrinking installs; first use needs network access
- `wait` with nothing new returns after 5s (backing off to 5m over repeated idle waits) instead of blocking up to 30 minutes, and nudges the agent toward other work
- `wait` returns jobs finishing within 1.5s of each other in one result
- Broadcasts and progress notes no longer cut short `wait` or interrupt bash/eval; a direct message still ends a wait and delivers every queued message
- `wait` for a reply gives up after 5 minutes (was 30) and returns at once if the other agent is waiting on the user
- In Tern, streamed assistant text and thinking are sent unpaced, cutting omp's CPU use; other terminals keep the smooth reveal
- Source-checkout sessions start faster; existing build stamps remain readable
- The agent's `bash` tool never touches your shell history or completion, and its `zsh -i`/`bash -i` skip `.zshrc`/`.bashrc`
- Embedded Bash follows Bash 5.3 semantics and preserves supported aliases
- CLI flags, session-only settings writes, and SDK overrides now outrank a setting's env var (`PI_MOTION=none omp --motion full` uses full motion); env vars still outrank settings files
- JS and Python tool aborts now report the original abort reason
- Many concurrent subagents now run in worker threads so they don't slow the TUI; new `task.workerThreads` caps workers (default 4; `0` keeps all on the main thread)
- Interactive startup reaches the first frame ~75ms sooner when skills are listed in the system prompt
- "What's New" release notes now appear just after the first frame; quitting before it keeps them for the next start
- Subagents can no longer broadcast (`write agent://all` fails, pointing to a direct `agent://<id>` message) and are no longer told to announce shared-file edits; the main agent can still broadcast
- Factory Droid Gemini 4 Argon sessions keep earlier turns intact across save and reload, with correct image clamping ([#17861](https://github.com/can1357/oh-my-pi/pull/17861) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- On macOS, the browser tool's headless Chromium keeps background tabs at normal CPU priority, so on a busy machine `tab.traceStart()`, opening a second tab, and other calls into background tabs no longer stall or time out
- Subagents loading MCP tools (such as Kata's `load_*`) no longer change the main session's tools or system prompt
- Mounting an MCP tool mid-session on prefix-bound models no longer changes the eval tool description, and the mount notice now reaches the model
- Worker-thread subagents are faster: switching views on long transcripts no longer lags, `wait` no longer streams full transcripts, and they stall less on a busy main thread
- Streaming a large batch `task` call no longer slows quadratically (about 80 ms → 2 ms for a 200 KB call)
- `computer` from Eval now uses `zoom` for legible close-ups instead of cropping the downscaled screenshot ([#18158](https://github.com/can1357/oh-my-pi/pull/18158) by [@will-bogusz](https://github.com/will-bogusz))
- Python eval `@tool` definitions with type annotations now register on Python 3.9 ([#18143](https://github.com/can1357/oh-my-pi/pull/18143) by [@Winston-Hsiao](https://github.com/Winston-Hsiao))
- `read` of an SEC EDGAR filing document or folder returns that document, not the company profile ([#18150](https://github.com/can1357/oh-my-pi/pull/18150) by [@will-bogusz](https://github.com/will-bogusz))
- `read` of a Read the Docs page no longer returns another repository's linked file ([#18162](https://github.com/can1357/oh-my-pi/pull/18162) by [@will-bogusz](https://github.com/will-bogusz))
- A browser click beside a direct `tab.waitForDownload()` now errors with a `tab.run` suggestion that actually catches the download ([#17615](https://github.com/can1357/oh-my-pi/issues/17615)) ([#18155](https://github.com/can1357/oh-my-pi/pull/18155) by [@will-bogusz](https://github.com/will-bogusz))
- Browser `open({ viewport })` now sizes relay tabs, `app.cdp_url`/`app.path` browsers, and headed Chromium on first open ([#18160](https://github.com/can1357/oh-my-pi/pull/18160) by [@will-bogusz](https://github.com/will-bogusz))
- Discarded empty, reasoning-only, or length-stop turns still count billed usage in session totals and `omp stats` ([#18178](https://github.com/can1357/oh-my-pi/issues/18178))
- `/extensions` shows the active `~/.agents` skill when a higher-priority `~/.claude` copy is not opted in ([#18190](https://github.com/can1357/oh-my-pi/issues/18190))
- Tool results whose `details` contain a throwing getter no longer silently stop all later session saves ([#18134](https://github.com/can1357/oh-my-pi/pull/18134) by [@MonsieurBarti](https://github.com/MonsieurBarti))
- `write` to a new `ssh://` file no longer fails when the content ends with a `read` truncation notice ([#18154](https://github.com/can1357/oh-my-pi/pull/18154) by [@will-bogusz](https://github.com/will-bogusz))
- `find` returns verified hits as partial results when its 20 s budget runs out instead of failing ([#14809](https://github.com/can1357/oh-my-pi/issues/14809)) ([#18161](https://github.com/can1357/oh-my-pi/pull/18161) by [@will-bogusz](https://github.com/will-bogusz))
- Background bash completion notices name the command, so parallel jobs are distinguishable ([#12607](https://github.com/can1357/oh-my-pi/issues/12607)) ([#18166](https://github.com/can1357/oh-my-pi/pull/18166) by [@will-bogusz](https://github.com/will-bogusz))
- LSP results stay current for open files edited outside OMP, and files unused for 5 minutes are closed in the language server ([#18153](https://github.com/can1357/oh-my-pi/pull/18153) by [@will-bogusz](https://github.com/will-bogusz))
- Markdown edits no longer falsely warn that valid text (e.g. `| a |||`) fails to parse ([#18151](https://github.com/can1357/oh-my-pi/pull/18151) by [@will-bogusz](https://github.com/will-bogusz))
- Bash arguments like `"skill:// external command"` reach external commands as written instead of failing with exit 126 ([#18163](https://github.com/can1357/oh-my-pi/pull/18163) by [@will-bogusz](https://github.com/will-bogusz))
- Thin tool images are padded to the vision model's minimum size instead of causing a 400 ([#18081](https://github.com/can1357/oh-my-pi/issues/18081))
- JSON query truncation notices report the 50KB read budget instead of the bytes shown ([#18022](https://github.com/can1357/oh-my-pi/pull/18022) by [@eggpeat](https://github.com/eggpeat))
- Extension links, renderers, and `ctx.ui.getLinkClicksAvailable()` now work on every launch, not only the first after an edit ([#18116](https://github.com/can1357/oh-my-pi/pull/18116) by [@materemias](https://github.com/materemias))
- Multi-line AST Grep captures show on one `meta:` row instead of splitting across rows ([#18105](https://github.com/can1357/oh-my-pi/pull/18105) by [@JustasMasiulis](https://github.com/JustasMasiulis))
- Extension shortcuts now match regardless of modifier order or spelling: reserved chords stay ignored and the last-loaded duplicate wins ([#17961](https://github.com/can1357/oh-my-pi/pull/17961) by [@materemias](https://github.com/materemias))
- Building from source works again ([#18074](https://github.com/can1357/oh-my-pi/pull/18074) by [@Maziar123](https://github.com/Maziar123))
- `.`/`c` continue no longer reports "Nothing to resume" after `/handoff`, compaction, or a `/skill:`-started session
- `omp bash` and `omp sh` show a prompt when `PS1` is unset
- `display.cacheMissMarker` now flags turns that re-send most of the conversation (e.g. after an idle gap), even when the system prompt block was cached
- A running session keeps its setting values when `config.yml` gains a value its omp version doesn't know, preserving tools and prompt cache
- Forcing a queued message with Enter now reliably resumes the agent
- Interrupting a Python eval cell blocked on top-level `await` cancels the cell and keeps the kernel and variables ([#18115](https://github.com/can1357/oh-my-pi/pull/18115) by [@Winston-Hsiao](https://github.com/Winston-Hsiao))
- Apostrophes in slash-command and prompt-template arguments (e.g. `/fix the user's login bug`) now reach `$ARGUMENTS` and `$1`, `$2`, … intact ([#18008](https://github.com/can1357/oh-my-pi/issues/18008))
- Bash output: middle truncation no longer splits lines and reports accurate line ranges; silent success returns `(no output, exit code 0)` ([#17957](https://github.com/can1357/oh-my-pi/pull/17957) by [@H4vC](https://github.com/H4vC))
- A new session's first frame always shows your configured default model and thinking level, not one from another session or folder
- System-prompt skill listings show the compressed routing hint instead of a truncated description when it fits 160 characters; previously skipped skills are recompressed
- Skill descriptions stop triggering background model requests once the session-tree cost cap is reached, and their spend counts toward the cap ([#18016](https://github.com/can1357/oh-my-pi/issues/18016))
- The idle recap survives resume, restart, and transcript rebuilds, staying at the end until the conversation moves on ([#18113](https://github.com/can1357/oh-my-pi/pull/18113) by [@materemias](https://github.com/materemias))
- Chat sessions on a `web` (or other model-kind) role model no longer fall back to `web/*` search providers and fail with `Unhandled API in mapOptionsForApi: web-search` ([#18056](https://github.com/can1357/oh-my-pi/pull/18056) by [@haesol-shin](https://github.com/haesol-shin))
- Grouped `read` rows naming a URL link the whole URL, not just its last path segment ([#18071](https://github.com/can1357/oh-my-pi/pull/18071) by [@iacore](https://github.com/iacore))
- A second `ask` note on a later single-select question no longer replaces the previous question's note ([#17979](https://github.com/can1357/oh-my-pi/issues/17979))
- The first run of a compiled binary after install or upgrade no longer fails `omp --smoke-test` with `SubagentCodeChangedError` or keeps subagents on the main thread ([#18060](https://github.com/can1357/oh-my-pi/issues/18060))
- Retrying an aborted turn keeps the unsent composer draft ([#17977](https://github.com/can1357/oh-my-pi/pull/17977) by [@Shadorain](https://github.com/Shadorain))
- The `tts` tool uses Grok Voice again instead of silently falling back to Kokoro, and sends `language` to xAI (auto-detected if omitted) ([#17992](https://github.com/can1357/oh-my-pi/pull/17992) by [@Mirceone](https://github.com/Mirceone))
- Windows bash output on non-UTF-8 code pages (CJK) no longer turns into mojibake after one invalid byte; the byte shows as `�` ([#17947](https://github.com/can1357/oh-my-pi/pull/17947) by [@H4vC](https://github.com/H4vC))
- Hindsight no longer silently drops the last mental model (often `User Preferences`) from the prompt when over the render budget ([#17548](https://github.com/can1357/oh-my-pi/issues/17548), [#17955](https://github.com/can1357/oh-my-pi/pull/17955) by [@harshaygadekar](https://github.com/harshaygadekar))
- Subagents woken by IRC, restored, revived, or rerun by a workpool keep their `task.softRequestBudget` guard; it and `task.agentSoftRequestBudget` resolve by agent name (e.g. `scout`), not task ID ([#17988](https://github.com/can1357/oh-my-pi/pull/17988) by [@sinhduc01](https://github.com/sinhduc01), [#18121](https://github.com/can1357/oh-my-pi/pull/18121) by [@eggpeat](https://github.com/eggpeat))
- A focused subagent's `blocked` indicator follows its own approval mode, tool policies, and grants instead of the main session's
- Bash tool: `exec >file`, `exec 2>/dev/null`, or `exec <file` no longer redirects later commands in the session
- Bash tool: an `EXIT` trap fires once at the end of its command, not after every later command
- Bash tool: late output from a background job (`(sleep 1; echo late) &`) no longer appears in a later command's output
- Bash tool: `env -i` no longer passes non-shell-name variables (`A-B=1`), and `X=v env -i`/`X=v env -u X` no longer pass an exported outer `X`
- Bash tool: `xargs` reports a signal-killed command like GNU xargs: `xargs: CMD: terminated by signal N`, stopping with status 125
- macOS: starting a bash tool session no longer briefly sets umask to 022, which could give new files wrong permissions
- Bash tool: a shebang-less executable script run in the background from a FIFO (`./script < fifo &`) runs as bash instead of failing with `Exec format error`
- Subagents no longer hang in an async Python `@tool` call waiting on an `asyncio.Lock` held by another subagent's call
- Cancelling a subagent mid-call cancels its async Python `@tool` coroutine, releasing locks, and reports `Python tool request was cancelled`
- Agent Hub no longer shows a previous session's subagents after creating or switching sessions
- `ast_grep` and `ast_edit` detect languages for uppercase file extensions
- snapcompact no longer treats incompatible older archives as reductions
- `computer` window lookup and app opening work for app IDs, paths, and `~` paths, and survive Wayland permission timeouts
- Embedded headless Chrome no longer outlives its host process, and `computer`/browser lifecycle works in SDK embeddings and local test runs
- Out-of-credit provider errors now fail immediately instead of retrying for long periods; Retry works promptly once the account is funded.
- DeepSeek-style `*** End` and `*** End Patch` markers are no longer written into files or truncate later edits
- Composer prediction ghost text no longer vanishes when advisor messages arrive

## [18.16.0] - 2026-11-02

### Added

- With the Hindsight memory backend, `retain` and `learn` can now store a memory with `scope: "global"` so every project recalls it. It is opt-in through the new `hindsight.globalScope` setting (off by default) and needs `global` or `per-project-tagged` scoping ([#17706](https://github.com/can1357/oh-my-pi/pull/17706) by [@alphastorm](https://github.com/alphastorm), from [#15030](https://github.com/can1357/oh-my-pi/pull/15030) by [@kithawk](https://github.com/kithawk)).
- Added `btw.inject` (off by default; `/settings` → Interaction → "/btw Steering Inject"): when you ask `/btw` for a steering prompt, it drafts one in an `<inject>` block shown behind a pink rail, and `Alt+I` (`app.btw.inject`) sends it to the main session (as a steer while the agent runs, else as a new turn) from the inline answer or the BTW history sheet, once per answer from the current run. Once sent, the block turns green with `➤` on each line and "Injected into main session" below it; if the main session drops or refuses the send, the block turns back to pending and the same key retries ([#17618](https://github.com/can1357/oh-my-pi/pull/17618) by [@apullin](https://github.com/apullin))
- With OTLP metrics export configured (`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`), composer predictions export content-free `omp.composer.prediction.*` metrics by serving model: requests by outcome (offered, skipped, stale, cancelled, timeout, error) with their duration, predictions shown (counted on the first frame that paints them), shown predictions by whether they were accepted with Tab or Right, and the time from first display to acceptance ([#17739](https://github.com/can1357/oh-my-pi/pull/17739) by [@wolfiesch](https://github.com/wolfiesch))
- Bash results the output minimizer rewrote now keep which filter ran and the bytes before and after in the session, and the bash card shows them (`Minimized: git 120.4KB → 3.2KB`) ([#16586](https://github.com/can1357/oh-my-pi/pull/16586) by [@will-bogusz](https://github.com/will-bogusz))
- Eval completion handles expose `attempts` (JS `await handle.attempts()`, Python `handle.attempts`): each fallback candidate tried, in order, with the model, the reasoning effort sent, its outcome, and the error when it failed ([#17782](https://github.com/can1357/oh-my-pi/pull/17782) by [@xiangnan0811](https://github.com/xiangnan0811))
- Added `composer.predictionAlternatives` (off by default; `/settings` → Interaction → "Prediction Alternatives", listed while Composer Predictions is on): the same single prediction request returns up to four different next messages, most likely first. Type a few letters to get ghost text for the first one that matches; after inserting one, press Tab again to pick another from a list. Prediction metrics carry how many alternatives were offered (`omp.composer.prediction.choices`), and an accepted prediction now resolves when it retires, with the rank of the alternative inserted last (`omp.composer.prediction.rank`) ([#17796](https://github.com/can1357/oh-my-pi/pull/17796) by [@wolfiesch](https://github.com/wolfiesch))
- `/review` and `/annotate code-review` work from a folder of checkouts: `/review owner/repo#123` reviews a GitHub PR from anywhere; `/review ./repo [#123 | !7] [focus]` reviews in that checkout (`#N` a GitHub PR, `!N` a GitLab MR); and outside any repository, the local and open-PR menu choices ask which child repository to use

### Changed

- `/resume` and `omp --resume` open at once on your titled sessions (read from `~/.omp/agent/history.db`), then fill in prompts, status, and untitled sessions when the full scan finishes; the first scan saves older sessions' titles too, so later opens list them right away
- With `symbolPreset: ascii`, status glyphs are three columns wide (`[+]`, `[-]`, `[#]`, `[ ]`) and status spinners animate as `[|] [/] [-] [\]` ([#17732](https://github.com/can1357/oh-my-pi/pull/17732) by [@JustasMasiulis](https://github.com/JustasMasiulis))
- The subagent HUD marks each running agent with the running status glyph instead of a dot ([#17732](https://github.com/can1357/oh-my-pi/pull/17732) by [@JustasMasiulis](https://github.com/JustasMasiulis))

### Fixed

- Browser: `browser.close({ all: true })` from a subagent no longer closes its parent's tabs; it releases only the calling agent's tabs. Tabs now belong to the agent that opened them rather than its conversation id, so after `/new`, `/resume`, fork, or branch they are still frozen, idle-closed, released by close-all, and closed when the session ends instead of leaking ([#15975](https://github.com/can1357/oh-my-pi/issues/15975), [#16133](https://github.com/can1357/oh-my-pi/pull/16133) by [@harshaygadekar](https://github.com/harshaygadekar))
- `lsp request` now sends `payload: "null"` as JSON null instead of substituting auto-built document params ([#17715](https://github.com/can1357/oh-my-pi/issues/17715)).
- A prompt rejected before a turn starts because its model or credential is missing returns to the editor for retry; `.`/`c` on an empty conversation reports that there is nothing to resume ([#17828](https://github.com/can1357/oh-my-pi/issues/17828)).
- Factory Droid requests keep attached images and snapcompact system-prompt frames when tools carry large runtime state ([#17819](https://github.com/can1357/oh-my-pi/issues/17819)).
- `pr://<n>`, `issue://<n>`, and repo-less `github` tool calls in a checkout whose `upstream` remote is not the fork parent of `origin` now resolve to `origin` instead of the upstream project; `gh repo set-default` still wins
- `omp -p` text mode now prints each automatic retry with its error (for example "Couldn't reach api.anthropic.com … check your network") instead of showing only `Working...` while a turn retries ([#17529](https://github.com/can1357/oh-my-pi/pull/17529) by [@Mannan-Goyal](https://github.com/Mannan-Goyal))
- `omp --export` and `/export` no longer fail with `Error: Out of memory` on large sessions with subagent transcripts, and use far less memory: the HTML is now streamed to disk instead of built as one string ([#17741](https://github.com/can1357/oh-my-pi/issues/17741))
- A native `security_scan` with `async.enabled` on (the default) now waits for its background `security-reviewer` workers and publishes their findings, instead of ending `partial` with 0 findings and "The scan session ended without publishing a canonical result" ([#17788](https://github.com/can1357/oh-my-pi/issues/17788))
- Browser (Chrome tabs): a click or drag cancelled before its final release now releases off-page instead of completing on its target, and the page sees no click from it (not even on the document root), a timed-out key combo sends no further key, and a call or run cut off mid-gesture releases the mouse button or keys it held instead of leaving them down in the tab. Input already dispatched to Chrome, including a target release, cannot be recalled and may still take effect after timeout ([#17778](https://github.com/can1357/oh-my-pi/pull/17778) by [@will-bogusz](https://github.com/will-bogusz))
- Relay mode: `tab.waitForSelector`, `tab.evaluate` and `tab.goto` no longer fail after 20 s when the page or server takes longer; like on a launched Chrome they now run to the call's own timeout, up to omp's 60 s protocol timeout, and a command Chrome never answers names itself and its tab ([#17778](https://github.com/can1357/oh-my-pi/pull/17778) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed browser `tab.click(selector, { button, count })` and `frame.click` ignoring their options and left-clicking once, so a right-click meant to open a context menu clicked the element instead; cmux tabs refuse buttons and counts they cannot press ([#17767](https://github.com/can1357/oh-my-pi/pull/17767) by [@will-bogusz](https://github.com/will-bogusz))
- Browser `fill` in Chrome no longer sometimes puts the new text in front of a Slate editor's old text when the machine is busy, and refuses a rich-text editor whose focus moves to a wrapper or the page instead of reporting success ([#17742](https://github.com/can1357/oh-my-pi/pull/17742) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a browser relay call working in a cross-site frame (an embedded sign-in form, say) failing with a bare `Target closed` when Chrome detached omp from the tab; it now says Chrome detached omp and whether the tab was reattached, as a call in the page itself does ([#17768](https://github.com/can1357/oh-my-pi/pull/17768) by [@will-bogusz](https://github.com/will-bogusz))
- Browser tabs omp opens with `persist: true` in your Chrome through the relay now stay open when the session ends (an `omp -p` run exits, a subagent finishes), so a page left for you is still there; other tabs omp opened still close, and an explicit close racing session cleanup still closes its page ([#17751](https://github.com/can1357/oh-my-pi/pull/17751) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed keys you type in another app going into a page on macOS when omp's click in a relay tab opened a new tab or popup ([#16284](https://github.com/can1357/oh-my-pi/pull/16284) by [@will-bogusz](https://github.com/will-bogusz))
- Parked subagents keep their `xd://` device mounts when woken after omp restarts, so they no longer lose their earlier Claude thinking ([#17746](https://github.com/can1357/oh-my-pi/pull/17746) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed cancelling `%pip` in Python eval leaving the installer process behind in Linux containers and chroots without a usable `/proc` ([#16552](https://github.com/can1357/oh-my-pi/pull/16552) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed numbered `read` pages of files with very long lines ending after a few KB: a line cut to `tools.outputMaxColumns` now counts the width shown, not its full length, against the page size, so paging no longer stops before such a line or refuses to step past it. When the first cut line is larger than a `:raw` read returns, the cut notice names that byte cap, and a multi-range read that the page size stops partway through a range says where to continue ([#16595](https://github.com/can1357/oh-my-pi/pull/16595) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `write` accepting the output of a `read` whose long lines were cut to `tools.outputMaxColumns` and overwriting the file with the cut lines; it now refuses it as an incomplete read, as it does for other truncated reads ([#16595](https://github.com/can1357/oh-my-pi/pull/16595) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a session resumed, or a parked subagent woken, on a later day resending its first message with that day's date, which made Claude drop all of its earlier thinking and missed the prompt cache; earlier messages now keep the date they were sent with ([#15343](https://github.com/can1357/oh-my-pi/issues/15343)) ([#17622](https://github.com/can1357/oh-my-pi/pull/17622) by [@will-bogusz](https://github.com/will-bogusz))
- `models.yml` accepts `tokenizer: cl100k` on a custom model or override ([#17607](https://github.com/can1357/oh-my-pi/pull/17607) by [@will-bogusz](https://github.com/will-bogusz))
- Claude no longer receives the reasoning kept in a snapcompact archive whose summary an extension wrote without the reasoning legend, with or without image input, and reads that summary's own words instead of a generic one ([#17745](https://github.com/can1357/oh-my-pi/pull/17745) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `~/.omp/agent/agent.db` getting corrupted (wiping stored logins) on Linux when grep, `read`, the bash tool, extensions or eval read it while omp has it open; `write` and `tts` now refuse to overwrite a database omp holds open ([#15586](https://github.com/can1357/oh-my-pi/issues/15586))

## [18.15.0] - 2026-11-01

### Added

- Long or multi-step background shell commands get a one-line caption saying what they do and when they end, written once per job by the `widget` model role when the job, after running 15 seconds, is shown in a live widget or listed by `/jobs full`; the jobs sheet and `/jobs full` show it under the job's purpose. It follows the Live Job Widgets setting (`async.widgets`), and `CreateAgentSessionOptions.jobCaptionWriter` replaces the model call ([#17649](https://github.com/can1357/oh-my-pi/pull/17649) by [@wolfiesch](https://github.com/wolfiesch))

### Changed

- In a source checkout, the error for a missing HTML export viewer now names the script that builds it, `packages/collab-web/scripts/build-export-viewer.ts`, beside `bun gen:export-viewer` ([#17636](https://github.com/can1357/oh-my-pi/pull/17636) by [@sjawhar](https://github.com/sjawhar))
- Fixed an eval cell running silently on a new kernel after the session's Python kernel or JS worker died between cells (a crash, a kill, an out-of-memory kill, or a cancelled JS cell): the first cell on the replacement now carries `Kernel restarted: … state is unavailable. Re-run needed setup` ahead of its own output, instead of failing with a bare `NameError` on a variable an earlier cell set ([#17595](https://github.com/can1357/oh-my-pi/pull/17595) by [@sjawhar](https://github.com/sjawhar))
- Fixed a task worker messaged (`write agent://<id>`) while still starting up running on the shared `context` alone and never receiving its `tasks[].task` assignment; the message now waits for the assignment's turn ([#17587](https://github.com/can1357/oh-my-pi/issues/17587))
- `lsp reload` now discovers Rust crates created after rust-analyzer started, so hover and other analysis work without restarting omp ([#17658](https://github.com/can1357/oh-my-pi/issues/17658)).
- A model without image input (GLM, DeepSeek, Grok Composer and the like) reads a snapcompact archive's full kept text instead of image-omitted placeholders for its frames, after a model switch, on resume and in side requests ([#17510](https://github.com/can1357/oh-my-pi/pull/17510) by [@will-bogusz](https://github.com/will-bogusz))
- Snapcompact no longer refuses a new archive as "would not reduce context" when it shrinks a session that already holds one (`/compact snapcompact`, idle and pre-prompt compaction) ([#17490](https://github.com/can1357/oh-my-pi/pull/17490) by [@will-bogusz](https://github.com/will-bogusz))
- A failed `/compact snapcompact` now reports its reason once instead of twice, and names the `/compact` mode to run instead ([#17490](https://github.com/can1357/oh-my-pi/pull/17490) by [@will-bogusz](https://github.com/will-bogusz))
- Background bash and eval jobs now carry the purpose the model gave for the call: `/jobs`, `/jobs full`, `proc://` listings, `wait` and `job` results, and the jobs HUD hover lead with it ahead of the raw command line ([#17649](https://github.com/can1357/oh-my-pi/pull/17649) by [@wolfiesch](https://github.com/wolfiesch))
- The `seance` guidance in the task tool and the `archive` docs now say that a question about an earlier session is answered by the `seance` agent, and that reading the session's raw JSONL belongs to narrow mechanical checks only, so a consult is no longer duplicated by transcript reads and re-run checks ([#17523](https://github.com/can1357/oh-my-pi/pull/17523) by [@iacore](https://github.com/iacore))

### Fixed

- A prompt on a model whose provider has no usable credential (logged out, refresh token expired, or an auth broker holding none) now switches to the first `retry.fallbackChains` candidate that has one instead of failing with "No API key found", and switches back on the first prompt after the credential returns ([#17559](https://github.com/can1357/oh-my-pi/pull/17559) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed background results arriving during manual `/compact` starting turns on stale history or disappearing from the saved session ([#17599](https://github.com/can1357/oh-my-pi/issues/17599)).
- Fixed isolated tasks on fuse-overlayfs leaving their overlay mounted and the `fuse-overlayfs` daemon running when the unmount hit a transient "Device or resource busy"; a failed unmount now reports fusermount's error and keeps the workspace for `omp worktree clear` instead of deleting its layers under the live mount ([#17644](https://github.com/can1357/oh-my-pi/issues/17644))
- Usage-limit retries now count system sleep toward the quota-reset deadline instead of re-arming the remaining uptime delay after the countdown reaches zero ([#17606](https://github.com/can1357/oh-my-pi/pull/17606) by [@zhiland](https://github.com/zhiland)).
- Fixed role assignments to a `models.yml` model whose id differs only by case from a bundled model of the same provider (such as `xiaomi/MiMo-V2.6-Pro` beside `xiaomi/mimo-v2.6-pro`) silently staying unset ([#17580](https://github.com/can1357/oh-my-pi/issues/17580))
- Fixed Eval's direct browser wait helpers (`tab.waitForSelector`, `tab.waitForText`, …) giving up after 29 s when passed a longer `{ timeout }`; the requested timeout is now honored up to the browser tool's 300 s cap ([#17617](https://github.com/can1357/oh-my-pi/issues/17617))
- Fixed `browser.open` with a fresh custom Chrome profile failing when Chrome has no initial tabs; it now opens its own tab without navigating an existing one ([#17583](https://github.com/can1357/oh-my-pi/issues/17583)).
- Fixed the read tool's repeated-output notice suggesting a `path:A-B` selector on `xd://` topics, MCP resources and other URLs that reject selectors ([#17631](https://github.com/can1357/oh-my-pi/issues/17631))
- The `lsp` tool now starts `typescript-native` (`tsc --lsp --stdio`) for a TypeScript 7 `tsc` installed without a `package.json`, such as the nixpkgs package, instead of leaving the project with no TypeScript server ([#17659](https://github.com/can1357/oh-my-pi/issues/17659))
- DuckDuckGo excludes advertising click redirects before applying result limits, keeping them out of direct and Public Web sources ([#17564](https://github.com/can1357/oh-my-pi/pull/17564) by [@jasonharrison](https://github.com/jasonharrison)).
- Fixed `/fast` refusing Ultrafast ("The current model does not offer the Ultrafast service tier") on custom OpenAI-compatible providers whose `/v1/models` row lists `ultrafast` in `service_tiers`, such as relays in front of a ChatGPT subscription ([#17577](https://github.com/can1357/oh-my-pi/pull/17577) by [@jakehemmerle](https://github.com/jakehemmerle))
- Importing the SDK no longer takes over the embedding host's signal and fatal-error shutdown; registered cleanup still runs at exit ([#17674](https://github.com/can1357/oh-my-pi/issues/17674)).
- Fixed raw browser `page.waitForFunction` waits timing out after a full-document navigation even when the destination matches the predicate ([#17584](https://github.com/can1357/oh-my-pi/issues/17584))
- Fixed a Ctrl+R history entry picked while an ask dialog's "Other" or note prompt is open landing in the hidden main chat input instead of that prompt ([#17565](https://github.com/can1357/oh-my-pi/issues/17565))
- Bash commands no longer hang on `git rebase -i` when git config sets a `sequence.editor` (an inline `GIT_SEQUENCE_EDITOR=…` still wins), or on Git Credential Manager GUI/browser sign-in prompts ([#17452](https://github.com/can1357/oh-my-pi/pull/17452) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed intercepted bash commands asking for approval before being blocked anyway ([#17502](https://github.com/can1357/oh-my-pi/pull/17502) by [@asuffield](https://github.com/asuffield))
- Fixed `omp --from-claude` listing a Claude Code session renamed with `/rename` by its first prompt; the picker now shows the renamed title and importing the session keeps it ([#17361](https://github.com/can1357/oh-my-pi/pull/17361) by [@namest504](https://github.com/namest504)).
- Auto-learn capture turns now reuse the main turn's prompt cache instead of re-sending the whole conversation uncached: they advertise the same tool list and refuse every call except `learn` and `manage_skill` without running it ([#17418](https://github.com/can1357/oh-my-pi/pull/17418) by [@STRML](https://github.com/STRML)).
- Fixed extensions being unable to replace the background-job completion card with `registerMessageRenderer("async-result", …)`; a registered renderer now owns the card, and the built-in row remains the fallback when none is registered, when one declines, and when one throws ([#17372](https://github.com/can1357/oh-my-pi/pull/17372) by [@AlexBrd999](https://github.com/AlexBrd999), from [#14484](https://github.com/can1357/oh-my-pi/pull/14484) by [@F0Rextasy](https://github.com/F0Rextasy); [#14131](https://github.com/can1357/oh-my-pi/issues/14131))
- Local dictation stops live previews when the speech model repeatedly cannot keep up, so final transcripts no longer wait behind repeated previews ([#17410](https://github.com/can1357/oh-my-pi/issues/17410)).
- ACP clients now receive `_omp/compaction/start` and `_omp/compaction/end` notifications, including failures and cancellations, without requiring an active prompt. ([#16969](https://github.com/can1357/oh-my-pi/issues/16969); [#17384](https://github.com/can1357/oh-my-pi/pull/17384) by [@SAKANA-MOONLIGHT](https://github.com/SAKANA-MOONLIGHT)).
- Fixed `cd` (and `pushd`/`popd`/`z`) failing with `command not found: __zsh_like_cd` in agent shells when `mise activate` or `zoxide init` installed wrapper functions: the shell snapshot now keeps the underscore-prefixed helper functions those wrappers call, instead of dropping every private-looking function ([#17448](https://github.com/can1357/oh-my-pi/pull/17448) by [@KamijoToma](https://github.com/KamijoToma))

## [18.14.2] - 2026-10-31

### Added

- Added `task.perCallModel` (`off` by default, `eval`, `on`) so a task item or an eval `agent()`/`workpool()` call can run on one exact model the operator already names: a chat role from your own (non-project) settings, the selected agent's own model, or the parent's current model. Glob values (`anthropic/*`) never approve a model. `task.perCallModelAllow` narrows that list, `task.maxEffort` caps the worker's effort, and the worker never switches to another model. Project settings can only narrow this: they never turn it on or approve a model ([#12229](https://github.com/can1357/oh-my-pi/pull/12229) by [@Xytronix](https://github.com/Xytronix))
- Added `Settings.reloadFromDisk({ includeParents: true })`, which reloads the persisted settings behind an overlay while keeping the overlay's own overrides ([#12229](https://github.com/can1357/oh-my-pi/pull/12229) by [@Xytronix](https://github.com/Xytronix))

### Changed

- `model` is now declared in every task schema: a task call, eval `agent()` or `workpool()` that passes a model the operator's configuration does not allow is refused with an error ([#12229](https://github.com/can1357/oh-my-pi/pull/12229) by [@Xytronix](https://github.com/Xytronix))
- Viewing a subagent or returning to the main session no longer posts a "Viewing agent …" / "Returned to main session" status (a popup in Tern); the status line and Tern's composer already show which agent is in view
- In a Tern pane, `omp stats` shows the dashboard in place of the block it runs in, with a Close button (or Esc, or Ctrl+C) that stops it and brings the terminal back, and `/stats` opens it in a browser block beside omp, instead of the system browser
- `bash` tool commands now see `PI_TOOL_CALL_ID`, the id of the call running them, so a script the agent runs can point at that call in the session transcript ([#17489](https://github.com/can1357/oh-my-pi/pull/17489) by [@will-bogusz](https://github.com/will-bogusz))
- Native judgments with a configured fallback now move to it after a 3-second candidate deadline (configurable with `judgment.attemptTimeoutMs`) and briefly skip the timed-out route; without a configured fallback a slow judge is never cut off or replaced ([#17465](https://github.com/can1357/oh-my-pi/pull/17465) by [@Xytronix](https://github.com/Xytronix)).

### Fixed

- Fixed a `!` or `$` command run while the agent works floating over the composer in Tern, where expanding its output covered the conversation; it now sits at the end of the conversation
- Fixed `out://` replies sent from an eval cell (`tool.write` to `out://`, or `tool.bash` with `> out://`) never appearing even though the write reported "Shown to the user."; they now draw as replies after the eval card, and are refused where nothing would show them (a backgrounded cell, a browser tab script)
- Fixed a `write` to `out://` (such as `out://baselines.md`) drawing as a Write card with line numbers instead of a reply streaming as prose
- Fixed table charts drawing a `ratio` or `speedup` column as a series beside the timings it was computed from, which read as "719× less" against the baseline
- Fixed `read` of a directory hiding existing `dist`, `build`, `node_modules`, `.git`, and other dependency/build/cache subdirectories, which made them look absent ([#17539](https://github.com/can1357/oh-my-pi/issues/17539))
- Fixed artifact writes reporting the staging-file cleanup error instead of the original short-write or publication failure ([#17485](https://github.com/can1357/oh-my-pi/pull/17485) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed MCP tool calls failing without reconnecting after DNS or socket-open errors ([#17461](https://github.com/can1357/oh-my-pi/pull/17461) by [@Xytronix](https://github.com/Xytronix)).
- Fixed MCP connection timeouts and cancellation allowing a stdio server to start after the connection attempt had already failed. ([#17512](https://github.com/can1357/oh-my-pi/pull/17512) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed ACP updates and extension dialogs switching to an unadvertised session handle after a session reset, and a client reopening a continued conversation after a restart landing on the original session ([#17517](https://github.com/can1357/oh-my-pi/pull/17517) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed IRC coordination cards remaining visible when Hide Tool Activity is enabled, including live messages and replay ([#17498](https://github.com/can1357/oh-my-pi/pull/17498) by [@dannyboy-ai](https://github.com/dannyboy-ai)).
- Fixed a message you queue while the agent waits on `ask` sitting behind the unanswered dialog; the dialog now closes without cancelling the turn, while IRC messages and background completions leave it open ([#17537](https://github.com/can1357/oh-my-pi/issues/17537)).
- Fixed JS eval `output()` ignoring its documented `offset`, `limit`, `query` and `format` options and returning the raw `read` tool result; it now returns the selected text (or the `format: "json"` metadata) like Python's `output()` ([#17455](https://github.com/can1357/oh-my-pi/issues/17455))
- Fixed session lookup losing readable project sessions when an unrelated project folder is unreadable ([#17467](https://github.com/can1357/oh-my-pi/pull/17467) by [@Xytronix](https://github.com/Xytronix)).
- Fixed the advisor resending a byte-identical refused review before trying its model fallback when the review contained no primary reasoning to strip ([#17473](https://github.com/can1357/oh-my-pi/issues/17473))
- Fixed `read` of a whole URL returning no content when the page's first line is over the 50 KB output budget, as on minified pages read with `:raw`; it now shows that line's first 50 KB ([#17500](https://github.com/can1357/oh-my-pi/pull/17500) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed an advisor whose usage-limited account kept being reported as switchable retrying the same capped account thousands of times; it now tries each sibling account at most once per provider per failing review, then falls back, waits, or pauses on the quota ([#17472](https://github.com/can1357/oh-my-pi/issues/17472))
- Fixed LSP definition, type definition, implementation and reference results carrying a stray carriage return on every source context line from files with Windows (CRLF) line endings ([#17549](https://github.com/can1357/oh-my-pi/pull/17549) by [@JustasMasiulis](https://github.com/JustasMasiulis))

## [18.14.1] - 2026-10-31

### Added

- Added the `providers.openai-codex.daybreak` setting (default on) to stop omp from automatically requesting the Daybreak Blue cyber access program on eligible ChatGPT accounts; each session follows its own value ([#17508](https://github.com/can1357/oh-my-pi/pull/17508) by [@H4vC](https://github.com/H4vC))
- Added queueable compaction: `/compact` sent with the follow-up key (Ctrl+Q) while the agent works now runs when it yields instead of interrupting it ([#17397](https://github.com/can1357/oh-my-pi/pull/17397) by [@H4vC](https://github.com/H4vC))
- Added `omp session lease [--json] -- <session-id>...` and the RPC command `get_session_lease`, which report which sessions a running omp owns (`{"held": [...], "unknown": [...]}`) without taking ownership, so another program can check a session without forking it ([#17428](https://github.com/can1357/oh-my-pi/pull/17428) by [@andrebrait](https://github.com/andrebrait))
- Added opt-in `title.refreshAfterPrompts`: every N operator prompts, the judge model checks whether a generated session title still fits the conversation and regenerates it when it does not; user-set titles are never replaced ([#17443](https://github.com/can1357/oh-my-pi/pull/17443) by [@wolfiesch](https://github.com/wolfiesch))
- Gateway rows discovered from `/v1/models` now keep the `reasoning_effort_map` and `reasoning_required` facts they advertise: a route that serves only low/high/max routes `medium` to `high` instead of the nearest lower tier, and a thinking-off request still sends a tier the route accepts ([#17395](https://github.com/can1357/oh-my-pi/pull/17395) by [@Maziar123](https://github.com/Maziar123))
- Computer-use scripts can wait for a window opened by an action and read it in the same call with a window filter's optional `wait` ([#17391](https://github.com/can1357/oh-my-pi/pull/17391) by [@will-bogusz](https://github.com/will-bogusz))

### Changed

- `read` of a web page keeps the title, description, author and dates of its `<meta>` tags and lists the others by name only, so pages cost about 6% fewer tokens ([#17393](https://github.com/can1357/oh-my-pi/pull/17393) by [@will-bogusz](https://github.com/will-bogusz))
- On the Anthropic API, the newest message now keeps all its images up to the 128 MB request limit, past the 120 MB image budget ([#17492](https://github.com/can1357/oh-my-pi/pull/17492) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed account-policy recovery repeatedly rotating through denied credentials instead of surfacing the error or using the configured model fallback, including unnecessary sibling-unblock waits after the account allowance is spent ([#17439](https://github.com/can1357/oh-my-pi/pull/17439) by [@wolfiesch](https://github.com/wolfiesch))
- Startup prewalk now arms a later fallback candidate of the role named by prewalk.into when its first candidate is unavailable, matching /prewalk and /new ([#17373](https://github.com/can1357/oh-my-pi/pull/17373)).
- Fixed `omp install git:github.com/user/repo` treating `git` as the host instead of installing the GitHub plugin ([#17436](https://github.com/can1357/oh-my-pi/issues/17436)).
- Fixed `read` showing a zip, tar, asar or ISO archive's old contents after a same-size rewrite within milliseconds of its previous write, on filesystems with coarse timestamps such as Linux ext4 ([#17389](https://github.com/can1357/oh-my-pi/pull/17389) by [@will-bogusz](https://github.com/will-bogusz))
- Browser `fill` in Chrome replaces the text of rich-text editors such as Slate (Discord) and Lexical instead of leaving the old text in place or breaking the editor, and an empty fill clears them ([#17417](https://github.com/can1357/oh-my-pi/pull/17417) by [@will-bogusz](https://github.com/will-bogusz))
- Requests to the Anthropic API and Factory Droid's hosts now drop their oldest images when long text, tool arguments, or re-declared tool definitions would otherwise push the request past the host's size limit ([#17492](https://github.com/can1357/oh-my-pi/pull/17492) by [@will-bogusz](https://github.com/will-bogusz))
- Factory Droid requests size images against what each route actually sends: Gemini models count their expanded tool schemas and no longer drop images for another model's reasoning, and only Claude models count withdrawn tool definitions ([#17492](https://github.com/can1357/oh-my-pi/pull/17492))

## [18.14.0] - 2026-10-29

### Breaking Changes

- Custom tool loaders now resolve the injected host SDK themselves; constructors take cwd as their first argument instead of a pi namespace.
- WebMCP now uses Chrome's native WebMCP support through WebMcpController, which accepts a Puppeteer Page. The former page-hook installation helpers, bridge constant, and page-hook types have been removed; Tern tabs no longer support WebMCP.
- Provider-qualified model selectors in --model, settings, roles, and task agents must identify an exact model ID or alias. Near matches now fail with a helpful error and suggestions instead of silently selecting a sibling model. Bare selectors such as opus retain fuzzy matching, and the Google Vertex Claude alias remains supported. Older migrated web fallback chains replace the retired Codex entry with openai-codex/gpt-5.6-sol.

### Added

- Agents can send an interim response without ending the current task by writing Markdown to out:// (or using > out:// in bash), with streaming output up to 64 KiB. This is enabled by default in the interactive TUI and can be configured with out.enabled; it is disabled by default in print, RPC, and ACP sessions.
- Added computer-tool approval modes: tools.approval["computer.control"] can allow unattended foreground control on dedicated machines or deny the request without prompting. The approval mode does not itself grant access.
- Added optional task-file input (task.file=true), allowing subagent instructions to be loaded from an absolute UTF-8 file path or local:// URL with the submitted path and SHA-256 recorded ([#17133](https://github.com/can1357/oh-my-pi/pull/17133) by [@iliaal](https://github.com/iliaal)).
- Sessions can be pinned or unpinned from the resume picker with Alt+K and Alt+Shift+K, or the remappable app.session.pin and app.session.unpin actions. Pinned sessions move to the top and take priority in search results ([#9837](https://github.com/can1357/oh-my-pi/pull/9837) by [@zhang17-24](https://github.com/zhang17-24)).
- Added PI_LINK_SCHEME and optional PI_LINK_HOST, allowing file links from SSH or tmux sessions to open through a desktop protocol handler ([#15855](https://github.com/can1357/oh-my-pi/pull/15855) by [@KunoLu](https://github.com/KunoLu)).
- Extensions and RPC clients can start live voice sessions using their own WebRTC peer, including phone-browser clients, through ctx.startLive({ sdpOffer }) or live_connect ([#17013](https://github.com/can1357/oh-my-pi/pull/17013) by [@materemias](https://github.com/materemias)).
- Extensions can customize assistant-text rendering and rerender individual replies through the opt-in extensionRenderers.assistantText setting ([#16238](https://github.com/can1357/oh-my-pi/pull/16238) by [@materemias](https://github.com/materemias)), and can register interactive link schemes with extension callbacks and renderer fallbacks ([#16239](https://github.com/can1357/oh-my-pi/pull/16239) by [@materemias](https://github.com/materemias)).
- /debug reports now include session-logs.txt containing all log records written by the reporting session and its subagents for the current day.
- Added prewalk.from and prewalk.into settings to choose the planning model and handoff target (default @default → @smol); /prewalk [into] and /prewalk restart [from] [into] override them for one command ([#17373](https://github.com/can1357/oh-my-pi/pull/17373) by [@H4vC](https://github.com/H4vC)).

### Changed

- Improved startup responsiveness by deferring nonessential UI, accessibility, browser, provider, slash-command, and interactive-composer loading until needed, and by overlapping independent session preparation work.
- OpenAI live steering is now disabled by default for GPT models. Typed messages wait for the next tool boundary unless providers.openaiLiveSteering is enabled, avoiding unsupported in-flight message errors.
- HTML exports now match the /stats visual design with a higher-contrast light theme, timeline and full-trace views, and navigation for nested subagents and advisors. Packaged viewers use integrity-pinned shared assets and require network access; source checkouts continue to embed the viewer.
- tui.autoGraph now defaults to auto: charts are refined by the judge for supported native TypeSafe judge models and otherwise use the built-in estimate.
- Filesystem changes are detected automatically, so manual scan-cache invalidation after edits is no longer needed.
- Model refreshes use substantially less CPU by reusing unchanged models and avoiding repeated model-cache database opens.
- Overlapping sloppy-edit operations are now applied sequentially, with each operation matched against the result of the preceding operation.
- PI_INTENT_PROMPT and PI_INTENT_DESC can now customize the system guidance and tool-schema description for the i intent field.
- Printed JSON values in eval, including large Python dictionaries and lists, are displayed as collapsible JSON trees.
- Codex and Claude rate-limit reset warnings now appear once per reset across conversations and windows, only during the final six hours; the status line continues to show the countdown.
- The . and c continue shortcuts now simply answer an unanswered last message instead of adding a hidden continue directive.
- With bash.gitGuard enabled, checkout, switch, restore, reset, and stash operations run safely in linked worktrees, while discarded uncommitted changes are preserved for recovery.
- Sessions with computer use enabled receive the desktop guide before the first computer call.
- The Tern interface now presents warnings, errors, update notices, file reads, and completed background work consistently with chat messages.
- Muted live voice sessions remain visibly muted while the voice model starts work.

### Fixed

- Fixed live configuration reloads missing edits immediately after a symlink switches to another file in the same directory.
- Fixed auth-gateway model routing after catalog refreshes so bare model IDs select the highest-priority credentialed provider, with wire-format compatibility used as a tie-breaker.
- Fixed chart recommendations that incorrectly inferred whether higher or lower values were better from row or column names; smart charting now uses the judge and avoids charting unsuitable numeric text such as page or step numbers.
- Fixed binary data flowing through background Bash pipelines being displayed as corrupted text or counted as huge line output.
- Fixed browser-tab closing delays when reattaching after a worker exits.
- Fixed startup warnings being obscured by the Tern interface; they now appear as normal in-app warnings.
- Fixed todo init clearing existing flat items when list was empty.
- Fixed legacy extensions using detached event handlers failing to load.
- Fixed MCP tools connected during vibe mode being activated prematurely and exceeding provider tool limits.
- Fixed Bash services rejecting port 0 when a log readiness condition was also provided.
- Fixed context usage and automatic compaction overstating token usage for inline tool descriptors.
- Fixed terminal titles not being restored after exit on terminals without title-stack support, including Windows consoles.
- Fixed cached approval directory grants that did not cover every target in a request.
- Fixed text typed during startup being delayed until startup completed, including resumed drafts.
- Fixed pull-request metadata and diffs remaining stale after a successful git push.
- Fixed live voice playback clicks when audio stalls mid-word.
- Fixed read rejecting artifact URLs from truncation hints under cached approvals or restricted folders.
- Fixed peer task acknowledgements being mistaken for final answers, so wait continues until the peer replies.
- Failed Hindsight memory recalls and retention operations now produce visible warnings instead of silently continuing without memory.
- Fixed long conflict-path handling, conflict-content selectors, and stale conflict IDs after aborted merges or external file changes.
- Fixed cancelled MCP OAuth flows and authentication lookups from crashing the session.
- Fixed progress HUD entries for idle local-model workers that were no longer used.
- Improved LSP diagnostics reliability across cold starts, push-diagnostics servers, save-only servers, retries, multi-server and multi-file edits, and reopened files; incomplete results are no longer reported as clean, and repeated clangd checks are faster.
- Fixed live job widgets showing incidental text from files, web pages, or search results instead of the actual job status.
- Fixed repeatedly failing advisor batches being retried indefinitely; they are now dropped after three failures.
- Fixed thinking overrides on prefix-bound Claude models from losing their provider prefix behavior during compaction and retries.
- Fixed failed large-value JSON queries from displaying the rejected value instead of a useful error.
- Fixed F5 retry reporting no retry when a background result arrived after cancellation or interruption.
- Fixed WebMCP invocation errors being empty and timed-out page invocations continuing to run.
- Fixed HTTP 413 errors for Factory Droid GPT and Grok after computer-use sessions by removing obsolete screenshots from requests.
- Fixed unavailable configured default or dictation models being silently replaced; omp now warns and identifies the fallback model.
- Fixed LSP references for files in sibling Git worktrees by adding those checkouts to the active workspace.
- Improved macOS computer-use behavior for applications without windows by opening the app and inspecting its returned window in one operation.

## [18.13.3] - 2026-10-28

### Added

- Manual compactions (RPC `compact`, `/compact`, extension `ctx.compact()`) emit `manual_compaction_start` and `manual_compaction_end` session events, so RPC hosts can show compaction progress; `docs/rpc.md` documents these with the other progress events (`retry_fallback_applied`, `ttsr_triggered`, `goal_updated`) ([#17247](https://github.com/can1357/oh-my-pi/pull/17247) by [@Quelaan1](https://github.com/Quelaan1))
- Added `retry.rateLimitWalksChain` (default `false`): with it on, a 429 rate limit after a turn with signed Claude thinking moves to the next model in `retry.fallbackChains` at once instead of retrying the throttled model until `retry.maxRetries` is spent ([#17232](https://github.com/can1357/oh-my-pi/pull/17232) by [@sjawhar](https://github.com/sjawhar))
- Sessions can be renamed from the resume picker: the new title persists as a user title without loading the session, and renames of live sessions are refused instead of forking the transcript ([#17262](https://github.com/can1357/oh-my-pi/pull/17262) by [@Twilight0](https://github.com/Twilight0))
- Added `display.advisorCollapsedLines` (Settings → Appearance → Display) to cap how many note lines a collapsed advisor card shows; the default keeps the full preview ([#17228](https://github.com/can1357/oh-my-pi/pull/17228) by [@bluecapone](https://github.com/bluecapone))
- `omp config list --scope global|project` lists only the keys that layer sets, with the values as written: path-scoped `enabledModels`, `enabledProviders` and `disabledProviders` entries (`{ path, … }`) stay unresolved, so a host can edit the global value without dropping them ([#17246](https://github.com/can1357/oh-my-pi/pull/17246) by [@Quelaan1](https://github.com/Quelaan1))
- `tools.xdevNotices: false` hides the `xd://: mounted …` notices shown as MCP servers connect, without turning on `startup.quiet` ([#17263](https://github.com/can1357/oh-my-pi/pull/17263) by [@MaisonnatM](https://github.com/MaisonnatM))

### Changed

- Updated Bun engine requirement to ≥1.4.4

### Fixed

- A running job's glance keeps the whole a meter counts instead of the bare numerator: a widget whose headline restated `140` beside a `140/190` bar now draws `140/190` in the job card, the HUD pill and the status line ([#17226](https://github.com/can1357/oh-my-pi/pull/17226) by [@iacore](https://github.com/iacore))
- Fixed the managed-skills root guard rejecting a symlinked store outright; a root that resolves to a directory now accepts writes inside its target, while a broken link or a link to a non-directory is still refused ([#17201](https://github.com/can1357/oh-my-pi/pull/17201) by [@iacore](https://github.com/iacore))
- Fixed experimental context rollover repeatedly running during tool calls when the fixed prompt and tool schemas already exceed the recovery band ([#17205](https://github.com/can1357/oh-my-pi/issues/17205))
- Fixed Ctrl+D during deferred extension startup falsely reporting an extension exit error and exiting 1 instead of closing cleanly ([#17259](https://github.com/can1357/oh-my-pi/issues/17259)).
- Resuming a session, or reviving a parked or restored subagent, after a prewalk or plan-yolo handoff continues on the model and effort the handoff switched to instead of falling back to the planning model ([#17229](https://github.com/can1357/oh-my-pi/pull/17229) by [@shgew](https://github.com/shgew))
- Fixed one interrupt silently stopping a session from ever waking on its own background job results again: an interrupt (Esc, the RPC `abort` command, an ACP cancel, a collab guest stop, an extension's `ctx.abort()`) that stops no run and no queued work no longer suppresses those wakes, and after an interrupt that did stop a run they come back once a later turn has run and ended. Esc on the "waiting on background jobs" row still ends that wait: its results land in context for your next prompt, as before ([#17243](https://github.com/can1357/oh-my-pi/pull/17243) by [@sjawhar](https://github.com/sjawhar))
- Fixed `!` commands on zsh/fish waiting forever at interactive prompts (e.g. the Oh My Zsh update question on `!code .`); keystrokes now go to the running command while it runs, and Esc still cancels ([#17210](https://github.com/can1357/oh-my-pi/issues/17210))
- Fixed auto-compaction firing early on OpenAI-compatible chat-completions models that don't replay past reasoning ([#15797](https://github.com/can1357/oh-my-pi/issues/15797), [#17231](https://github.com/can1357/oh-my-pi/pull/17231) by [@ghisguth](https://github.com/ghisguth))
- Eval's `tool.<name>(…)` now accepts `xd://<name>` and the Claude Code `mcp__<server>__<tool>` spelling like direct tool calls, and reports registered but unavailable tools instead of "Unknown tool" ([#17250](https://github.com/can1357/oh-my-pi/issues/17250))
- Updated the `ask` prompt to encourage assistants to show missing decision context before the dialog opens ([#17242](https://github.com/can1357/oh-my-pi/pull/17242) by [@jasonharrison](https://github.com/jasonharrison))
- Custom LiteLLM providers now refresh cached model rosters after paginated `/v2/model/info` discovery was fixed; cached first-page-only lists no longer hide later-page models ([#17237](https://github.com/can1357/oh-my-pi/pull/17237) by [@maykonmichel](https://github.com/maykonmichel)).
- Fixed hosted search repeating the same request when the active model is also its search target but uses a cloned or refitted model object ([#17202](https://github.com/can1357/oh-my-pi/pull/17202) by [@mateo-bolanos](https://github.com/mateo-bolanos)).
- Fixed a killed or failed inline browser tab worker keeping its connection to the browser relay, which left Chrome's "started debugging this browser" bar on every tab until the omp session exited ([#17212](https://github.com/can1357/oh-my-pi/pull/17212) by [@nickzitzer](https://github.com/nickzitzer))
- Fixed a live tool card dropping the model's `i` intent, which the harness strips from the args `tool_execution_start` carries; the card now keeps it, so a bash call in Tern shows its description instead of a bare "Bash" as it already did in a resumed session ([#17197](https://github.com/can1357/oh-my-pi/pull/17197) by [@iacore](https://github.com/iacore))
- RPC sessions now report settled (`isSettled: true`, `session_settled`) after a turn whose failed `todo` call queued a reminder for the next prompt, instead of appearing busy until another prompt arrives ([#17238](https://github.com/can1357/oh-my-pi/pull/17238) by [@kmccleary3301](https://github.com/kmccleary3301))
- `/annotate` keeps notes and an unfinished note when the overlay is closed without sending them: reopening the same source restores them, **Saved draft** resumes any of the session's drafts, and **Discard notes and close** drops one ([#17271](https://github.com/can1357/oh-my-pi/pull/17271) by [@H4vC](https://github.com/H4vC), based on [#17230](https://github.com/can1357/oh-my-pi/pull/17230) by [@Shadorain](https://github.com/Shadorain)).
- Annotation feedback names each note's source line, so notes on blank or repeated lines stay distinguishable ([#17271](https://github.com/can1357/oh-my-pi/pull/17271) by [@H4vC](https://github.com/H4vC), based on [#17230](https://github.com/can1357/oh-my-pi/pull/17230) by [@Shadorain](https://github.com/Shadorain)).
- Fixed `/tan` clones ending without a final answer when they call `ask`; the clone now keeps running and the parent receives its final answer instead of an empty result ([#17223](https://github.com/can1357/oh-my-pi/pull/17223) by [@trukhinyuri](https://github.com/trukhinyuri))
- Pasting in a terminal with enhanced paste (Tern, kitty) now lands in the open dialog's field — the agents hub's New agent description, an /annotate note — instead of the hidden prompt
- Pasting or dropping an image file into the prompt in a terminal with enhanced paste (Tern, kitty) now attaches the image instead of typing its path
- The plan review's edit button in Tern names your editor ("Edit in Notepad", "Edit in nvim") instead of "Edit in $EDITOR"
- Fixed `/tan` clones ending without a final answer when they call `ask`; the clone now keeps running and the parent receives its final answer instead of an empty result ([#17223](https://github.com/can1357/oh-my-pi/pull/17223) by [@trukhinyuri](https://github.com/trukhinyuri))
- Fixed GitHub `/review` diff links keeping the snapshot that built the request after the cached diff refreshes in the background, instead of opening whatever file now sits at the same index ([#16310](https://github.com/can1357/oh-my-pi/pull/16310) by [@tkossak](https://github.com/tkossak))

Older entries are archived in [packages/coding-agent/CHANGELOG.md@529c1841b699](https://github.com/can1357/oh-my-pi/blob/529c1841b6990b8c014aa79bac60ac2d54fbaf83/packages/coding-agent/CHANGELOG.md).
