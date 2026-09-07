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
		symbol: "snapshotForReplication(): { header: SessionHeader; entries: SessionEntry[] }",
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
		file: "packages/coding-agent/src/tools/builtin-names.ts",
		symbol: '"tracking_update",',
		why: "tracking tool registered in the builtin tool name table",
	},
	{
		file: "packages/coding-agent/src/config/settings-schema.ts",
		symbol: '"tracking.enabled"',
		why: "tracking tool gate setting",
	},
	// -- Brand surface (duplicate of brand-check MUST_CONTAIN but merges can hit
	//    files brand-check skips, and these need per-merge re-verification) -----
	{
		file: "packages/coding-agent/src/utils/title-generator.ts",
		symbol: 'const DEFAULT_TERMINAL_TITLE = "ζ";',
		why: "CLI terminal title brand character (registry row 1)",
	},
	{
		file: "packages/coding-agent/src/modes/components/welcome.ts",
		symbol: "export const ZETA_LOGO",
		why: "ζ char-art product logo surface (v18.0.3 lesson)",
	},
	{
		file: "packages/coding-agent/src/modes/theme/symbols.ts",
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
		why: "desktop ↔ web-ui loopback contract",
	},
	// -- Native sentinel ----------------------------------------------------------
	{
		file: "crates/pi-natives/src/lib.rs",
		symbol: "pub const fn pi_natives_version_sentinel() {}",
		why: "natives version sentinel function (per-release `__piNativesVX_Y_Z` name checked by version-consistency)",
	},
];
