/**
 * Zeta desktop shell — main process.
 *
 * Starts the local Zeta service (`zeta serve`, no browser, no console window),
 * waits for the Web UI on 30141, then hosts it in an embedded Electron window.
 * The system browser is never opened and no terminal window appears.
 */

import { app, BrowserWindow, Menu, dialog } from "electron";
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
let mainWindow: BrowserWindow | null = null;

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
		const [webUi, stats] = await Promise.all([fetch(`${WEB_UI_URL}/api/sessions`), fetch(STATS_URL)]);
		return webUi.ok && stats.ok;
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

function createWindow(): BrowserWindow {
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
		},
	});

	void win.loadURL(WEB_UI_URL).catch(() => {});
	win.on("close", () => {
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
				if (!win.isDestroyed()) void win.loadURL(WEB_UI_URL).catch(() => {});
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

function buildMenu(): void {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "Zeta",
			submenu: [
				{ label: "Web UI", accelerator: "CmdOrCtrl+1", click: () => mainWindow?.loadURL(WEB_UI_URL) },
				{ label: "Stats Dashboard", accelerator: "CmdOrCtrl+2", click: () => mainWindow?.loadURL(STATS_URL) },
				{ type: "separator" },
				{ label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.webContents.reload() },
				{ type: "separator" },
				{ label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
	if (await serviceIsReady()) {
		writeDesktopLog("Reusing an already-running local Zeta service.");
		await ensureDefaultWorkspace();
		buildMenu();
		createWindow();
		return;
	}

	const cmd = resolveServeCommand();
	if (!cmd) {
		showServiceFailure("The bundled Zeta service is incomplete. Reinstall the desktop package.");
		return;
	}

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
			showServiceFailure(`The Zeta service stopped unexpectedly (exit ${code}).`);
		}
	});

	const ready = await waitForService(READY_TIMEOUT_MS);
	if (!ready) {
		showServiceFailure("The Zeta service did not become ready in time.");
		return;
	}

	await ensureDefaultWorkspace();
	writeDesktopLog("Service is ready.");
	buildMenu();
	createWindow();
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
		app.quit();
	});
}
