/**
 * Zeta desktop shell — main process.
 *
 * Starts the local Zeta service (`zeta serve`, no browser, no console window),
 * waits for the Web UI on 30141, then hosts it in an embedded Electron window.
 * The system browser is never opened and no terminal window appears.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog, nativeImage, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const WEB_UI_URL = "http://127.0.0.1:30141";
const STATS_URL = "http://127.0.0.1:3847";
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 400;
const SERVICE_BINARY_NAME = process.platform === "win32" ? "zeta.exe" : "zeta";
const WEB_RUNTIME_NAME = process.platform === "win32" ? "node.exe" : "node";

let serveChild: ChildProcess | null = null;
let serviceLogFd: number | null = null;
let serviceOwned = false;
let quitting = false;

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
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory", "createDirectory"],
		defaultPath: typeof startPath === "string" && startPath.length > 0 ? startPath : undefined,
	});
	return result.canceled ? null : (result.filePaths[0] ?? null);
});
let mainWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---------------------------------------------------------------------------
// Service resolution
// ---------------------------------------------------------------------------

function findRepoRoot(): string | null {
	// __dirname = <repo>/desktop/dist in dev; walk up until package.json with
	// "workspaces" (or the coding-agent package) is found.
	let dir = __dirname;
	for (let i = 0; i < 6; i++) {
		const pkgJson = path.join(dir, "package.json");
		if (fs.existsSync(pkgJson)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as PackageManifest;
				if (pkg.workspaces || pkg.name === "zeta" || fs.existsSync(path.join(dir, "packages", "coding-agent"))) {
					return dir;
				}
			} catch {
				// keep walking
			}
		}
		dir = path.dirname(dir);
	}
	return null;
}

interface PackageManifest {
	name?: string;
	workspaces?: unknown;
}

interface ServeCommand {
	file: string;
	args: string[];
	/** Working directory for the service process (web-ui lookup walks cwd). */
	cwd: string;
	env: NodeJS.ProcessEnv;
}

function parseCommand(command: string): string[] {
	return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^("|')|("|')$/g, ""));
}

function bundledServeCommand(): ServeCommand | null {
	if (!app.isPackaged) return null;

	const serviceDir = path.join(process.resourcesPath, "zeta");
	const exe = path.join(serviceDir, SERVICE_BINARY_NAME);
	const runtime = path.join(serviceDir, WEB_RUNTIME_NAME);
	const standaloneServer = path.join(serviceDir, "web-ui", ".next", "standalone", "server.js");
	if (!fs.existsSync(exe) || !fs.existsSync(runtime) || !fs.existsSync(standaloneServer)) {
		return null;
	}

	return {
		file: exe,
		args: ["serve"],
		cwd: serviceDir,
		env: {
			...process.env,
			ZETA_DESKTOP: "1",
			ZETA_WEB_RUNTIME: runtime,
		},
	};
}

function resolveServeCommand(): ServeCommand | null {
	const bundled = bundledServeCommand();
	if (bundled) return bundled;
	if (app.isPackaged) return null;

	const repoRoot = findRepoRoot();

	const fromEnv = process.env.ZETA_SERVE_COMMAND;
	if (fromEnv) {
		const [file, ...args] = parseCommand(fromEnv);
		if (file) {
			return {
				file,
				args: args.length > 0 ? args : ["serve"],
				cwd: (process.env.ZETA_SERVE_CWD ?? repoRoot) ?? process.cwd(),
				env: { ...process.env, ZETA_DESKTOP: "1" },
			};
		}
	}

	if (repoRoot) {
		const exe = path.join(repoRoot, "packages", "coding-agent", "dist", SERVICE_BINARY_NAME);
		if (fs.existsSync(exe)) {
			return { file: exe, args: ["serve"], cwd: repoRoot, env: { ...process.env, ZETA_DESKTOP: "1" } };
		}
		// Dev fallback: run the source CLI with Bun (PATH lookup).
		const cli = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
		if (fs.existsSync(cli)) {
			return {
				file: "bun",
				args: [cli, "serve"],
				cwd: repoRoot,
				env: { ...process.env, ZETA_DESKTOP: "1" },
			};
		}
	}

	// Last resort: a `zeta` binary on PATH.
	return { file: "zeta", args: ["serve"], cwd: process.cwd(), env: { ...process.env, ZETA_DESKTOP: "1" } };
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
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		autoHideMenuBar: true,
		title: "Zeta",
		icon: iconPath(),
		backgroundColor: "#102c31",
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	void resolveWebUiRoot().then((root) => {
		if (!win.isDestroyed()) void win.loadURL(root).catch(() => {});
	});
	win.on("close", (event) => {
		// Minimize-to-tray (default): closing the window hides it and keeps the
		// service + tray alive. Only a real quit (tray menu / Cmd+Q / app.quit)
		// destroys the window.
		if (prefs.minimizeToTray && tray !== null && !quitting) {
			event.preventDefault();
			win.hide();
			return;
		}
		mainWindow = null;
	});
	mainWindow = win;
	win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
		writeDesktopLog(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
	});
	win.webContents.once("did-finish-load", () => {
		writeDesktopLog("Renderer finished loading the Web UI.");
	});
	win.webContents.on("did-fail-load", (_event, code, desc, validatedUrl, isMainFrame) => {
		writeDesktopLog(`Renderer load failure: code=${code} url=${validatedUrl} detail=${desc}`);
		if (!isMainFrame) return;
		if (desc.includes("ERR_CONNECTION_REFUSED")) {
			setTimeout(() => {
				if (!win.isDestroyed()) {
					void resolveWebUiRoot().then((root) => {
						if (!win.isDestroyed()) void win.loadURL(root).catch(() => {});
					});
				}
			}, 1500);
			return;
		}
		loadFailurePage(win, `The local service returned ${desc || `error ${code}`}.`);
	});
	win.webContents.on("render-process-gone", (_event, details) => {
		writeDesktopLog(`Renderer process gone: ${details.reason} (${details.exitCode})`);
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
}

const DEFAULT_DESKTOP_LABELS: DesktopLabels = {
	showWindow: "Show Window",
	statsDashboard: "Stats Dashboard",
	openSettings: "Open Settings",
	quit: "Quit",
	webUi: "Web UI",
	reload: "Reload",
};

/**
 * Root URL for the embedded UI — /next/ when the gateway reports uiVersion=next,
 * else / (web-ui). Same HTTP-only contract as readTrayPrefs.
 */
async function resolveWebUiRoot(): Promise<string> {
	try {
		const response = await fetch(`${WEB_UI_URL}/api/web-config`);
		if (response.ok) {
			const data = (await response.json()) as { uiVersion?: string };
			if (data.uiVersion === "next") {
				return `${WEB_UI_URL}/next/`;
			}
		}
	} catch {
		// fall through to the legacy UI
	}
	return WEB_UI_URL;
}

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

function createTray(labels: DesktopLabels): void {
	if (tray) return;
	tray = new Tray(trayIcon());
	const contextMenu = Menu.buildFromTemplate([
		{
			label: labels.showWindow,
			click: () => {
				if (!mainWindow) return;
				if (mainWindow.isMinimized()) mainWindow.restore();
				mainWindow.show();
				mainWindow.focus();
			},
		},
		{ label: labels.statsDashboard, click: () => openStatsWindow() },
		{ label: labels.openSettings, click: () => mainWindow?.loadURL(`${WEB_UI_URL}/settings`) },
		{ type: "separator" },
		{
			label: labels.quit,
			click: () => {
				quitting = true;
				app.quit();
			},
		},
	]);
	tray.setToolTip("Zeta");
	tray.setContextMenu(contextMenu);
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
		return;
	}

	const child = serveChild;
	child.once("error", (err) => {
		if (serveChild !== child) return;
		serveChild = null;
		serviceOwned = false;
		closeServiceLog();
		showServiceFailure(`Could not start the Zeta service: ${err.message}`);
	});
	child.once("exit", (code) => {
		if (serveChild !== child) return;
		serveChild = null;
		serviceOwned = false;
		closeServiceLog();
		if (!quitting) {
			const hint =
				code !== 0
					? " The service may have failed to bind port 30141 (already in use by another zeta process). Close other zeta instances and retry."
					: "";
			showServiceFailure(`The Zeta service stopped unexpectedly (exit ${code}).${hint}`);
		}
	});

	const ready = await waitForService(READY_TIMEOUT_MS);
	if (!ready) {
		showServiceFailure("The Zeta service did not become ready in time.");
		return;
	}

	await ensureDefaultWorkspace();
	writeDesktopLog("Service is ready.");

	const prefs = await readTrayPrefs();
	applyAutostart(prefs.autostart);
	buildMenu(prefs.desktopLabels);
	createTray(prefs.desktopLabels);
	createWindow(prefs);
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

	app.whenReady().then(boot).catch((err: unknown) => {
		showServiceFailure(`The desktop shell could not start: ${err instanceof Error ? err.message : String(err)}`);
	});

	app.on("before-quit", () => {
		quitting = true;
		killServe();
	});

	app.on("window-all-closed", () => {
		// Tray mode (default): closing the window must NOT quit the app; the
		// tray keeps the service running until "Quit" from the tray/menu.
		if (quitting || tray === null) app.quit();
	});
}
