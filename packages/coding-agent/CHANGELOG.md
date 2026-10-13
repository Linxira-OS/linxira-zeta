## [Unreleased]

- The welcome tips are guarded against silently going untranslated: a new `packages/coding-agent/test/i18n-tips-coverage.test.ts` proves every non-blank `tips.txt` line has a `tipN` entry in **both** catalogues, that the English value is that line verbatim (minus the `[NEW]` marker, exactly like the runtime fallback), and that neither translation drops the line's `{key:…}`/`{tap:…}` render placeholders. `scripts/check-i18n-consistency.ts` only compared en against zh, so one line falling out of step (no key at all, or a key that no longer tracks its line — the drift that left the `#`/`/`/`!`/`$`, `jevify` and self-reconfigure tips English in every language) stayed green.

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
