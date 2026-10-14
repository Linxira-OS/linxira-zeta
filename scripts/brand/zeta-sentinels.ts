/**
 * Zeta-only code sentinels — machine-checkable registry of symbols and
 * literals that exist only in Zeta (upstream OMP has no counterpart).
 *
 * The #4 merge-damage class (AGENTS.md post-merge checklist) is silent
 * deletion of Zeta-only code during OMP release merges: a `--theirs` on a
 * shared file keeps compiling but drops the session-layer mode API, the sdk
 * sinks, the tracking path helpers, etc. — `check:ts` catches some of it, but
 * only when a *consumer* happens to live in the merged tree. This registry
 * checks the definitions themselves.
 *
 * Merge procedure (document/merge-review.md): after an OMP tag merge, run
 * `bun scripts/check-zeta-sentinels.ts`. Every entry must exist or the merge
 * cannot leave the sync branch. Extend this list whenever new Zeta-only
 * surface lands (any file a future merge could take from --theirs wholesale).
 */

export interface Sentinel {
	/** Repo-relative file containing the sentinel. */
	file: string;
	/** Literal substring that must appear in the file (symbol or unique literal). */
	symbol: string;
	/** What it is and why losing it matters. */
	why: string;
}

export const ZETA_SENTINELS: Sentinel[] = [
	// -- Session layer: mode API (web-gateway/ACP external clients) ------------
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: 'export type ModeId = "plan" | "goal" | "vibe";',
		why: "shared ModeController API for external clients (CLI mode + gateway)",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "getModeState(mode: ModeId)",
		why: "external-state contract: current snapshot for a mode",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async enterMode(mode: ModeId",
		why: "shared ModeController entry (CLI and external clients)",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async exitMode(mode: ModeId",
		why: "shared ModeController exit (CLI and external clients)",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async enterPlanMode(",
		why: "session-layer plan mode entry (headless clients)",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async exitPlanMode(",
		why: "session-layer plan mode exit with journaling + rollback",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async enterGoalMode(",
		why: "session-layer goal mode entry",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async exitGoalMode(",
		why: "session-layer goal mode exit with tool restore",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async enterVibeMode(",
		why: "session-layer vibe mode entry returning the owner scope",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async exitVibeMode(",
		why: "session-layer vibe mode exit",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "getStateVersion(): number",
		why: "external-state contract: monotonic mode/model state version",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "bumpStateVersion(): number",
		why: "external-state contract: state version bump + state_version_changed event",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async getPlanFileContent(",
		why: "external clients read the plan file through the session",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "resetModeTransientState(): void",
		why: "transient plan/model state reset on session transitions",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async flushPendingModelSwitch(): Promise<void>",
		why: "deferred model switch applied after the current stream ends",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "async restorePlanPreviousModel(",
		why: "captured pre-plan model state restore (streaming-deferred)",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "#stateVersion = 0;",
		why: "external-state version field backing the mode API",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "setIrcAutoReplyListener(listener: ((msg: IrcMessage, replyText: string) => void) | null): void",
		why: "IRC auto-reply wiring consumed by packages/channels host",
	},
	// -- Session replication surface (collab/multi-end sync) -------------------
	{
		file: "packages/coding-agent/src/session/session-manager.ts",
		symbol: "ingestReplicatedEntry(entry: SessionEntry): void",
		why: "collab/multi-end replication ingest path",
	},
	{
		file: "packages/coding-agent/src/session/session-manager.ts",
		symbol: "snapshotForReplication(): { header: SessionHeader; entries: readonly SessionEntry[] }",
		why: "collab/multi-end replication snapshot path",
	},
	{
		file: "packages/coding-agent/src/session/session-manager.ts",
		symbol: "onEntryAppended?: (entry: SessionEntry) => void;",
		why: "durable-entry hook consumed by the web-gateway session sync",
	},
	// -- SDK sinks (web/desktop coordinator sessions) --------------------------
	{
		file: "packages/coding-agent/src/sdk.ts",
		symbol: "channelSend?: (opts: { text: string; to?: string; channel?: string }) => Promise<void>;",
		why: "IM channel_send tool sink for web/desktop coordinator sessions",
	},
	{
		file: "packages/coding-agent/src/sdk.ts",
		symbol: "workspaceRun?: (opts: { workspace: string; task: string }) => Promise<{ reply: string }>;",
		why: "workspace_run tool sink for coordinator sessions",
	},
	{
		file: "packages/coding-agent/src/sdk.ts",
		symbol: "imControl?: (params: ImControlParams) => Promise<ImControlResult>;",
		why: "im_control tool sink for relay sessions",
	},
	// -- Gateway / channels runtime --------------------------------------------
	{
		file: "packages/coding-agent/src/server/web-gateway/agents.ts",
		symbol: "export class AgentSessionWrapper {",
		why: "web-gateway per-session event fan-out wrapper",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/agents.ts",
		symbol: "export async function startRpcSession(",
		why: "web-gateway session lifecycle entry (web-ui startRpcSession mirror)",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway.ts",
		symbol: "export async function webGatewayFetch(req: Request, remoteAddr?: string): Promise<Response>",
		why: "gateway fetch handler shared by zeta serve and the standalone listener",
	},
	{
		file: "packages/channels/src/index.ts",
		symbol: "export function getMainSessionId(): string | null {",
		why: "serve coordinator session id bridge (/api/agent/current)",
	},
	{
		file: "packages/coding-agent/src/channels/session-router.ts",
		symbol: "export class SessionRouter {",
		why: "IM channel workspace/coordinator routing",
	},
	{
		file: "packages/channels/src/index.ts",
		symbol: "export function getPendingWechatQr(): WeChatQrStatus | null {",
		why: "WeChat QR login status bridge (gateway route)",
	},
	{
		file: "packages/channels/src/index.ts",
		symbol: "export function triggerWechatReconnect(): Promise<void> | null {",
		why: "WeChat reconnect trigger bridge (gateway route)",
	},
	// -- Tracking ---------------------------------------------------------------
	{
		file: "packages/utils/src/dirs.ts",
		symbol: "export function getProjectTrackingDir(cwd: string = getProjectDir()): string {",
		why: "project tracking dir (<project>/.zeta/tracking) resolution",
	},
	{
		file: "packages/utils/src/dirs.ts",
		symbol: "export function getTrackingIndexPath(agentDir?: string): string {",
		why: "global tracking index (~/.zeta/agent/tracking-index.json) resolution",
	},
	{
		file: "packages/coding-agent/src/tools/tracking.ts",
		symbol: "export class TrackingRecorder {",
		why: "tracking file writer (status/INDEX/actions/sessions)",
	},
	{
		file: "packages/coding-agent/src/tools/tracking.ts",
		symbol: "export class TrackingTool implements AgentTool<typeof trackingSchema, TrackingToolDetails> {",
		why: "tracking_update tool",
	},
	{
		file: "packages/coding-agent/src/tools/tracking.ts",
		symbol: "function trackingLockPath(dir: string): string {",
		why: "status.json read-modify-write lease (the lock covers the whole RMW, not just the write)",
	},
	{
		file: "packages/coding-agent/src/tools/tracking-actions-log.ts",
		symbol: "export function appendTrackingActionRow(dir: string, row: string): void {",
		why: "bounded action log: append through the size-rotating sink (5 MB × 3) with a bounded tail read for readers",
	},
	{
		file: "packages/coding-agent/src/tools/builtin-names.ts",
		symbol: '"tracking_update",',
		why: "tracking tool registered in the builtin tool name table",
	},
	{
		file: "packages/coding-agent/src/tools/settings.ts",
		symbol: 'id: "tracking.enabled"',
		why: "tracking tool gate setting (registry, since v18.3.1)",
	},
	{
		file: "packages/coding-agent/src/tools/index.ts",
		symbol: "tracking_update: s => new TrackingTool(s),",
		why: "tracking tool registration in BUILTIN_TOOLS (upstream-owned file)",
	},
	{
		file: "packages/coding-agent/src/tools/index.ts",
		symbol: 'if (name === "tracking_update") return cfgTrackingEnabled.get(session.settings);',
		why: "tracking_update is opt-in: the settings gate lives in the shared isToolAllowed (upstream-owned file)",
	},
	{
		file: "packages/coding-agent/src/session/todo-tracker.ts",
		symbol: 'this.#host.getActiveToolNames().includes("tracking_update")',
		why: "todo-phase tracking mirror nudge guard (upstream-owned file)",
	},
	{
		file: "packages/coding-agent/src/session/prewalk.ts",
		symbol: "await mirrorPlanToTracking({",
		why: "approved-plan mirror into tracking/plans (upstream-owned file)",
	},
	{
		file: "packages/coding-agent/src/prompts/system/plan-mode-approved.md",
		symbol: '{{#has tools "tracking_update"}}',
		why: "plan-approved prompt teaches the tracking phase mirror only when the tool is present (upstream-owned file)",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway.ts",
		symbol: "const TRACKING_RE = /^\\/api\\/tracking\\/?$/;",
		why: "tracking point-in-time read route constant / dispatch wiring",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway.ts",
		symbol: "const TRACKING_EVENTS_RE = /^\\/api\\/tracking\\/events$/;",
		why: "tracking SSE route constant / dispatch wiring",
	},
	{
		file: "packages/coding-agent/src/config/settings-schema.ts",
		symbol: '"tracking.enabled": {',
		why: "schema twin of the tracking setting — keeps it in the web settings panel (getPathsForTab) and the AppShell dock gate",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/tracking.ts",
		symbol: "export async function handleTrackingEvents(req: Request): Promise<Response> {",
		why: "tracking SSE watcher handler (tracking_changed notification)",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/tracking.ts",
		symbol:
			"function deriveTrackingUpdatedAt(trackingDir: string, markdown: readonly { mtimeMs: number }[]): string {",
		why: "content-derived tracking freshness stamp (newest file mtime, not the request clock)",
	},
	// -- Tracking web-ui surface (vendored from omp-web: these files are
	//    upstream-owned copies, so a re-vendor can silently drop the panel) -----
	{
		file: "web-ui/components/shell/panel-registry.tsx",
		symbol: 'titleKey: "dock.window.tracking"',
		why: "tracking dock entry label (tracking.enabled-gated dock window; registry-driven rail)",
	},
	{
		file: "web-ui/components/TrackingPanel.tsx",
		symbol: "export function TrackingMarkdownList({",
		why: "tracking sub-tab markdown listing — carries the Summaries tab that used to be declared but never rendered",
	},
	{
		file: "web-ui/components/TrackingPanel.tsx",
		symbol: '{ id: "summaries", labelKey: "tracking.tab.summaries" },',
		why: "summaries sub-tab entry in the tracking panel",
	},
	{
		file: "web-ui/lib/i18n/messages/en.ts",
		symbol: '"tracking.tab.summaries": "Summaries"',
		why: "EN label for the tracking Summaries tab",
	},
	{
		file: "web-ui/lib/i18n/messages/zh-CN.ts",
		symbol: '"tracking.tab.summaries": "摘要"',
		why: "zh-CN label for the tracking Summaries tab",
	},
	{
		file: "web-ui/lib/i18n/messages/en.ts",
		symbol: '"dock.window.tracking": "Tracking"',
		why: "EN dock label for the tracking window",
	},
	{
		file: "web-ui/lib/i18n/messages/zh-CN.ts",
		symbol: '"dock.window.tracking": "追踪"',
		why: "zh-CN dock label for the tracking window",
	},
	{
		file: "web-ui/next.config.ts",
		symbol: '"/api/tracking/:path*"',
		why: "beforeFiles rewrite routing /api/tracking + /events to the runtime gateway",
	},
	// -- Web chat surface: ```svg figures -----------------------------------------
	{
		file: "packages/coding-agent/src/sdk.ts",
		symbol: "chatSvgRendering?: boolean;",
		why: "Zeta-only prompt surface flag: the web UI draws ```svg fences, so serve/web-gateway sessions advertise them. Upstream OMP gates every visual on tuiTranscript, so a merge taking sdk.ts wholesale leaves browser clients the only surface that cannot draw what the prompt promises.",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/agents.ts",
		symbol: "chatSvgRendering: true,",
		why: "the serve/web-gateway session path is what sets the flag above (every web/desktop session funnels through startRpcSession); losing the line silently reverts browser chats to text-only replies",
	},
	{
		file: "web-ui/components/SvgBlock.tsx",
		symbol: "export function SvgBlock(",
		why: "web-ui renders ```svg fences as figures (vendored file: a re-vendor drops the block, and every emitted figure degrades to a code block)",
	},
	{
		file: "web-ui/components/MarkdownBody.tsx",
		symbol: 'lang === "svg"',
		why: "the markdown renderer's ```svg branch, closed fences only — without it an emitted SVG fence stays plain code even with SvgBlock present",
	},
	{
		file: "web-ui/lib/svg-sanitize.ts",
		symbol: 'FORBID_TAGS: ["script", "foreignObject", "style"],',
		why: "the security contract for model-authored ```svg: the SVG profile alone, no script/foreignObject/style elements, and (via the afterSanitizeAttributes hook) no reference that leaves the figure. A weakened or dropped policy is an XSS surface on the gateway",
	},
	{
		file: "web-ui/app/globals.css",
		symbol: "--c6: var(--zeta-alias-chart-6);",
		why: "the theme-token aliases a ```svg figure paints with (the prompt promises --fg/--muted/--accent/--c1…); web-ui defines none of those names natively, so losing the scope leaves every figure colorless. The right-hand side is the L2 alias layer — L1 `--chart-6` still resolves through the compat bridge, but the alias is what the three-layer scheme (lib/theme/tokens.ts) puts in feature CSS",
	},
	// -- Cross-client session provenance -------------------------------------------
	{
		file: "packages/coding-agent/src/session/session-entries.ts",
		symbol: "client?: SessionClient;",
		why: "Zeta-only provenance stamp on the durable session header (+ the NewSessionOptions seed). Upstream OMP's header has no notion of the client that created a session, so a wholesale take silently drops the field and every session reads as pre-stamp.",
	},
	{
		file: "packages/coding-agent/src/session/session-manager.ts",
		symbol: "client: options?.client ?? this.#header?.client,",
		why: "the /new, branch and fork inheritance rule: a session created from inside a client stays that client's. Without it every /new would lose its provenance even though the field still exists.",
	},
	{
		file: "packages/coding-agent/src/main.ts",
		symbol: 'const CLI_SESSION = { client: "cli" } as const;',
		why: "the CLI/ACP entry stamp (terminal sessions and editor-hosted ACP sessions); the terminal CLI is the one entry point whose sessions the SDK creates, so the seed is also passed as CreateAgentSessionOptions.client",
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/agents.ts",
		symbol: 'client: SessionClient = "web",',
		why: 'startRpcSession\'s default provenance for the gateway\'s own callers (the web UI), with the serve coordinator passing "desktop"/"automation" explicitly',
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/desktop.ts",
		symbol: "export function serveSessionClient(",
		why: "ZETA_DESKTOP-based desktop-vs-automation provenance for the sessions a serve process creates (coordinator + IM bot sessions)",
	},
	// -- Brand surface (duplicate of brand-check MUST_CONTAIN but merges can hit
	//    files brand-check skips, and these need per-merge re-verification) -----
	{
		file: "packages/coding-agent/src/utils/title-generator.ts",
		symbol: 'const DEFAULT_TERMINAL_TITLE = "ζ";',
		why: "CLI terminal title brand character (registry row 1)",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		symbol: "export const ZETA_LOGO",
		why: "ζ char-art product logo surface (v18.0.3 lesson)",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		symbol: 'ZETA_LOGO = ["████████████", "   ████████ ", "  ████████  ", " ████████▒▒▒", "████████████"]',
		why: "block-grid ζ mark (5 rows × 12 cols, █/▒) of the welcome/splash lockup — redrawn 2026-10-13 in upstream's block-grid geometry so the mark takes the lockup's 5-row slot (wordmark beside it, version under it) and the same 2x splash look as upstream; pins the exact rows so a merge cannot revert to the old box-drawing art or upstream's π mark",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		symbol: 'const WORDMARK = ["███▀         ▄        ", " ██   ███▄  ███   ▄██▄", "▄▄██  █▄▄    █▄   █▄▄█"];',
		why: 'half-block `Zeta` wordmark of the welcome lockup (registry: wordmark "Z e t a"); pins the exact rows so a merge cannot swap in upstream\'s `omp` wordmark',
	},
	{
		file: "packages/tui/src/theme/symbols.ts",
		symbol: '"icon.omp": "ζ",',
		why: "status-line brand icon (registry: icon.omp=ζ)",
	},
	// -- Desktop shell (Electron, no upstream counterpart) ----------------------
	{
		file: "desktop/src/main.ts",
		symbol: "function resolveServeCommand(): ServeCommand | null {",
		why: "desktop runtime resolution (bundled zeta serve)",
	},
	{
		file: "desktop/src/main.ts",
		symbol: "function createWindow(prefs: TrayPrefs): BrowserWindow {",
		why: "desktop window lifecycle",
	},
	{
		file: "desktop/src/main.ts",
		symbol: "function buildMenu(labels: DesktopLabels): void {",
		why: "desktop menu surface",
	},
	{
		file: "desktop/src/main.ts",
		symbol: "async function boot(): Promise<void> {",
		why: "desktop boot sequence (serve spawn + tray + window)",
	},
	{
		file: "desktop/src/main.ts",
		symbol: 'const WEB_UI_URL = "http://127.0.0.1:30141";',
		why: "desktop ↔ web-ui loopback contract. Asserts the declaration literal is still present verbatim in the file (presence, not usage): removing or renaming the constant fails here. Whether the shell actually loads this value is not what this sentinel proves — the effective service origins may be adopted from a discovered instance, so keep the const as the canonical default and initialize the runtime value from it.",
	},
	// -- Launch/broker: unowned oneshot daemon sweep -------------------------------
	{
		file: "packages/coding-agent/src/launch/broker.ts",
		symbol: "#stopUnownedOneShotDaemons",
		why: "Zeta-only fix: the idle sweep stops non-`persist`, non-`detached` daemons once no client and no project presence remain, so the project-shared Chromium (a `persist: false` daemon whose process IS Chrome) cannot outlive zeta. Upstream OMP still vetoes the whole shutdown on `livePersistent` (issues #14379, #15014), so a merge taking their broker.ts wholesale reopens the leaked-headless-Chrome class.",
	},
	// -- Pull-driven memory-pressure shed ------------------------------------------
	{
		file: "packages/coding-agent/src/task/memory-shed.ts",
		symbol: "export async function shedUnderMemoryPressure(",
		why: "Zeta-only pull-driven memory shed (roadmap M3a): the repo has no push-style memory-pressure event, so shedding hangs off the checkpoints that already sample (spawn permit, workpool limit, turn end). Upstream OMP has no counterpart, so a merge that takes these files wholesale silently drops the whole shed (caches, idle tabs, mnemopi worker, idle broker daemons).",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "void this.#shedMemoryAtTurnEnd();",
		why: "Zeta-only turn-end shed checkpoint (roadmap M3a). agent-session.ts is a shared file a merge can take wholesale; losing only this line leaves the module compiling but the turn-end sample unreachable, so memory shedding would only fire on spawn/workpool decisions.",
	},
	// -- Agent-side mode switching (`mode` tool) -----------------------------------
	{
		file: "packages/coding-agent/src/tools/mode.ts",
		symbol: "export class ModeTool",
		why: "Zeta-only tool: the agent may enter plan mode and leave only the plan mode it entered. Upstream OMP has no agent-side mode switch (the session-layer `enterMode`/`exitMode` API itself is already Zeta-only), so a merge taking tools/index.ts or the session wholesale drops the whole surface.",
	},
	{
		file: "packages/coding-agent/src/tools/index.ts",
		symbol: "mode: s => new ModeTool(s),",
		why: "registration line for the `mode` tool — the file survives a merge, so losing only this line would leave the tool unreachable while the class still compiles",
	},
	{
		file: "packages/coding-agent/src/plan-mode/state.ts",
		symbol: 'enteredBy?: "user" | "agent";',
		why: 'provenance of a plan-mode entry: absent means the user (all CLI/web/ACP callers), "agent" only from the `mode` tool. Losing it makes every plan mode look user-armed (safe) or, with a wholesale upstream take, makes the tool\'s exit check impossible.',
	},
	{
		file: "packages/coding-agent/src/prompts/system/system-prompt.md",
		symbol: '{{#has tools "github"}}- GitHub (CI runs, PRs, issues, search)',
		why: "Zeta-only rule: GitHub/Gitea work goes through the `github`/`tea` tools, never shell `gh`/`tea` (CI polling via `op: run_watch`). Upstream's Specialized Tools list covers files/search/LSP but has no host-CLI entry, so an upstream take of this file silently restores the shell-`gh` habit the CI-green prompt already tried to prevent.",
	},
	// -- bash: elevated commands + credential policy -------------------------------
	{
		file: "packages/coding-agent/src/prompts/tools/bash.md",
		symbol: "Elevated commands (`sudo`/UAC): user-consented only, NEVER silent.",
		why: "Zeta-only rule (2026-10-12 user decision): the elevated-command recipes (`pty: true` overlay; popped-out `-Verb RunAs` / `x-terminal-emulator` window) and the per-target credential policy exist upstream only in `docs/tools/bash.md`, which the model reads on demand — this prompt line is what makes it follow them instead of guessing at shell `sudo`.",
	},
	{
		file: "docs/tools/bash.md",
		symbol: "keep **in context memory** and reuse for that target",
		why: "Zeta-only credential policy (2026-10-12 user decision): a target inside the operator's own boundary (this machine, a container here) may have its SSH key / root password held in context memory and reused, but NEVER written to any file; upstream's rule is a flat \"never store or echo credentials\". An upstream take of this doc silently re-tightens it and contradicts the prompt line above.",
	},
	// -- Custom commands: hot reload -----------------------------------------------
	{
		file: "packages/coding-agent/src/extensibility/custom-commands/watcher.ts",
		symbol: "export class CustomCommandWatcher {",
		why: "Zeta-only command hot reload: upstream (re)loads TypeScript custom commands only at session construction, so an upstream take of the custom-commands directory drops live reload with no compile error left behind.",
	},
	{
		file: "packages/coding-agent/src/extensibility/custom-commands/loader.ts",
		symbol: "async function commandImportSpecifier(commandPath: string): Promise<string> {",
		why: "cache-bust for the command module import: without the `?mtime` tag a reload re-imports the first evaluation out of Bun's module cache and every edit is silently ignored (see the Windows caveat in docs/extension-loading.md).",
	},
	{
		file: "packages/coding-agent/src/session/agent-session.ts",
		symbol: "applyCustomCommandReload(result: CustomCommandsLoadResult): void {",
		why: "keep-last-good adoption of a reloaded command set plus the command-metadata notification; an upstream take of agent-session.ts drops the reload path while the watcher keeps running.",
	},
	{
		file: "packages/coding-agent/src/sdk.ts",
		symbol: "void customCommandWatcher.start();",
		why: "main-session watcher wiring — sdk.ts survives a merge, so losing only this line leaves `CustomCommandWatcher` unreachable and hot reload silently dead.",
	},
	// -- CLI command table: Zeta-only subcommands --------------------------------
	//
	// Set-difference against the integrated-through upstream tag (v18.9.2 at the
	// time of writing): `serve` is the ONLY name in the table upstream does not
	// have. The other 51 entries survive a `--theirs` take because upstream
	// carries them too — so they need no sentinel here, and a name that appears
	// upstream cannot be "silently dropped" by a merge in the first place.
	{
		file: "packages/coding-agent/src/cli-commands.ts",
		symbol: 'name: "serve",',
		why: 'Zeta-only subcommand (`zeta serve` hosts the web gateway + desktop sessions; upstream OMP\'s table has no `serve`). It vanished from this table during the 1.2.0 upstream merge: `serveHelp` in cli/command-help.ts survived while the entry did not, `isSubcommand("serve")` returned false, and every desktop smoke failed — visible only in release runs. The table is a shared file a merge can take wholesale.',
	},
	// -- Native sentinel ----------------------------------------------------------
	{
		file: "crates/pi-natives/src/lib.rs",
		symbol: "pub fn pi_natives_build_version() -> Option<String> {",
		why: "natives build-version mechanism (v18.3.3: stamped `__piNativesBuildVersion()` replaces the per-release `__piNativesVX_Y_Z` name; checked by version-consistency)",
	},
	// -- CI: committed-generated-file freshness gates ----------------------------
	{
		file: ".github/workflows/generated-freshness.yml",
		symbol: "bun run check:nix-bun",
		why: "Zeta-only early-feedback gate for the generated nix/bun.nix: PR #181 shipped a stale expression and only the slow `Zeta Nix` flake job caught it. Upstream has no such workflow, so a merge that trims `.github/workflows` would silently re-open the gap (the flake check stays, but reports it minutes later).",
	},
	{
		file: ".github/workflows/generated-freshness.yml",
		symbol: "bun run check:relay-assets",
		why: "Same class for the committed browser-relay embeds (`extension-assets/*.txt`): nothing regenerated them outside the release job, so the copies drifted with only a license test noticing. Zeta-only workflow — a merge must not drop the second job.",
	},
];
