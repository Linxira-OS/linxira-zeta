/**
 * Zeta desktop shell — main process.
 *
 * Starts the local Zeta service (`zeta serve`, no browser, no console window),
 * waits for the Web UI on 30141, then hosts it in an embedded Electron window.
 * The system browser is never opened and no terminal window appears.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog, nativeImage, Notification, screen, shell, Tray } from "electron";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
	editorCommand,
	editorIdFromTarget,
	listHostOpenTargets,
	validateGatewayOpenTarget,
	type DesktopOpenTarget,
} from "./open-bridge";
import { resolveToolIn, type ToolResolutionDeps } from "./tool-resolution";
import {
	DEFAULT_WORKSPACE_STATE,
	isBoundsValid,
	isToolId,
	lastZetacodeLaunch,
	newestSessionFile,
	readWorkspaceState,
	type WindowBounds,
	type WorkspaceState,
	withLaunch,
	writeWorkspaceStateAtomic,
} from "./workspace-state";
import {
	DEFAULT_DESKTOP_SETTINGS,
	parseRunningSessions,
	parseSessionNames,
	readDesktopSettings,
	runningTooltip,
	RunningSessionsTracker,
	writeDesktopSettingsAtomic,
	type DesktopSettings,
	type RunningSessionsResponse,
} from "./session-monitor";
import { SERVICE_MAX_RESTARTS, shouldRestartServe } from "./service-supervision";
import {
	bundledServeCommandIn,
	findRepoRootIn,
	resolveServeCommandIn,
	type ServeCommand,
	type ServeResolutionDeps,
} from "./serve-resolution";

const WEB_UI_URL = "http://127.0.0.1:30141";
const STATS_URL = "http://127.0.0.1:3847";
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 400;
const SESSION_POLL_INTERVAL_MS = 5_000;
const SERVICE_BINARY_NAME = process.platform === "win32" ? "zeta.exe" : "zeta";
const WEB_RUNTIME_NAME = process.platform === "win32" ? "node.exe" : "node";
const RENDERER_CRASH_WINDOW_MS = 120_000;
const RENDERER_CRASH_RELOAD_LIMIT = 3;

let serveChild: ChildProcess | null = null;
let serviceLogFd: number | null = null;
let serviceOwned = false;
let serviceWorkspacePath = process.cwd();
let quitting = false;
const desktopOpenSecret = crypto.randomBytes(32).toString("base64url");

function desktopServiceEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return { ...env, ZETA_DESKTOP: "1", ZETA_DESKTOP_OPEN_SECRET: desktopOpenSecret };
}

function currentWorkspacePath(): string {
	return serviceWorkspacePath;
}

ipcMain.handle("pi:open-targets", (): DesktopOpenTarget[] => listHostOpenTargets());

ipcMain.handle("pi:open-target", async (_event, targetId: unknown, gatewayPath: unknown): Promise<void> => {
	if (!listHostOpenTargets().some(target => target.id === targetId))
		throw new Error("Rejected untrusted desktop open target");
	const target = validateGatewayOpenTarget(targetId, gatewayPath, currentWorkspacePath(), desktopOpenSecret);
	if (!target) throw new Error("Rejected untrusted desktop open target");
	const editorId = editorIdFromTarget(target.targetId);
	if (editorId) {
		spawn(editorCommand(editorId), [target.path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
		return;
	}
	const error = await shell.openPath(target.path);
	if (error) throw new Error(error);
});

/**
 * Working directory requested by `zeta-d -d <cwd>` / `zeta --desktop <cwd>`
 * (forwarded by the CLI dispatcher as `--cwd=<path>`). The service process is
 * started in this directory so the GUI opens the requested workspace.
 */
function parseRequestedCwd(): string | null {
	for (const arg of process.argv) {
		if (arg.startsWith("--cwd=")) {
			const value = arg.slice("--cwd=".length);
			if (value && fs.existsSync(value)) return path.resolve(value);
		}
	}
	return null;
}

// Native directory picker for the embedded web-ui (`window.piDesktop`).
ipcMain.handle("pi:select-directory", async (_event, startPath?: unknown): Promise<string | null> => {
	try {
		// Only seed the dialog at an existing directory; a stale or invalid
		// defaultPath can make the native dialog misbehave on some platforms.
		let defaultPath: string | undefined;
		if (typeof startPath === "string" && startPath.length > 0) {
			try {
				if (fs.statSync(startPath).isDirectory()) defaultPath = startPath;
			} catch {
				// Not an existing directory — let the OS pick its own default.
			}
		}
		const properties: Electron.OpenDialogOptions["properties"] = ["openDirectory"];
		// "createDirectory" only has an effect on macOS; keep it off elsewhere.
		if (process.platform === "darwin") properties.push("createDirectory");
		const options: Electron.OpenDialogOptions = { properties, defaultPath };
		// Anchor the OS dialog to the app window when it exists.
		const result =
			mainWindow && !mainWindow.isDestroyed()
				? await dialog.showOpenDialog(mainWindow, options)
				: await dialog.showOpenDialog(options);
		return result.canceled ? null : (result.filePaths[0] ?? null);
	} catch (err) {
		writeDesktopLog(`Native directory dialog failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
});
let mainWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let workspaceState: WorkspaceState = { ...DEFAULT_WORKSPACE_STATE, launches: [] };
let boundsSaveTimer: NodeJS.Timeout | null = null;

/** Persist the current window bounds (debounced caller; force flushes at quit). */
function saveWorkspaceState(): void {
	if (boundsSaveTimer) {
		clearTimeout(boundsSaveTimer);
		boundsSaveTimer = null;
	}
	try {
		writeWorkspaceStateAtomic(app.getPath("userData"), workspaceState);
	} catch (err) {
		writeDesktopLog(`Could not persist workspace state: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function scheduleBoundsSave(): void {
	if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
	boundsSaveTimer = setTimeout(saveWorkspaceState, 500);
}

function captureCurrentBounds(win: BrowserWindow): void {
	if (win.isDestroyed() || win.isMinimized()) return;
	// getNormalBounds keeps the pre-maximize rect when maximized.
	const bounds = win.getNormalBounds();
	workspaceState = { ...workspaceState, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, maximized: win.isMaximized() };
	scheduleBoundsSave();
}

/** Restore the persisted bounds only when they still land on a live display. */
function restoredWindowBounds(): { bounds: WindowBounds; maximized: boolean } | null {
	const persisted = workspaceState.bounds;
	if (!persisted) return null;
	const workAreas = screen.getAllDisplays().map(display => display.workArea as WindowBounds);
	if (!isBoundsValid(persisted, workAreas)) return null;
	return { bounds: persisted, maximized: workspaceState.maximized };
}

// ---------------------------------------------------------------------------
// Topbar tool launchers (zetacode / zetaide / zetaeditor)
// ---------------------------------------------------------------------------

function toolResolutionDeps(): ToolResolutionDeps {
	return {
		isPackaged: app.isPackaged,
		platform: process.platform,
		resourcesPath: process.resourcesPath,
		env: process.env,
		exists: candidate => {
			try {
				return fs.existsSync(candidate);
			} catch {
				return false;
			}
		},
		readTextFile: candidate => {
			try {
				return fs.readFileSync(candidate, "utf8");
			} catch {
				return null;
			}
		},
		dirname: __dirname,
		cwd: process.cwd(),
		probePath: name => {
			const lookup = process.platform === "win32" ? "where" : "which";
			const probe = spawnSync(lookup, [name], { encoding: "utf8" });
			if (probe.status !== 0) return null;
			const lines = probe.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
			if (lines.length === 0) return null;
			// Prefer a real executable over cmd/bat shims so spawn works without a shell.
			return lines.find(line => !/\.(cmd|bat)$/i.test(line)) ?? lines[0];
		},
		serviceBinaryName: SERVICE_BINARY_NAME,
		webRuntimeName: WEB_RUNTIME_NAME,
	};
}

interface SpawnToolOptions {
	resume?: boolean;
}

ipcMain.handle(
	"pi:spawn-tool",
	async (
		_event,
		toolId: unknown,
		cwd: unknown,
		opts: unknown,
	): Promise<{ tool: string; cwd: string; pid: number | null; sessionDir?: string }> => {
		if (!isToolId(toolId)) throw new Error(`Unknown toolId: ${String(toolId)}`);
		// Renderer must pass an existing directory; default to the service workspace.
		const targetCwd =
			typeof cwd === "string" && cwd.length > 0 ? cwd : currentWorkspacePath();
		if (!path.isAbsolute(targetCwd)) throw new Error("cwd must be an absolute path");
		try {
			if (!fs.statSync(targetCwd).isDirectory()) throw new Error("not a directory");
		} catch {
			throw new Error(`cwd does not exist or is not a directory: ${targetCwd}`);
		}
		const options: SpawnToolOptions =
			opts !== null && typeof opts === "object" && !Array.isArray(opts) ? (opts as SpawnToolOptions) : {};

		const resolved = resolveToolIn(toolId, toolResolutionDeps());
		if (!resolved) {
			throw new Error(`Could not find the ${toolId} binary on this machine (PATH / ZETA_BIN_DIR / repo build).`);
		}

		const args = [...resolved.args];
		const ts = new Date().toISOString();
		let sessionDir: string | undefined;
		if (toolId === "zetacode") {
			// Isolated session archive per launch; `opts.resume` reuses the newest
			// session file from the last zetacode launch in the same cwd.
			const prior = options.resume === true ? lastZetacodeLaunch(workspaceState, targetCwd) : null;
			sessionDir = prior?.sessionDir ?? path.join(app.getPath("userData"), "zeta-sessions", ts.replace(/[:.]/g, "-"));
			args.push("--session-dir", sessionDir);
			if (options.resume === true) {
				const latest = newestSessionFile(sessionDir);
				if (latest) args.push("--resume", latest);
			}
		}

		let child: ChildProcess;
		try {
			child = spawn(resolved.file, args, {
				cwd: targetCwd,
				env: process.env,
				detached: true,
				stdio: "ignore",
				windowsHide: true,
				shell: resolved.needsShell,
			});
		} catch (err) {
			throw new Error(`Could not launch ${toolId}: ${err instanceof Error ? err.message : String(err)}`);
		}
		child.on("error", err => writeDesktopLog(`Failed to launch ${toolId}: ${err.message}`));
		child.unref();

		workspaceState = withLaunch(workspaceState, { tool: toolId, cwd: targetCwd, pid: child.pid ?? null, ts, sessionDir });
		saveWorkspaceState();
		writeDesktopLog(`Launched ${toolId} (pid ${child.pid ?? "unknown"}) in ${targetCwd}`);
		return { tool: toolId, cwd: targetCwd, pid: child.pid ?? null, sessionDir };
	},
);

// ---------------------------------------------------------------------------
// Window controls for the self-drawn titlebar (`window.piDesktop`).
//
// The window runs frameless so all three platforms share one chrome. The
// renderer owns the buttons; the main process only performs the action and
// pushes state changes back so the icons can follow (maximize ↔ restore).
// ---------------------------------------------------------------------------

function pushWindowState(win: BrowserWindow): void {
	if (win.isDestroyed()) return;
	win.webContents.send("pi:window-state", { maximized: win.isMaximized() });
}

ipcMain.handle("pi:window-minimize", (): void => {
	mainWindow?.minimize();
});

ipcMain.handle("pi:window-maximize", (): void => {
	const win = mainWindow;
	if (!win || win.isDestroyed()) return;
	if (win.isMaximized()) win.unmaximize();
	else win.maximize();
});

ipcMain.handle("pi:window-close", (): void => {
	mainWindow?.close();
});

ipcMain.handle("pi:window-state", (): { maximized: boolean } => {
	return { maximized: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false };
});

// ---------------------------------------------------------------------------
// Session completion monitor.
//
// Polls the gateway's lightweight /api/agent/running snapshot every few
// seconds (same shape as the upstream web UI route). A session transitioning
// running→idle fires a system notification (click → focus the main window);
// the tray tooltip always mirrors the running-session count. Polling failures
// (404 / connection refused while the service restarts) retry silently.
// ---------------------------------------------------------------------------

const runningTracker = new RunningSessionsTracker();
let desktopSettings: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS };
let sessionPollTimer: NodeJS.Timeout | null = null;

function startSessionMonitor(): void {
	if (sessionPollTimer) return;
	runningTracker.reset();
	void pollRunningSessions();
	sessionPollTimer = setInterval(() => {
		void pollRunningSessions();
	}, SESSION_POLL_INTERVAL_MS);
}

function stopSessionMonitor(): void {
	if (!sessionPollTimer) return;
	clearInterval(sessionPollTimer);
	sessionPollTimer = null;
}

async function pollRunningSessions(): Promise<void> {
	let snapshot: RunningSessionsResponse | null = null;
	try {
		const response = await fetch(`${WEB_UI_URL}/api/agent/running`, { headers: { accept: "application/json" } });
		if (response.ok) snapshot = parseRunningSessions(await response.json());
	} catch {
		// Connection refused / aborted (service restarting): silent retry.
	}
	if (!snapshot) {
		// Gateway unreachable or malformed payload: drop the baseline so the
		// next successful poll re-syncs without replaying offline completions.
		runningTracker.reset();
		updateTrayRunningCount(0);
		return;
	}
	const transitions = runningTracker.update(snapshot.runningSessionIds);
	updateTrayRunningCount(snapshot.runningSessionIds.length);
	for (const transition of transitions) {
		if (transition.to !== "idle") continue;
		void notifySessionCompleted(transition.id);
	}
}

async function notifySessionCompleted(sessionId: string): Promise<void> {
	if (!desktopSettings.notifications || !Notification.isSupported()) return;
	const notification = new Notification({
		title: await sessionDisplayName(sessionId),
		body: "Agent run finished. Click to open the session.",
	});
	notification.on("click", () => showMainWindow());
	notification.show();
}

/** Resolve a human-readable title for a session id via the gateway's session
 *  list; falls back to the raw id when the lookup fails or finds nothing. */
async function sessionDisplayName(sessionId: string): Promise<string> {
	try {
		const response = await fetch(`${WEB_UI_URL}/api/sessions`, { headers: { accept: "application/json" } });
		if (!response.ok) return sessionId;
		return parseSessionNames(await response.json()).get(sessionId) ?? sessionId;
	} catch {
		return sessionId;
	}
}
// ---------------------------------------------------------------------------
// Service resolution
// ---------------------------------------------------------------------------

function findRepoRoot(): string | null {
	return findRepoRootIn(desktopServeDeps());
}

function bundledServeCommand(): ServeCommand | null {
	return bundledServeCommandIn(desktopServeDeps());
}

/** Real-process seams for the pure serve resolver. */
function desktopServeDeps(): ServeResolutionDeps {
	return {
		isPackaged: app.isPackaged,
		platform: process.platform,
		resourcesPath: process.resourcesPath,
		env: process.env,
		exists: candidate => {
			try {
				return fs.existsSync(candidate);
			} catch {
				return false;
			}
		},
		readTextFile: candidate => {
			try {
				return fs.readFileSync(candidate, "utf8");
			} catch {
				return null;
			}
		},
		dirname: __dirname,
		cwd: process.cwd(),
		probePath: name => {
			const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
			return probe.status === 0 && Boolean(probe.stdout.trim());
		},
		serviceBinaryName: SERVICE_BINARY_NAME,
		webRuntimeName: WEB_RUNTIME_NAME,
	};
}

function resolveServeCommand(): ServeCommand | null {
	return resolveServeCommandIn(desktopServeDeps());
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

function killServe(): void {
	if (!serviceOwned || !serveChild || serveChild.pid === undefined) return;
	const child = serveChild;
	serveChild = null;
	serviceOwned = false;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
	} else {
		child.kill("SIGTERM");
	}
	closeServiceLog();
}

function desktopLogPath(): string {
	const logDir = app.getPath("logs");
	fs.mkdirSync(logDir, { recursive: true });
	return path.join(logDir, "desktop.log");
}

function writeDesktopLog(message: string): void {
	try {
		fs.appendFileSync(desktopLogPath(), `${new Date().toISOString()} ${message}\n`);
	} catch {
		// Logging must never prevent the desktop shell from reporting an error.
	}
}

function closeServiceLog(): void {
	if (serviceLogFd === null) return;
	try {
		fs.closeSync(serviceLogFd);
	} catch {
		// The child may already have closed the descriptor.
	}
	serviceLogFd = null;
}

async function sleep(ms: number): Promise<void> {
	const deferred = Promise.withResolvers<void>();
	setTimeout(deferred.resolve, ms);
	await deferred.promise;
}

async function serviceIsReady(): Promise<boolean> {
	try {
		// /api/sessions 走 in-process gateway（不依赖 web-ui 子进程），必须再
		// 探测主页：主代理 / → 随机端口 web-ui 子进程，子进程未就绪时 502。
		const [gateway, page, stats] = await Promise.all([
			fetch(`${WEB_UI_URL}/api/sessions`),
			fetch(`${WEB_UI_URL}/`),
			fetch(STATS_URL),
		]);
		return gateway.ok && page.ok && stats.ok;
	} catch {
		return false;
	}
}

let serveRestarts = 0;

/**
 * Spawn the service process and wire its failure handling. An unexpected
 * exit is retried once (`service-supervision` policy) before it is treated
 * as fatal: the renderer already retries its load URL on connection
 * refusal, so the window heals itself once the service answers again.
 * Returns false when the spawn itself failed (failure already surfaced).
 */
function startServeOnce(cmd: ServeCommand): boolean {
	try {
		writeDesktopLog(`Starting service: ${cmd.file}`);
		serviceLogFd = fs.openSync(desktopLogPath(), "a");
		serveChild = spawn(cmd.file, cmd.args, {
			cwd: cmd.cwd,
			env: cmd.env,
			windowsHide: true,
			stdio: ["ignore", serviceLogFd, serviceLogFd],
		});
		serviceOwned = true;
	} catch (err) {
		closeServiceLog();
		showServiceFailure(`Could not start the Zeta service: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}

	const child = serveChild;
	child.once("error", err => {
		if (serveChild !== child) return;
		serveChild = null;
		serviceOwned = false;
		closeServiceLog();
		showServiceFailure(`Could not start the Zeta service: ${err.message}`);
	});
	child.once("exit", code => {
		if (serveChild !== child) return;
		serveChild = null;
		serviceOwned = false;
		closeServiceLog();
		if (quitting) return;
		if (shouldRestartServe(serveRestarts)) {
			serveRestarts++;
			writeDesktopLog(
				`Zeta service exited unexpectedly (exit ${code}); restarting (${serveRestarts}/${SERVICE_MAX_RESTARTS}).`,
			);
			if (!startServeOnce(cmd)) return;
			void waitForService(READY_TIMEOUT_MS).then(ready => {
				if (quitting) return;
				if (ready) {
					serveRestarts = 0;
					writeDesktopLog("Zeta service restarted and is ready.");
				} else {
					showServiceFailure("The Zeta service did not become ready after a restart.");
				}
			});
			return;
		}
		const hint =
			code !== 0
				? " The service may have failed to bind port 30141 (already in use by another zeta process). Close other zeta instances and retry."
				: "";
		showServiceFailure(`The Zeta service stopped unexpectedly (exit ${code}).${hint}`);
	});
	return true;
}

async function waitForService(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await serviceIsReady()) return true;
		await sleep(POLL_INTERVAL_MS);
	}
	return false;
}

async function ensureDefaultWorkspace(): Promise<void> {
	try {
		const response = await fetch(`${WEB_UI_URL}/api/default-cwd`, { method: "POST" });
		if (!response.ok) writeDesktopLog(`Could not create the default workspace: HTTP ${response.status}`);
	} catch (err) {
		writeDesktopLog(`Could not create the default workspace: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function showServiceFailure(message: string): void {
	if (quitting) return;
	writeDesktopLog(`Service failure: ${message}`);
	quitting = true;
	killServe();
	dialog.showErrorBox("Zeta", message);
	app.quit();
}

// ---------------------------------------------------------------------------
// Window + menu
// ---------------------------------------------------------------------------

function iconPath(): string | undefined {
	const candidate = app.isPackaged
		? path.join(process.resourcesPath, "icon.ico")
		: (() => {
				const repoRoot = findRepoRoot();
				return repoRoot ? path.join(repoRoot, "temp", "desktop", "build", "icon.ico") : undefined;
			})();
	return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

function loadFailurePage(win: BrowserWindow, detail: string): void {
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>Zeta</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#102c31;color:#eafff9;font:16px system-ui,sans-serif}main{max-width:36rem;padding:2rem}h1{margin:0 0:.75rem;color:#48ddc2;font-size:1.4rem}p{line-height:1.6;color:#b9d8d4}</style></head><body><main><h1>Zeta Web UI could not load</h1><p>${detail}</p></main></body></html>`;
	void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
}

function createWindow(prefs: TrayPrefs): BrowserWindow {
	const restored = restoredWindowBounds();
	const win = new BrowserWindow({
		width: restored?.bounds.width ?? 1440,
		height: restored?.bounds.height ?? 900,
		x: restored?.bounds.x,
		y: restored?.bounds.y,
		minWidth: 960,
		minHeight: 600,
		autoHideMenuBar: true,
		// Frameless on every platform: the Web UI draws its own 30px titlebar
		// (minimize / maximize / close) so the chrome looks identical on
		// Windows, macOS and Linux.
		frame: false,
		title: "Zeta",
		icon: iconPath(),
		backgroundColor: "#102c31",
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	if (!win.isDestroyed()) void win.loadURL(WEB_UI_URL).catch(() => {});
	win.on("close", event => {
		// Minimize-to-tray (default): closing the window hides it and keeps the
		// service + tray alive. Only a real quit (tray menu / Cmd+Q / app.quit)
		// destroys the window.
		captureCurrentBounds(win);
		if (prefs.minimizeToTray && tray !== null && !quitting) {
			event.preventDefault();
			win.hide();
			saveWorkspaceState();
			return;
		}
		mainWindow = null;
		saveWorkspaceState();
	});
	mainWindow = win;
	if (restored?.maximized) win.maximize();
	// Keep the persisted window position in sync (debounced) so the next
	// launch restores the same geometry.
	win.on("resize", () => captureCurrentBounds(win));
	win.on("move", () => captureCurrentBounds(win));
	// Keep the self-drawn titlebar in sync with the real window state.
	win.on("maximize", () => pushWindowState(win));
	win.on("unmaximize", () => pushWindowState(win));
	win.on("enter-full-screen", () => pushWindowState(win));
	win.on("leave-full-screen", () => pushWindowState(win));
	// window.open / target=_blank (OAuth provider logins, external links) must
	// never spawn an embedded Electron BrowserWindow with its own isolated
	// cookie jar: hand http(s) targets to the system default browser — the
	// same shell the CLI login opens — and deny every other scheme.
	win.webContents.setWindowOpenHandler(({ url }) => {
		try {
			const { protocol } = new URL(url);
			if (protocol === "http:" || protocol === "https:") void shell.openExternal(url);
		} catch {
			// Unparseable opener target — nothing to hand off; deny below.
		}
		return { action: "deny" };
	});
	win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
		writeDesktopLog(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
	});
	win.webContents.once("did-finish-load", () => {
		writeDesktopLog("Renderer finished loading the Web UI.");
		pushWindowState(win);
	});
	win.webContents.on("did-fail-load", (_event, code, desc, validatedUrl, isMainFrame) => {
		writeDesktopLog(`Renderer load failure: code=${code} url=${validatedUrl} detail=${desc}`);
		if (!isMainFrame) return;
		if (desc.includes("ERR_CONNECTION_REFUSED")) {
			setTimeout(() => {
				if (!win.isDestroyed()) void win.loadURL(WEB_UI_URL).catch(() => {});
			}, 1500);
			return;
		}
		loadFailurePage(win, `The local service returned ${desc || `error ${code}`}.`);
	});
	let rendererCrashes = 0;
	let rendererCrashWindowStart = 0;
	win.webContents.on("render-process-gone", (_event, details) => {
		writeDesktopLog(`Renderer process gone: ${details.reason} (${details.exitCode})`);
		if (quitting || win.isDestroyed()) return;
		// Self-heal: a one-off renderer crash (GPU/compositor hiccups included)
		// recovers with a reload instead of leaving a dead white window. Give up
		// after repeated crashes within a short window — that points at a
		// persistent fault, and the failure page explains it.
		const now = Date.now();
		if (now - rendererCrashWindowStart > RENDERER_CRASH_WINDOW_MS) {
			rendererCrashWindowStart = now;
			rendererCrashes = 0;
		}
		rendererCrashes++;
		if (rendererCrashes <= RENDERER_CRASH_RELOAD_LIMIT) {
			writeDesktopLog(`Reloading renderer after crash (${rendererCrashes}/${RENDERER_CRASH_RELOAD_LIMIT})`);
			setTimeout(() => {
				if (!quitting && !win.isDestroyed()) void win.loadURL(WEB_UI_URL).catch(() => {});
			}, 500);
		} else {
			loadFailurePage(win, `The Web UI renderer crashed repeatedly (${details.reason}).`);
		}
	});
	return win;
}

interface TrayPrefs {
	minimizeToTray: boolean;
	autostart: boolean;
	desktopLabels: DesktopLabels;
}

interface DesktopLabels {
	showWindow: string;
	statsDashboard: string;
	openSettings: string;
	quit: string;
	webUi: string;
	reload: string;
	notifications: string;
}

const DEFAULT_DESKTOP_LABELS: DesktopLabels = {
	showWindow: "Show Window",
	statsDashboard: "Stats Dashboard",
	openSettings: "Open Settings",
	quit: "Quit",
	webUi: "Web UI",
	reload: "Reload",
	notifications: "Notifications",
};
/**
 * Read tray/autostart preferences from the gateway's /api/web-config over HTTP.
 * The desktop shell never imports packages/* source; it talks to the backend
 * only through the local gateway (see AGENTS.md "Code Location Rules").
 */
async function readTrayPrefs(): Promise<TrayPrefs> {
	try {
		const response = await fetch(`${WEB_UI_URL}/api/web-config`, {
			headers: { "x-zeta-locale": app.getLocale() },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = (await response.json()) as {
			tray?: { minimizeToTray?: boolean; autostart?: boolean };
			desktopLabels?: Partial<DesktopLabels>;
		};
		return {
			minimizeToTray: data.tray?.minimizeToTray ?? true,
			autostart: data.tray?.autostart ?? false,
			desktopLabels: { ...DEFAULT_DESKTOP_LABELS, ...data.desktopLabels },
		};
	} catch (err) {
		writeDesktopLog(`Could not read tray preferences: ${err instanceof Error ? err.message : String(err)}`);
		return { minimizeToTray: true, autostart: false, desktopLabels: DEFAULT_DESKTOP_LABELS };
	}
}

/**
 * Open the stats dashboard in its own window. The main window always stays on
 * the Web UI; navigating it to the stats SPA left no way back (the app menu
 * is hidden in tray mode).
 */
function openStatsWindow(): void {
	if (statsWindow && !statsWindow.isDestroyed()) {
		if (statsWindow.isMinimized()) statsWindow.restore();
		statsWindow.show();
		statsWindow.focus();
		return;
	}
	statsWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		autoHideMenuBar: true,
		title: "Zeta Stats",
	});
	statsWindow.on("closed", () => {
		statsWindow = null;
	});
	statsWindow.loadURL(STATS_URL).catch((err: unknown) => {
		writeDesktopLog(`Could not load stats dashboard: ${err instanceof Error ? err.message : String(err)}`);
	});
}

function trayIcon(): Electron.NativeImage {
	const icon = iconPath();
	if (icon) {
		const img = nativeImage.createFromPath(icon);
		if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
	}
	return nativeImage.createEmpty();
}

function showMainWindow(): void {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
}

let trayLabels: DesktopLabels = DEFAULT_DESKTOP_LABELS;

function trayContextMenu(): Electron.MenuItemConstructorOptions[] {
	return [
		{ label: trayLabels.showWindow, click: () => showMainWindow() },
		{ label: trayLabels.statsDashboard, click: () => openStatsWindow() },
		{
			label: trayLabels.openSettings,
			click: () => {
				// The tray can own the only window (hidden to tray), so surface it
				// before deep-linking into the settings panel modal.
				showMainWindow();
				mainWindow?.loadURL(`${WEB_UI_URL}/?panel=settings`);
			},
		},
		{ type: "separator" },
		{
			label: trayLabels.notifications,
			type: "checkbox",
			checked: desktopSettings.notifications,
			click: () => toggleNotifications(),
		},
		{ type: "separator" },
		{
			label: trayLabels.quit,
			click: () => {
				quitting = true;
				app.quit();
			},
		},
	];
}

function refreshTrayMenu(): void {
	if (!tray || tray.isDestroyed()) return;
	tray.setContextMenu(Menu.buildFromTemplate(trayContextMenu()));
}

/** Mirror the running-session count in the tray tooltip (0 → plain name). */
function updateTrayRunningCount(runningCount: number): void {
	if (!tray || tray.isDestroyed()) return;
	tray.setToolTip(runningTooltip(runningCount));
}

function toggleNotifications(): void {
	desktopSettings = { ...desktopSettings, notifications: !desktopSettings.notifications };
	writeDesktopSettingsAtomic(app.getPath("userData"), desktopSettings);
	refreshTrayMenu();
}

function createTray(labels: DesktopLabels): void {
	if (tray) return;
	trayLabels = labels;
	tray = new Tray(trayIcon());
	tray.setToolTip(runningTooltip(0));
	refreshTrayMenu();
	tray.on("double-click", showMainWindow);
}

/**
 * Enable OS autostart (Windows/macOS login item, Linux ~/.config/autostart
 * desktop entry). Creating/removing the Linux entry keeps it in sync with the
 * web.yml toggle driven from the settings panel.
 */
function applyAutostart(enabled: boolean): void {
	app.setLoginItemSettings({ openAtLogin: enabled });
	if (process.platform === "linux") {
		const autostartDir = path.join(app.getPath("home"), ".config", "autostart");
		const entryPath = path.join(autostartDir, "zeta.desktop");
		if (enabled) {
			const execPath = app.isPackaged ? app.getPath("exe") : process.execPath;
			fs.mkdirSync(autostartDir, { recursive: true });
			fs.writeFileSync(entryPath, `[Desktop Entry]\nType=Application\nName=Zeta\nExec="${execPath}"\n`, "utf8");
		} else if (fs.existsSync(entryPath)) {
			fs.unlinkSync(entryPath);
		}
	}
}

function buildMenu(labels: DesktopLabels): void {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "Zeta",
			submenu: [
				{ label: labels.webUi, accelerator: "CmdOrCtrl+1", click: () => mainWindow?.loadURL(WEB_UI_URL) },
				{ label: labels.statsDashboard, accelerator: "CmdOrCtrl+2", click: () => openStatsWindow() },
				{ type: "separator" },
				{ label: labels.reload, accelerator: "CmdOrCtrl+R", click: () => mainWindow?.webContents.reload() },
				{ type: "separator" },
				{ label: labels.quit, accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
	// 总是启动自己的服务，绝不静默复用外部实例：外部 `zeta serve` 可能指向
	// 不同的工作目录/版本，复用会挂载错误的会话与配置。若端口 30141 已被
	// 其他 zeta 进程占用，服务绑定失败退出，错误提示见下方 exit 处理器。

	const cmd = resolveServeCommand();
	if (!cmd) {
		showServiceFailure("The bundled Zeta service is incomplete. Reinstall the desktop package.");
		return;
	}
	// `zeta-d -d <cwd>` / `zeta --desktop <cwd>`: open the requested workspace.
	const requestedCwd = parseRequestedCwd();
	if (requestedCwd) cmd.cwd = requestedCwd;
	serviceWorkspacePath = path.resolve(cmd.cwd);
	cmd.env = desktopServiceEnv(cmd.env);

	if (!startServeOnce(cmd)) return;

	const ready = await waitForService(READY_TIMEOUT_MS);
	if (!ready) {
		showServiceFailure("The Zeta service did not become ready in time.");
		return;
	}

	await ensureDefaultWorkspace();
	writeDesktopLog("Service is ready.");

	const prefs = await readTrayPrefs();
	applyAutostart(prefs.autostart);
	desktopSettings = readDesktopSettings(app.getPath("userData"));
	workspaceState = readWorkspaceState(app.getPath("userData"));
	buildMenu(prefs.desktopLabels);
	createTray(prefs.desktopLabels);
	createWindow(prefs);
	startSessionMonitor();
}

app.setName("Zeta");
app.setAppUserModelId("com.zeta.desktop");

app.requestSingleInstanceLock();
if (!app.hasSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		}
	});

	app.whenReady()
		.then(boot)
		.catch((err: unknown) => {
			showServiceFailure(`The desktop shell could not start: ${err instanceof Error ? err.message : String(err)}`);
		});

	app.on("before-quit", () => {
		quitting = true;
		stopSessionMonitor();
		if (mainWindow && !mainWindow.isDestroyed()) captureCurrentBounds(mainWindow);
		saveWorkspaceState();
		killServe();
	});

	app.on("window-all-closed", () => {
		// Tray mode (default): closing the window must NOT quit the app; the
		// tray keeps the service running until "Quit" from the tray/menu.
		if (quitting || tray === null) app.quit();
	});
}
