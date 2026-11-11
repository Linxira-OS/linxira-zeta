/**
 * Web Gateway — Bun HTTP entry for runtime-backed web-ui APIs.
 *
 * Route ownership is defined in `document/web-gateway.md`. W1 serves the
 * sessions family, W2 the agent family, W3 the auth + models families, W4
 * the skills + plugins families; unclaimed `/api/*` stays 404
 * (`{ error: "Not implemented" }`).
 *
 * Two access paths share one handler:
 * - `zetacode serve` → ZetaServer dispatches `webGatewayFetch` in-process for
 *   `/api/*` before proxying to Next.
 * - `next dev` / `next start` standalone → next.config `beforeFiles` rewrites
 *   forward the gateway-owned families to the standalone listener started by
 *   `startWebGateway()` on 127.0.0.1 (`ZETA_WEB_GATEWAY_PORT`, default 43143).
 */

import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv, ZETA_GATEWAY_PORT } from "@linxiraos/pi-utils";
import { getMainSessionId } from "../channels";
import { scheduleTrashSweep } from "../session/session-trash";
import {
	handleAgentCommand,
	handleAgentEvents,
	handleAgentNew,
	handleAgentState,
	handleGlobalExtensionUiResponse,
	handleRunningEvents,
} from "./web-gateway/agents";
import {
	handleSubagentEvents,
	handleSubagentOutput,
	handleSubagentRoster,
	handleSubagentTranscript,
} from "./web-gateway/subagents";
import { handleTeamAgentsGet } from "./web-gateway/team";
import { handleArchiveSession, handleListArchivedSessions, handleUnarchiveSession } from "./web-gateway/archive";
import {
	handleAllProviders,
	handleApiKeyDelete,
	handleApiKeyGet,
	handleApiKeyPost,
	handleLoginGet,
	handleLoginPost,
	handleLogout,
	handleOAuthProviders,
} from "./web-gateway/auth";
import { handleBlobGet } from "./web-gateway/blobs";
import {
	handleBoardCreate,
	handleBoardDelete,
	handleBoardGet,
	handleBoardHandoff,
	handleBoardList,
	handleBoardMove,
	handleBoardUpdate,
} from "./web-gateway/board";
import {
	authenticateRemote,
	credentialScopes,
	isGenuinelyLocalRequest,
	type RemoteCredential,
	resolveCredential,
} from "./web-gateway/remote-access";
import { sessionStore } from "./auth/session-store";
import { handleDeviceDelete, handleDevicesGet, handleDevicesRevokeAllPost } from "./auth/device-auth";
import {
	forgetAllVerifications,
	forgetDeviceVerification,
	guardGatewayTwoFactor,
	handleTwoFactorConfirmPost,
	handleTwoFactorDisablePost,
	handleTwoFactorEnrollPost,
	handleTwoFactorPolicyPut,
	handleTwoFactorRecoveryRegeneratePost,
	handleTwoFactorStatusGet,
	handleTwoFactorVerifyPost,
} from "./auth/two-factor-auth";
import { handleChannelCredentials, handleChannelSend, renderWechatLoginQrSvg } from "./web-gateway/channels";
import {
	handleChannelInstanceToggle,
	handleChannelInstancesGet,
	handleChannelInstancesPut,
	handleChannelValidate,
	handleChannelsStatus,
	handleImAgentsGet,
	handleImAgentsPut,
	handleImBindingsGet,
	handleImBindingsPut,
	handleImCommands,
	handleImSessions,
	handleWechatAction,
	handleWechatQr,
} from "./web-gateway/im-instances";
import { handleAgentContextUsage } from "./web-gateway/context-usage";
import {
	handleCwdBrowseGet,
	handleCwdValidatePost,
	handleDefaultCwdPost,
	handleFsDirectoriesGet,
	handleFsDirectoriesPost,
} from "./web-gateway/cwd";
import { handleDesktopInfoGet } from "./web-gateway/desktop";
import { handleDictationAudio } from "./web-gateway/dictation-audio";
import { handleDocsGet } from "./web-gateway/docs";
import { handleFileIndexGet } from "./web-gateway/file-index";
import { handleFilesGet, handleFilesPost } from "./web-gateway/files";
import { handleGitBranch, handleGitBranches, handleGitCheckout } from "./web-gateway/git";
import {
	handleGitDiff,
	handleGitRemotes,
	handleGitShow,
	handleGitStatus,
	handleGitWorktrees,
} from "./web-gateway/git-reads";
import {
	handleGitCommit,
	handleGitFetch,
	handleGitLog,
	handleGitPull,
	handleGitPush,
	handleGitStage,
	handleGitUnstage,
} from "./web-gateway/git-actions";
import { handleMemoryItem, handleMemoryList, handleMemorySearch, handleMemoryWrite } from "./web-gateway/memory";
import { handleServeIdentityGet, SERVE_IDENTITY_PATH } from "./web-gateway/identity";
import { requestServeRestart } from "./serve-control";
import {
	handleModels,
	handleModelsConfigGet,
	handleModelsConfigPut,
	handleModelsConfigTest,
	handleModelsDefaultPut,
	handleModelsImport,
} from "./web-gateway/models";
import {
	handleModelsConfigCatalog,
	handleModelsConfigDiscover,
	handleModelsConfigMetadata,
} from "./web-gateway/models-config";
import { handleOpenGet, handleOpenPost } from "./web-gateway/open";
import { handleGetPlan } from "./web-gateway/plan";
import { handleProjectsGet, handleProjectsPut } from "./web-gateway/projects";
import { handlePluginsGet, handlePluginsPost } from "./web-gateway/plugins";
import { handlePluginAssetGet, handlePluginPagesGet } from "./web-gateway/assets";
import { getRunningSessionIds } from "./web-gateway/running-sessions";
import { isGatewayDraining, setGatewayDraining } from "./web-gateway/draining";
import {
	handleDeleteArtifact,
	handleListArtifacts,
	handleReadArtifact,
	handleWriteArtifact,
} from "./web-gateway/artifacts";
import {
	handleDeleteProject,
	handleDeleteSession,
	handleExportSession,
	handleGetSession,
	handleListSessions,
	handleRenameSession,
	handleSessionContext,
	handleSessionState,
	handleThinking,
	handleUsageStats,
} from "./web-gateway/sessions";
import {
	handleSettingsGet,
	handleSettingsPut,
	handleSettingsRawGet,
	handleSettingsRawPut,
	handleSettingsReload,
	handleSettingsValuesGet,
} from "./web-gateway/settings";
import {
	handleSkillsCheck,
	handleSkillsGet,
	handleSkillsInstall,
	handleSkillsOfficial,
	handleSkillsPatch,
	handleSkillsReveal,
	handleSkillsSearch,
	handleSkillsUpdate,
} from "./web-gateway/skills";
import { handleGetTracking, handleTrackingEvents } from "./web-gateway/tracking";
import { handleUpdateCheck, handleUpdateDownload, handleUpdateInstall } from "./web-gateway/update";
import { handleUsageDaily } from "./web-gateway/usage-daily";
import { handleWebConfigGet, handleWebConfigPut } from "./web-gateway/web-config";
import {
	handleRemotePairingGet,
	handleRemoteTokenRevokePost,
	handleRemoteTokenRotatePost,
} from "./web-gateway/pairing";
import {
	handleTerminalCreate,
	handleTerminalDelete,
	handleTerminalEnsure,
	handleTerminalList,
	handleTerminalProfiles,
	handleTerminalResize,
	handleTerminalTicket,
	handleTerminalWsUpgrade,
	isTerminalWsUpgradeRequest,
	shutdownTerminalManager,
	terminalWebSocketHandler,
	type TerminalWsData,
} from "./web-gateway/terminal";
import { handleRpcWsUpgrade, isRpcWsUpgradeRequest, rpcWebSocketHandler, type RpcWsData } from "./web-gateway/rpc-ws";
import { hostIsLoopback, isAllowedOrigin, isAllowedRequestOrigin } from "./web-gateway/origin";
import { bindingDecision, bindingScopeResponse } from "./web-gateway/binding-guard";
import { classifyOperation, scopeSatisfies } from "./web-gateway/scope";
import { isStudioRequest, isStudioWsUpgradeRequest, studioHost } from "./studio-host";

/** Both data planes share one listener; `kind` routes a socket to its handler. */
type GatewayWsData = TerminalWsData | RpcWsData;

const DEFAULT_GATEWAY_PORT = ZETA_GATEWAY_PORT;

const SESSION_ID_PART = "[A-Za-z0-9-]+";
const PROVIDER_PART = "[A-Za-z0-9_.-]+";

const SESSION_LIST_RE = /^\/api\/sessions$/;
// Literal `archived` routes must precede SESSION_ID_RE or the id pattern
// swallows the literal path segment.
const ARCHIVED_SESSIONS_RE = /^\/api\/sessions\/archived$/;
const SESSION_ARCHIVE_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/archive$`);
const SESSION_UNARCHIVE_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/unarchive$`);
const SESSION_ID_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})$`);
const SESSION_CONTEXT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/context$`);
const SESSION_STATE_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/state$`);
const SESSION_THINKING_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/entries/(${SESSION_ID_PART})/thinking$`);
const SESSION_EXPORT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/export$`);
const SESSION_ARTIFACTS_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/artifacts$`);
const SESSION_ARTIFACT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/artifacts/(.+)$`);

// Literal agent routes are matched before the generic /api/agent/:id forms.
const AGENT_ID_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})$`);
const EXTENSION_UI_RESPONSE_RE = /^\/api\/extension-ui\/response$/;
const AGENT_EVENTS_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/events$`);
// Memory content management, read-only batch (see web-gateway/memory.ts and the
// capability matrix in document/web-gateway.md). `search`/`items` are anchored
// separately so the bare `/memory` pattern cannot swallow them.
const AGENT_MEMORY_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/memory$`);
const AGENT_MEMORY_SEARCH_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/memory/search$`);
// Memory ids are opaque and percent-encoded by the client (a `local` id is a
// relative file path, so it may contain an encoded `/`).
const AGENT_MEMORY_ITEM_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/memory/items/([^/]+)$`);
// Subagent roster family (see `document/web-gateway.md`). `subagents/events`
// must be tested before the bare `subagents` form; both are anchored, so the
// ordering only keeps the reading order literal-first. `subId` is any
// non-slash segment: agent ids may carry dots/colons (nested spawns, advisors).
const AGENT_SUBAGENTS_EVENTS_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/subagents/events$`);
const AGENT_SUBAGENTS_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/subagents$`);
const SUBAGENT_TRANSCRIPT_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/subagents/([^/]+)/transcript$`);
const SUBAGENT_OUTPUT_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/subagents/([^/]+)/output$`);
const AGENT_CONTEXT_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/context$`);

const AUTH_ALL_PROVIDERS_RE = /^\/api\/auth\/all-providers$/;
const AUTH_PROVIDERS_RE = /^\/api\/auth\/providers$/;
const AUTH_API_KEY_RE = new RegExp(`^/api/auth/api-key/(${PROVIDER_PART})$`);
const AUTH_LOGIN_RE = new RegExp(`^/api/auth/login/(${PROVIDER_PART})$`);
const AUTH_LOGOUT_RE = new RegExp(`^/api/auth/logout/(${PROVIDER_PART})$`);
// Account/device 2FA (TOTP). Distinct from provider OAuth above: this protects
// remote device access, never IM or provider credentials.
const AUTH_2FA_RE = /^\/api\/auth\/2fa$/;
const AUTH_2FA_ENROLL_RE = /^\/api\/auth\/2fa\/enroll$/;
const AUTH_2FA_CONFIRM_RE = /^\/api\/auth\/2fa\/confirm$/;
const AUTH_2FA_VERIFY_RE = /^\/api\/auth\/2fa\/verify$/;
const AUTH_2FA_DISABLE_RE = /^\/api\/auth\/2fa\/disable$/;
const AUTH_2FA_RECOVERY_RE = /^\/api\/auth\/2fa\/recovery\/regenerate$/;
const AUTH_2FA_POLICY_RE = /^\/api\/auth\/2fa\/policy$/;
const MODELS_RE = /^\/api\/models$/;
const MODELS_IMPORT_RE = /^\/api\/models\/import$/;
const MODELS_DEFAULT_RE = /^\/api\/models\/default$/;
const MODELS_CONFIG_RE = /^\/api\/models-config$/;
const MODELS_CONFIG_TEST_RE = /^\/api\/models-config\/test$/;
const MODELS_CONFIG_CATALOG_RE = /^\/api\/models-config\/catalog$/;
const MODELS_CONFIG_DISCOVER_RE = /^\/api\/models-config\/discover$/;
const MODELS_CONFIG_METADATA_RE = /^\/api\/models-config\/metadata$/;
const SKILLS_RE = /^\/api\/skills$/;
const SKILLS_INSTALL_RE = /^\/api\/skills\/install$/;
const SKILLS_SEARCH_RE = /^\/api\/skills\/search$/;
const SKILLS_CHECK_RE = /^\/api\/skills\/check$/;
const SKILLS_UPDATE_RE = /^\/api\/skills\/update$/;
const OPEN_RE = /^\/api\/open$/;
const DESKTOP_INFO_RE = /^\/api\/desktop\/info$/;
const OPEN_OPTIONS_RE = /^\/api\/open\/options$/;
const TERMINAL_LIST_RE = /^\/api\/terminal$/;
const TERMINAL_PROFILES_RE = /^\/api\/terminal\/profiles$/;
const TERMINAL_ENSURE_RE = /^\/api\/terminal\/ensure$/;
const TERMINAL_ID_RE = new RegExp(`^/api/terminal/(${SESSION_ID_PART})$`);
const TERMINAL_RESIZE_RE = new RegExp(`^/api/terminal/(${SESSION_ID_PART})/resize$`);
const TERMINAL_TICKET_RE = new RegExp(`^/api/terminal/(${SESSION_ID_PART})/ticket$`);
const UPDATE_CHECK_RE = /^\/api\/update\/check$/;
const UPDATE_DOWNLOAD_RE = /^\/api\/update\/download$/;
const UPDATE_INSTALL_RE = /^\/api\/update\/install$/;
const PLUGINS_RE = /^\/api\/plugins$/;
// Plugin page host: the manifest inventory and the package's own static
// assets. The asset tail is decoded one segment at a time by the handler
// (`web-gateway/assets.ts`), which also owns root resolution and containment.
const PLUGIN_PAGES_RE = /^\/api\/plugin-pages$/;
const PLUGIN_ASSETS_RE = /^\/api\/plugin-assets\/([^/]+)\/(.+)$/;
const SETTINGS_RE = /^\/api\/settings$/;
const SETTINGS_RELOAD_RE = /^\/api\/settings\/reload$/;
const SETTINGS_VALUES_RE = /^\/api\/settings\/values$/;
const TRACKING_RE = /^\/api\/tracking\/?$/;
const TRACKING_EVENTS_RE = /^\/api\/tracking\/events$/;
const PLAN_RE = /^\/api\/plan$/;
const WEB_CONFIG_RE = /^\/api\/web-config$/;
// Workspace/file surface ported from the retired Next app (see
// web-gateway/{cwd,files,file-index}.ts). `/api/files/<path>` is a catch-all;
// its segments are decoded by `decodePathSegments` before the handler runs.
const DEFAULT_CWD_RE = /^\/api\/default-cwd$/;
const CWD_BROWSE_RE = /^\/api\/cwd\/browse$/;
const CWD_VALIDATE_RE = /^\/api\/cwd\/validate$/;
const FS_DIRECTORIES_RE = /^\/api\/fs\/directories$/;
const FILE_INDEX_RE = /^\/api\/file-index$/;
const FILES_RE = /^\/api\/files\/(.+)$/;
// Remote access: pairing QR + token lifecycle (settings → Remote Access).
const REMOTE_PAIRING_RE = /^\/api\/remote\/pairing$/;
const REMOTE_TOKEN_ROTATE_RE = /^\/api\/remote\/token\/rotate$/;
const REMOTE_TOKEN_REVOKE_RE = /^\/api\/remote\/token\/revoke$/;
// Per-device credentials: the list, one revocation, and "revoke every device".
// The revoke-all form is matched first because it would otherwise be captured
// as a device id.
const REMOTE_DEVICES_RE = /^\/api\/remote\/devices$/;
const REMOTE_DEVICES_REVOKE_ALL_RE = /^\/api\/remote\/devices\/revoke-all$/;
const REMOTE_DEVICE_ID_PART = "[A-Za-z0-9_-]{1,64}";
const REMOTE_DEVICE_RE = new RegExp(`^/api/remote/devices/(${REMOTE_DEVICE_ID_PART})$`);
const DOCS_RE = /^\/api\/docs\/([A-Za-z0-9._/-]+)$/;
const BLOB_RE = /^\/api\/blobs\/([^/]+)$/;
const CHANNELS_INSTANCES_RE = /^\/api\/channels\/instances$/;
const CHANNELS_INSTANCE_RE = /^\/api\/channels\/instances\/([a-z0-9][a-z0-9_-]{1,31})$/;
const CHANNELS_INSTANCE_ACTION_RE =
	/^\/api\/channels\/instances\/([a-z0-9][a-z0-9_-]{1,31})\/(validate|enable|disable)$/;
const CHANNELS_INSTANCE_WECHAT_RE =
	/^\/api\/channels\/instances\/([a-z0-9][a-z0-9_-]{1,31})\/wechat\/(qrcode|reconnect|unbind)$/;
const IM_AGENTS_RE = /^\/api\/im\/agents$/;
const IM_BINDINGS_RE = /^\/api\/im\/bindings$/;
const IM_COMMANDS_RE = /^\/api\/im\/commands$/;
const IM_SESSIONS_RE = /^\/api\/im\/sessions$/;
const CHANNELS_WECHAT_QR_RE = /^\/api\/channels\/wechat\/qrcode$/;
const CHANNELS_WECHAT_RECONNECT_RE = /^\/api\/channels\/wechat\/reconnect$/;
const CHANNELS_WECHAT_UNBIND_RE = /^\/api\/channels\/wechat\/unbind$/;
const CHANNELS_STATUS_RE = /^\/api\/channels\/status$/;
// The only write route in the channels family; see web-gateway/channels.ts.
const CHANNELS_SEND_RE = /^\/api\/channels\/send$/;
const CHANNELS_CREDENTIALS_RE = /^\/api\/channels\/credentials$/;
// The user board (`.zeta/board/`): one file per card. The `move` and
// `handoff` forms are tested before the bare id, and the id pattern cannot
// contain `/`, `.`-leading or `..`, so a request cannot leave the directory.
const BOARD_ID_PART = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
const BOARD_RE = /^\/api\/board$/;
const BOARD_MOVE_RE = new RegExp(`^/api/board/(${BOARD_ID_PART})/move$`);
const BOARD_HANDOFF_RE = new RegExp(`^/api/board/(${BOARD_ID_PART})/handoff$`);
const BOARD_ID_RE = new RegExp(`^/api/board/(${BOARD_ID_PART})$`);

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function capture(pathname: string, re: RegExp): string[] | null {
	const match = pathname.match(re);
	return match ? match.slice(1) : null;
}

/**
 * Decode a catch-all `/api/files/<…>` tail. Next decodes route params before
 * the handler sees them; a malformed escape is rejected rather than guessed,
 * because the decoded string is what the path confinement checks.
 */
function decodePathSegments(raw: string): string[] | null {
	try {
		return raw
			.split("/")
			.filter(segment => segment.length > 0)
			.map(segment => decodeURIComponent(segment));
	} catch {
		return null;
	}
}

/**
 * Normalize the agent-dir env, then rebuild the dirs resolver so
 * `getAgentDir()` honors the result in this process. `ZETA_CODING_AGENT_DIR`
 * → `~/.zeta/agent` (the runtime default). Idempotent; safe to call repeatedly.
 */
export function ensureAgentDirEnv(): void {
	const resolved = process.env.ZETA_CODING_AGENT_DIR ?? path.join(os.homedir(), ".zeta", "agent");
	process.env.ZETA_CODING_AGENT_DIR ??= resolved;
	refreshDirsFromEnv();
}

/** Both guards live in `./web-gateway/origin` so surfaces can share them. */
export { hostIsLoopback, isAllowedOrigin };

/**
 * Access control: loopback requests (the local web UI, desktop shell, dev
 * proxy) pass without a token; any request that arrives from a non-loopback
 * socket (LAN IP, tunnel, reverse proxy, 0.0.0.0 bind) must present either the
 * configured `remote.token` (not revoked/rotated away) or an active per-device
 * token. With no credential configured, non-loopback access is denied outright,
 * so exposing the port cannot yield an unauthenticated control plane.
 *
 * Rate limiting lives in {@link checkRemoteAccess}; this predicate is the
 * credential-only check used where a boolean answer is enough (the stats route).
 */
export async function authorizedForAccess(req: Request, remoteAddr?: string): Promise<boolean> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) return true;
	return (await resolveCredential(req)) !== null;
}

/** In-process fetch handler; ZetaServer dispatches to this directly. */
export async function webGatewayFetch(req: Request, remoteAddr?: string): Promise<Response> {
	ensureAgentDirEnv();
	// Fire-and-forget trash sweeper (first gateway activity ≈ startup; the
	// timers are unref'd and the guard keeps it once-per-process).
	scheduleTrashSweep();

	// Access control: a genuine loopback socket passes; everything else needs a
	// credential (device-bound session cookie, device token, or machine token).
	// Forwarding headers make a loopback socket remote — a reverse proxy must
	// never turn the control plane into an unauthenticated surface.
	const local = isGenuinelyLocalRequest(req, remoteAddr);
	let credential: RemoteCredential = { kind: "local" };
	if (!local) {
		const result = await authenticateRemote(req, remoteAddr ?? "unknown");
		if (result.denial !== null) return result.denial;
		credential = result.credential;
	}

	// CSRF: the request's own origin (or no origin) only. A loopback origin is
	// accepted only for a genuinely local caller, never for a remote cookie.
	if (!isAllowedRequestOrigin(req.headers.get("origin"), req.url, local)) {
		return json({ error: "Forbidden origin" }, 403);
	}

	const url = new URL(req.url);
	const pathname = url.pathname;

	// Operation scope: decided by what the route does, not by its verb, so a
	// read-only device cannot mutate through a POST that merely looks like a
	// query and cannot open a terminal through a ticket.
	const operation = classifyOperation(pathname, req.method);
	if (!scopeSatisfies(credentialScopes(credential), operation)) {
		return json({ error: "insufficient_scope" }, 403);
	}

	// Binding scope: a device bound to one conversation/workspace reaches only
	// that resource; a request that names nothing is refused rather than allowed.
	const binding = await bindingDecision(credential, pathname, url, req);
	if (!binding.allowed) return bindingScopeResponse();

	// 2FA step-up for device/token mutations. Reads and unrelated writes pass;
	// a genuinely local caller is never challenged (see auth/two-factor-auth.ts).
	const twoFactorDenial = await guardGatewayTwoFactor(req, remoteAddr, pathname);
	if (twoFactorDenial) return twoFactorDenial;

	// Service identity, used by serve discovery/reuse (see `../serve-registry.ts`).
	// Answered ahead of any session/dashboard state so a probe of a just-bound
	// port never reads as a false negative.
	if (pathname === SERVE_IDENTITY_PATH) {
		if (req.method === "GET") return handleServeIdentityGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Host-owned action: only the process that runs `zetacode serve` can restart
	// itself. Attached clients reach it here instead of refusing `/restart`.
	if (pathname === "/api/server/restart") {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return json(requestServeRestart());
	}

	if (SESSION_LIST_RE.test(pathname)) {
		if (req.method === "GET") return handleListSessions();
		return json({ error: "Method not allowed" }, 405);
	}

	const archivedList = capture(pathname, ARCHIVED_SESSIONS_RE);
	if (archivedList) {
		if (req.method === "GET") return handleListArchivedSessions();
		return json({ error: "Method not allowed" }, 405);
	}

	const archiveTarget = capture(pathname, SESSION_ARCHIVE_RE);
	if (archiveTarget) {
		if (req.method === "POST") return handleArchiveSession(archiveTarget[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const unarchiveTarget = capture(pathname, SESSION_UNARCHIVE_RE);
	if (unarchiveTarget) {
		if (req.method === "POST") return handleUnarchiveSession(unarchiveTarget[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/projects") {
		if (req.method === "GET") return handleProjectsGet(req);
		if (req.method === "PUT") return handleProjectsPut(req);
		if (req.method === "DELETE") return handleDeleteProject(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Desktop dictation transport: the Renderer's Worklet frames are forwarded
	// by Electron Main. Only a prepared `dictation.*` audioId has a sink, and
	// only the local shell may post audio: a paired remote browser is rejected
	// even with a valid token.
	if (
		pathname === "/api/dictation/audio" ||
		pathname === "/api/dictation/audio/attach" ||
		pathname === "/api/dictation/audio/detach"
	) {
		if (!local) return json({ error: "Forbidden" }, 403);
		return handleDictationAudio(req);
	}

	if (pathname === "/api/git/branches") {
		if (req.method === "GET") return handleGitBranches(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Literal /api/git routes (sidebar project switcher); matched before any
	// generic captures, like /api/agent/running above.
	if (pathname === "/api/git/checkout") {
		if (req.method === "POST") return handleGitCheckout(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/branch") {
		if (req.method === "POST") return handleGitBranch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Read surface for the Studio Git page: status, diff, remotes, one commit,
	// worktrees. All literal paths, matched before the generic captures below.
	if (pathname === "/api/git/status") {
		if (req.method === "GET") return handleGitStatus(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/diff") {
		if (req.method === "GET") return handleGitDiff(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/remotes") {
		if (req.method === "GET") return handleGitRemotes(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/show") {
		if (req.method === "GET") return handleGitShow(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/worktrees") {
		if (req.method === "GET") return handleGitWorktrees(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Mutations that write: staged through the pi-vcs addon, never a spawned
	// `git`. The whole `/api/git/*` family is gateway-owned (Next proxies it
	// through `resolveGatewayUrl()`); these six are the write half.
	if (pathname === "/api/git/stage") {
		if (req.method === "POST") return handleGitStage(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/unstage") {
		if (req.method === "POST") return handleGitUnstage(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/commit") {
		if (req.method === "POST") return handleGitCommit(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/push") {
		if (req.method === "POST") return handleGitPush(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/fetch") {
		if (req.method === "POST") return handleGitFetch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/pull") {
		if (req.method === "POST") return handleGitPull(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/git/log") {
		if (req.method === "GET") return handleGitLog(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/usage") {
		if (req.method === "GET") return handleUsageStats();
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/usage/daily") {
		if (req.method === "GET") return handleUsageDaily();
		return json({ error: "Method not allowed" }, 405);
	}

	const id = capture(pathname, SESSION_ID_RE);
	if (id) {
		const [sessionId] = id;
		if (req.method === "GET") return handleGetSession(req, sessionId);
		if (req.method === "PATCH") return handleRenameSession(req, sessionId);
		if (req.method === "DELETE") return handleDeleteSession(sessionId);
		return json({ error: "Method not allowed" }, 405);
	}

	const context = capture(pathname, SESSION_CONTEXT_RE);
	if (context) {
		if (req.method === "GET") return handleSessionContext(req, context[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const state = capture(pathname, SESSION_STATE_RE);
	if (state) {
		if (req.method === "GET") return handleSessionState(state[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const thinking = capture(pathname, SESSION_THINKING_RE);
	if (thinking) {
		if (req.method === "GET") return handleThinking(req, thinking[0], thinking[1]);
		return json({ error: "Method not allowed" }, 405);
	}

	const exp = capture(pathname, SESSION_EXPORT_RE);
	if (exp) {
		if (req.method === "GET") return handleExportSession(req, exp[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	// Session artifacts: the same `local://` root the tools read and write
	// (see web-gateway/artifacts.ts). A TUI attached to a remote backend pulls
	// one into its own editor and pushes the edited copy back.
	const artifacts = capture(pathname, SESSION_ARTIFACTS_RE);
	if (artifacts) {
		if (req.method === "GET") {
			const search = new URL(req.url).searchParams;
			return handleListArtifacts(artifacts[0], {
				kind: search.get("kind"),
				limit: search.get("limit"),
				cursor: search.get("cursor"),
			});
		}
		return json({ error: "Method not allowed" }, 405);
	}

	const artifact = capture(pathname, SESSION_ARTIFACT_RE);
	if (artifact) {
		if (req.method === "GET") return handleReadArtifact(artifact[0], artifact[1]);
		if (req.method === "PUT") return handleWriteArtifact(req, artifact[0], artifact[1]);
		if (req.method === "DELETE") return handleDeleteArtifact(artifact[0], artifact[1]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/current") {
		// The serve process's shared coordinator session (web-ui default chat,
		// CLI attach). Resolved through the module-level bridge so external
		// clients don't need to know the persistent session id ahead of time.
		if (req.method === "GET") {
			const sessionId = getMainSessionId();
			if (!sessionId) return json({ error: "no shared session; start zetacode serve" }, 404);
			return json({ sessionId });
		}
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/server/drain") {
		if (req.method === "GET") return Response.json({ draining: isGatewayDraining() });
		if (req.method === "POST") {
			let value = true;
			try {
				const body = (await req.json()) as { draining?: unknown };
				if (typeof body.draining === "boolean") value = body.draining;
			} catch {
				// Empty body means "enter drain".
			}
			setGatewayDraining(value);
			return Response.json({ draining: value });
		}
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/new") {
		if (req.method === "POST") return handleAgentNew(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agents") {
		// Live root-agent facts for the Team graph read model (`ops/team.ts`).
		// A literal route next to the agent family it describes.
		if (req.method === "GET") return handleTeamAgentsGet();
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/running/events") {
		if (req.method === "GET") return handleRunningEvents(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/running") {
		// Lightweight snapshot for shell polling (desktop tray/notification loop);
		// the SSE variant below serves the web-ui. Must precede AGENT_ID_RE,
		// which would otherwise capture "running" as a session id.
		if (req.method === "GET") {
			return Response.json(
				{ runningSessionIds: getRunningSessionIds() },
				{
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		return json({ error: "Method not allowed" }, 405);
	}

	const agentEvents = capture(pathname, AGENT_EVENTS_RE);
	if (agentEvents) {
		if (req.method === "GET") return handleAgentEvents(req, agentEvents[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	// Subagent roster family: literal-first, then the deeper `:subId` forms.
	const subagentEvents = capture(pathname, AGENT_SUBAGENTS_EVENTS_RE);
	if (subagentEvents) {
		if (req.method === "GET") return handleSubagentEvents(req, subagentEvents[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const subagents = capture(pathname, AGENT_SUBAGENTS_RE);
	if (subagents) {
		if (req.method === "GET") return handleSubagentRoster(req, subagents[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const subagentTranscript = capture(pathname, SUBAGENT_TRANSCRIPT_RE);
	if (subagentTranscript) {
		if (req.method === "GET") return handleSubagentTranscript(req, subagentTranscript[0], subagentTranscript[1]);
		return json({ error: "Method not allowed" }, 405);
	}

	const subagentOutput = capture(pathname, SUBAGENT_OUTPUT_RE);
	if (subagentOutput) {
		if (req.method === "GET") return handleSubagentOutput(req, subagentOutput[0], subagentOutput[1]);
		return json({ error: "Method not allowed" }, 405);
	}

	const agentContext = capture(pathname, AGENT_CONTEXT_RE);
	if (agentContext) {
		if (req.method === "GET") return handleAgentContextUsage(agentContext[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	// Memory content management (read-only batch). `/memory` is both the list
	// (GET) and the reserved maintenance entry point (POST → 501); item edits
	// (PATCH → 501) are reserved on the item route.
	const agentMemorySearch = capture(pathname, AGENT_MEMORY_SEARCH_RE);
	if (agentMemorySearch) {
		if (req.method === "GET") return handleMemorySearch(req, agentMemorySearch[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const agentMemoryItem = capture(pathname, AGENT_MEMORY_ITEM_RE);
	if (agentMemoryItem) {
		if (req.method === "GET") return handleMemoryItem(agentMemoryItem[0], agentMemoryItem[1]);
		if (req.method === "PATCH") return handleMemoryWrite("PATCH");
		return json({ error: "Method not allowed" }, 405);
	}

	const agentMemory = capture(pathname, AGENT_MEMORY_RE);
	if (agentMemory) {
		if (req.method === "GET") return handleMemoryList(req, agentMemory[0]);
		if (req.method === "POST") return handleMemoryWrite("POST");
		return json({ error: "Method not allowed" }, 405);
	}

	const agentId = capture(pathname, AGENT_ID_RE);
	if (agentId) {
		if (req.method === "GET") return handleAgentState(agentId[0]);
		if (req.method === "POST") return handleAgentCommand(req, agentId[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	// Session-agnostic extension UI reply channel: request ids are unique
	// across the process, so LAN clients (and multi-tab UIs) can answer a
	// pending select/editor dialog without knowing which session owns it.
	if (EXTENSION_UI_RESPONSE_RE.test(pathname)) {
		if (req.method === "POST") return handleGlobalExtensionUiResponse(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (AUTH_ALL_PROVIDERS_RE.test(pathname)) {
		if (req.method === "GET") return handleAllProviders();
		return json({ error: "Method not allowed" }, 405);
	}

	if (AUTH_PROVIDERS_RE.test(pathname)) {
		if (req.method === "GET") return handleOAuthProviders();
		return json({ error: "Method not allowed" }, 405);
	}

	const apiKey = capture(pathname, AUTH_API_KEY_RE);
	if (apiKey) {
		if (req.method === "GET") return handleApiKeyGet(apiKey[0]);
		if (req.method === "POST") return handleApiKeyPost(apiKey[0], req);
		if (req.method === "DELETE") return handleApiKeyDelete(apiKey[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const login = capture(pathname, AUTH_LOGIN_RE);
	if (login) {
		if (req.method === "GET") return handleLoginGet(login[0], req);
		if (req.method === "POST") return handleLoginPost(login[0], req);
		return json({ error: "Method not allowed" }, 405);
	}

	const logout = capture(pathname, AUTH_LOGOUT_RE);
	if (logout) {
		if (req.method === "POST") return handleLogout(logout[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (AUTH_2FA_RE.test(pathname)) {
		if (req.method === "GET") return handleTwoFactorStatusGet(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_ENROLL_RE.test(pathname)) {
		if (req.method === "POST") return handleTwoFactorEnrollPost(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_CONFIRM_RE.test(pathname)) {
		if (req.method === "POST") return handleTwoFactorConfirmPost(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_VERIFY_RE.test(pathname)) {
		if (req.method === "POST") return handleTwoFactorVerifyPost(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_DISABLE_RE.test(pathname)) {
		if (req.method === "POST") return handleTwoFactorDisablePost(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_RECOVERY_RE.test(pathname)) {
		if (req.method === "POST") return handleTwoFactorRecoveryRegeneratePost(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}
	if (AUTH_2FA_POLICY_RE.test(pathname)) {
		if (req.method === "PUT") return handleTwoFactorPolicyPut(req, remoteAddr);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_RE.test(pathname)) {
		if (req.method === "GET") return handleModels(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_IMPORT_RE.test(pathname)) {
		return handleModelsImport(req);
	}

	if (MODELS_DEFAULT_RE.test(pathname)) {
		if (req.method === "PUT") return handleModelsDefaultPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_TEST_RE.test(pathname)) {
		if (req.method === "POST") return handleModelsConfigTest(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_RE.test(pathname)) {
		if (req.method === "GET") return handleModelsConfigGet();
		if (req.method === "PUT") return handleModelsConfigPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_CATALOG_RE.test(pathname)) {
		if (req.method === "GET") return handleModelsConfigCatalog(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_DISCOVER_RE.test(pathname)) {
		if (req.method === "POST") return handleModelsConfigDiscover(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_METADATA_RE.test(pathname)) {
		if (req.method === "POST") return handleModelsConfigMetadata(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_RE.test(pathname)) {
		if (req.method === "GET") return handleSkillsGet(req);
		if (req.method === "PATCH") return handleSkillsPatch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/skills/reveal") {
		if (req.method === "POST") return handleSkillsReveal(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/skills/official") {
		if (req.method === "POST") return handleSkillsOfficial(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_INSTALL_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsInstall(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_SEARCH_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsSearch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_CHECK_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsCheck(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_UPDATE_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsUpdate(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (OPEN_OPTIONS_RE.test(pathname)) {
		if (req.method === "GET") return handleOpenGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (TERMINAL_LIST_RE.test(pathname)) {
		if (req.method === "POST") return handleTerminalCreate(req);
		if (req.method === "GET") return handleTerminalList();
		return json({ error: "Method not allowed" }, 405);
	}

	if (TERMINAL_ENSURE_RE.test(pathname)) {
		if (req.method === "POST") return handleTerminalEnsure(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// `profiles` is eight characters and would also match the terminal-id
	// route, so the catalog must be dispatched before that capture.
	if (TERMINAL_PROFILES_RE.test(pathname)) {
		if (req.method === "GET") return handleTerminalProfiles();
		return json({ error: "Method not allowed" }, 405);
	}

	const terminalId = capture(pathname, TERMINAL_ID_RE);
	if (terminalId) {
		if (req.method === "DELETE") return handleTerminalDelete(terminalId[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const terminalResize = capture(pathname, TERMINAL_RESIZE_RE);
	if (terminalResize) {
		if (req.method === "POST") return handleTerminalResize(req, terminalResize[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const terminalTicket = capture(pathname, TERMINAL_TICKET_RE);
	if (terminalTicket) {
		if (req.method === "POST") return handleTerminalTicket(terminalTicket[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (OPEN_RE.test(pathname)) {
		if (req.method === "OPTIONS") return new Response("", { status: 204, headers: { Allow: "POST, OPTIONS" } });
		if (req.method === "POST") return handleOpenPost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (DESKTOP_INFO_RE.test(pathname)) {
		if (req.method === "GET") return handleDesktopInfoGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (UPDATE_CHECK_RE.test(pathname)) {
		return handleUpdateCheck(req);
	}

	if (UPDATE_DOWNLOAD_RE.test(pathname)) {
		return handleUpdateDownload(req);
	}

	if (UPDATE_INSTALL_RE.test(pathname)) {
		return handleUpdateInstall(req);
	}

	// Plugin page host. The pages inventory is a literal route; the asset
	// route owns its own segment decoding and package containment.
	if (PLUGIN_PAGES_RE.test(pathname)) {
		if (req.method === "GET") return handlePluginPagesGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const pluginAsset = capture(pathname, PLUGIN_ASSETS_RE);
	if (pluginAsset) {
		if (req.method === "GET" || req.method === "HEAD") {
			return handlePluginAssetGet(req, pluginAsset[0], pluginAsset[1]);
		}
		return json({ error: "Method not allowed" }, 405);
	}

	if (PLUGINS_RE.test(pathname)) {
		if (req.method === "GET") return handlePluginsGet(req);
		if (req.method === "POST") return handlePluginsPost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (TRACKING_EVENTS_RE.test(pathname)) {
		if (req.method === "GET") return handleTrackingEvents(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (TRACKING_RE.test(pathname)) {
		if (req.method === "GET") return handleGetTracking(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (PLAN_RE.test(pathname)) {
		if (req.method === "GET") return handleGetPlan(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/settings/raw") {
		if (req.method === "GET") return handleSettingsRawGet(req);
		if (req.method === "PUT") return handleSettingsRawPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SETTINGS_VALUES_RE.test(pathname)) {
		return handleSettingsValuesGet(req);
	}
	if (SETTINGS_RELOAD_RE.test(pathname)) {
		return handleSettingsReload(req);
	}

	if (SETTINGS_RE.test(pathname)) {
		if (req.method === "GET") return handleSettingsGet(req);
		if (req.method === "PUT") return handleSettingsPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (WEB_CONFIG_RE.test(pathname)) {
		if (req.method === "GET") return handleWebConfigGet(req);
		if (req.method === "PUT") return handleWebConfigPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	// Workspace/file surface: the file tree, editor, preview panes, uploads and
	// the @-mention index. All of these used to be answered by the Next child.
	if (DEFAULT_CWD_RE.test(pathname)) {
		if (req.method === "POST") return handleDefaultCwdPost();
		return json({ error: "Method not allowed" }, 405);
	}

	if (CWD_BROWSE_RE.test(pathname)) {
		if (req.method === "GET") return handleCwdBrowseGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (CWD_VALIDATE_RE.test(pathname)) {
		if (req.method === "POST") return handleCwdValidatePost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (FS_DIRECTORIES_RE.test(pathname)) {
		if (req.method === "GET") return handleFsDirectoriesGet(req);
		if (req.method === "POST") return handleFsDirectoriesPost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (FILE_INDEX_RE.test(pathname)) {
		if (req.method === "GET") return handleFileIndexGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const filesTail = capture(pathname, FILES_RE);
	if (filesTail) {
		const segments = decodePathSegments(filesTail[0]);
		if (!segments) return json({ error: "Invalid file path" }, 400);
		if (req.method === "GET") return handleFilesGet(req, segments);
		if (req.method === "POST") return handleFilesPost(req, segments);
		return json({ error: "Method not allowed" }, 405);
	}

	if (REMOTE_PAIRING_RE.test(pathname)) {
		if (req.method === "GET") return await handleRemotePairingGet(req, remoteAddr, credential);
		return json({ error: "Method not allowed" }, 405);
	}

	// Per-device credentials. The list is readable by any authenticated caller
	// (a paired phone may need to see its own row); mutations additionally need
	// `write` scope, enforced in the handler.
	if (REMOTE_DEVICES_RE.test(pathname)) {
		if (req.method === "GET") return handleDevicesGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (REMOTE_DEVICES_REVOKE_ALL_RE.test(pathname)) {
		if (req.method === "POST") {
			const response = await handleDevicesRevokeAllPost(req);
			if (response.ok) {
				// Revoking a device must also destroy the authority already granted
				// to it: its persisted sessions, its live Studio sockets, and its
				// 2FA grants. Otherwise an upgraded WebSocket keeps receiving events.
				const dropped = await sessionStore().deleteAll();
				forgetAllVerifications();
				for (const deviceId of dropped.deviceIds) studioHost().dropDeviceSessions(deviceId);
			}
			return response;
		}
		return json({ error: "Method not allowed" }, 405);
	}

	const deviceId = capture(pathname, REMOTE_DEVICE_RE);
	if (deviceId) {
		if (req.method === "DELETE") {
			const response = await handleDeviceDelete(req, deviceId[0]);
			// Drop that device's live Studio sessions and event sockets. Harmless
			// when the row was already revoked (there is nothing left to drop) and
			// essential when it was active: the gate stops its token, and this stops
			// an already-upgraded socket from receiving more events.
			if (response.ok) {
				await sessionStore().deleteByDevice(deviceId[0]);
				studioHost().dropDeviceSessions(deviceId[0]);
				forgetDeviceVerification(deviceId[0]);
			}
			return response;
		}
		return json({ error: "Method not allowed" }, 405);
	}

	if (REMOTE_TOKEN_ROTATE_RE.test(pathname)) {
		if (req.method === "POST") return handleRemoteTokenRotatePost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (REMOTE_TOKEN_REVOKE_RE.test(pathname)) {
		if (req.method === "POST") return handleRemoteTokenRevokePost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const docs = capture(pathname, DOCS_RE);
	if (docs) {
		if (req.method === "GET") return handleDocsGet(req, docs[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const blob = capture(pathname, BLOB_RE);
	if (blob) return handleBlobGet(req, blob[0]);

	if (CHANNELS_STATUS_RE.test(pathname)) {
		if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
		return handleChannelsStatus();
	}

	if (CHANNELS_INSTANCES_RE.test(pathname)) {
		if (req.method === "GET") return handleChannelInstancesGet();
		if (req.method === "PUT") return handleChannelInstancesPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const instanceAction = capture(pathname, CHANNELS_INSTANCE_ACTION_RE);
	if (instanceAction) {
		const [instanceId, action] = instanceAction;
		if (action === "validate") {
			if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
			return handleChannelValidate(req, instanceId!);
		}
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleChannelInstanceToggle(instanceId!, action === "enable");
	}

	const instanceWechat = capture(pathname, CHANNELS_INSTANCE_WECHAT_RE);
	if (instanceWechat) {
		const [instanceId, action] = instanceWechat;
		if (action === "qrcode") {
			if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
			const response = await handleWechatQr(instanceId!);
			const payload = await response
				.clone()
				.json()
				.catch(() => null);
			if (
				payload &&
				typeof payload === "object" &&
				"pending" in payload &&
				payload.pending === true &&
				"qrcodeUrl" in payload &&
				typeof payload.qrcodeUrl === "string"
			) {
				const svg = renderWechatLoginQrSvg(payload.qrcodeUrl);
				return json({ ...payload, ...(svg === undefined ? {} : { svg }) });
			}
			return response;
		}
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleWechatAction(instanceId!, action === "reconnect" ? "reconnect" : "unbind");
	}

	if (IM_AGENTS_RE.test(pathname)) {
		if (req.method === "GET") return handleImAgentsGet();
		if (req.method === "PUT") return handleImAgentsPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (IM_BINDINGS_RE.test(pathname)) {
		if (req.method === "GET") return handleImBindingsGet(req);
		if (req.method === "PUT") return handleImBindingsPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (IM_COMMANDS_RE.test(pathname)) {
		if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
		return handleImCommands(req);
	}

	if (IM_SESSIONS_RE.test(pathname)) {
		if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
		return handleImSessions();
	}

	if (CHANNELS_SEND_RE.test(pathname)) {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleChannelSend(req);
	}

	if (CHANNELS_CREDENTIALS_RE.test(pathname)) {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleChannelCredentials(req);
	}

	if (
		CHANNELS_WECHAT_QR_RE.test(pathname) ||
		CHANNELS_WECHAT_RECONNECT_RE.test(pathname) ||
		CHANNELS_WECHAT_UNBIND_RE.test(pathname)
	) {
		return json({ error: "Use /api/channels/instances/:id/wechat/{qrcode,reconnect,unbind}" }, 410);
	}

	if (BOARD_RE.test(pathname)) {
		if (req.method === "GET") return handleBoardList(req);
		if (req.method === "POST") return handleBoardCreate(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const boardMove = capture(pathname, BOARD_MOVE_RE);
	if (boardMove) {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleBoardMove(req, boardMove[0]);
	}

	const boardHandoff = capture(pathname, BOARD_HANDOFF_RE);
	if (boardHandoff) {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		return handleBoardHandoff(req, boardHandoff[0]);
	}

	const boardCard = capture(pathname, BOARD_ID_RE);
	if (boardCard) {
		if (req.method === "GET") return handleBoardGet(req, boardCard[0]);
		if (req.method === "PATCH") return handleBoardUpdate(req, boardCard[0]);
		if (req.method === "DELETE") return handleBoardDelete(req, boardCard[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname.startsWith("/api/")) {
		return json({ error: "Not implemented" }, 404);
	}

	return json({ error: "Not found" }, 404);
}

export interface WebGatewayInstance {
	port: number;
	url: string;
	shutdown: () => Promise<void>;
}

/**
 * Start the standalone gateway listener for `next dev`/`next start` access.
 * ZetaServer itself dispatches in-process and does not depend on this port;
 * callers should treat a thrown error as non-fatal when the port is busy.
 */
export async function startWebGateway(port?: number): Promise<WebGatewayInstance> {
	ensureAgentDirEnv();

	const gatewayPort = port ?? Number(process.env.ZETA_WEB_GATEWAY_PORT ?? DEFAULT_GATEWAY_PORT);
	if (!Number.isSafeInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
		throw new Error(`Invalid ZETA_WEB_GATEWAY_PORT: ${gatewayPort}`);
	}

	const server = Bun.serve<GatewayWsData>({
		hostname: "127.0.0.1",
		port: gatewayPort,
		idleTimeout: 0,
		websocket: {
			open(ws) {
				if (ws.data.kind === "studio") {
					studioHost().attachSocket(ws.data.sessionId, ws);
					return;
				}
				if (ws.data.kind === "rpc") rpcWebSocketHandler.open(ws);
				else terminalWebSocketHandler.open?.(ws);
			},
			message(ws, message) {
				if (ws.data.kind === "studio") return;
				if (ws.data.kind === "rpc") rpcWebSocketHandler.message(ws, message);
				else terminalWebSocketHandler.message?.(ws, message);
			},
			close(ws) {
				if (ws.data.kind === "studio") {
					studioHost().detachSocket(ws.data.sessionId, ws);
					return;
				}
				if (ws.data.kind === "rpc") rpcWebSocketHandler.close(ws);
				else terminalWebSocketHandler.close?.(ws, 1000, "");
			},
		},
		fetch: async (req, srv) => {
			// Data-plane upgrades bypass webGatewayFetch (it can only return
			// Responses); auth lives in each upgrade handler.
			if (isStudioWsUpgradeRequest(req)) {
				const response = await studioHost().upgrade(req, srv, srv?.requestIP(req)?.address);
				return response ?? new Response(null);
			}
			// The Studio host owns `/health` and `/api/v1/*` on this listener too:
			// `vite dev` proxies `/api` and `/health` here.
			if (isStudioRequest(req)) return studioHost().handle(req, srv?.requestIP(req)?.address);
			if (isTerminalWsUpgradeRequest(req)) {
				const remoteAddr = srv?.requestIP(req)?.address;
				const response = await handleTerminalWsUpgrade(req, srv, remoteAddr);
				// Null means the socket was upgraded; the fetch result is moot.
				return response ?? new Response(null);
			}
			if (isRpcWsUpgradeRequest(req)) {
				const remoteAddr = srv?.requestIP(req)?.address;
				const response = await handleRpcWsUpgrade(req, srv, remoteAddr);
				return response ?? new Response(null);
			}
			return webGatewayFetch(req, srv?.requestIP(req)?.address);
		},
	});

	return {
		port: server.port ?? gatewayPort,
		url: `http://127.0.0.1:${server.port ?? gatewayPort}`,
		shutdown: async () => {
			// Kill embedded PTYs first: their shells/agents are children of this
			// process, and a graceful SIGTERM must not leave them holding the
			// workspace after the listener is gone.
			shutdownTerminalManager();
			server.stop(true);
		},
	};
}
