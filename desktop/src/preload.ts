import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

interface DesktopOpenTarget {
	id: string;
	label: string;
}

interface GatewayOpenPath {
	path: string;
	token: string;
}

interface WorkspaceFileTargetInput {
	readonly workspaceId: string;
	readonly path: string;
	readonly kind: "file" | "dir";
}

type WorkspaceFileActionResult =
	| { readonly status: "opened" }
	| { readonly status: "cancelled" }
	| { readonly status: "failed"; readonly message: string };

type WorkspaceShellEditorResult = { readonly status: "opened"; readonly editorName?: string } | { readonly status: "cancelled" };

type PlanSaveResult =
	| { readonly status: "picked"; readonly relativePath: string }
	| { readonly status: "cancelled" }
	| { readonly status: "outside-workspace"; readonly fileName: string };

type DroppedPathResult =
	| {
			readonly ok: true;
			readonly kind: "file" | "dir" | "image";
			readonly scope: "workspace" | "absolute";
			readonly path: string;
			readonly name: string;
	  }
	| { readonly ok: false; readonly reason: "missing" | "invalid" };

interface DesktopUpdateCheck {
	readonly checkedAt: string;
	readonly app: { readonly currentVersion?: string; readonly plan: "none" };
	readonly runtime: { readonly plan: "none" | "available" | "blocked"; readonly runtimeVersion?: string; readonly reason?: string };
	readonly error?: string;
}

interface DesktopExternalOpen {
	readonly kind: "url" | "file" | "workspace";
	readonly value: string;
}

/**
 * Renderer bridge for desktop-only capabilities.
 *
 * One capability object, exposed under both names the renderer generations
 * read: `window.piDesktop` (Window-control/titlebar contract) and
 * `window.zetaStudioChrome` (the Studio chrome contract: pickers, project and
 * file shell actions, app metadata). Exposing the same object twice keeps the
 * two contracts from drifting and lets feature detection work either way.
 *
 * In a plain browser tab neither global exists, so the renderer keeps its
 * browser fallbacks instead of showing dead desktop affordances.
 */
const bridge = {
	// -------------------------------------------------------------------------
	// Self-drawn titlebar (frameless window on all platforms)
	// -------------------------------------------------------------------------

	/** Minimize the window. */
	minimize: (): Promise<void> => ipcRenderer.invoke("pi:window-minimize"),
	/** Toggle between maximized and restored. */
	maximize: (): Promise<void> => ipcRenderer.invoke("pi:window-maximize"),
	/** Close the window — the main process still applies minimize-to-tray. */
	close: (): Promise<void> => ipcRenderer.invoke("pi:window-close"),
	/** Query whether the window is currently maximized. */
	isMaximized: (): Promise<boolean> =>
		ipcRenderer.invoke("pi:window-state").then((state: unknown) => Boolean((state as { maximized?: boolean } | null)?.maximized)),
	/**
	 * Subscribe to window-state changes (maximize / restore / full screen).
	 * Returns an unsubscribe function.
	 */
	onWindowState: (callback: (state: { maximized: boolean }) => void): (() => void) => {
		const listener = (_event: IpcRendererEvent, state: { maximized: boolean }): void => callback(state);
		ipcRenderer.on("pi:window-state", listener);
		return () => ipcRenderer.removeListener("pi:window-state", listener);
	},

	// -------------------------------------------------------------------------
	// Native pickers, host open targets, companion tools
	// -------------------------------------------------------------------------

	/** Open the OS directory picker; resolves to the chosen path or null on cancel. */
	selectDirectory: (startPath?: string): Promise<string | null> => ipcRenderer.invoke("pi:select-directory", startPath),
	/** Pick a directory and register it as a project (native "Open Folder"). */
	pickWorkspace: (input?: { startPath?: string; alias?: string }): Promise<{ cancelled: boolean; name?: string }> =>
		ipcRenderer.invoke("pi:pick-workspace", input),
	/** Host-defined open targets; IDs are opaque to the renderer. */
	getOpenTargets: (): Promise<DesktopOpenTarget[]> => ipcRenderer.invoke("pi:open-targets"),
	/** Opens only a gateway-authorized directory through a host-defined target. */
	openTarget: (targetId: string, gatewayPath: GatewayOpenPath): Promise<void> =>
		ipcRenderer.invoke("pi:open-target", targetId, gatewayPath),
	/**
	 * Spawn a companion tool (zetacode / zetaide) in a directory.
	 * zetacode launches get an isolated --session-dir so `opts.resume` can
	 * continue the newest session there on the next launch.
	 */
	spawnTool: (toolId: string, cwd?: string, opts?: { resume?: boolean }): Promise<{ tool: string; cwd: string; pid: number | null; sessionDir?: string }> =>
		ipcRenderer.invoke("pi:spawn-tool", toolId, cwd, opts),

	// -------------------------------------------------------------------------
	// Workspace + file shell actions (paths stay in Main)
	// -------------------------------------------------------------------------

	/** Open the workspace directory in the first installed editor. */
	openProjectInEditor: (workspaceId: string): Promise<WorkspaceShellEditorResult> =>
		ipcRenderer.invoke("pi:workspace-open-editor", workspaceId),
	/** Open the workspace directory in the OS file manager. */
	openProjectDirectory: (workspaceId: string): Promise<void> => ipcRenderer.invoke("pi:workspace-open-directory", workspaceId),
	/** Electron `webUtils.getPathForFile` for dropped / pasted File objects. */
	getPathForFile: (file: File): string | null => {
		try {
			return webUtils.getPathForFile(file) || null;
		} catch {
			return null;
		}
	},
	/** Classify dropped absolute paths as workspace-relative or machine-absolute. */
	resolveDroppedPaths: (workspaceId: string, paths: readonly string[]): Promise<ReadonlyArray<DroppedPathResult>> =>
		ipcRenderer.invoke("pi:resolve-dropped-paths", workspaceId, paths),
	/** Native save dialog seeded at `<workspace>/PLAN.md`. */
	pickPlanSavePath: (input: { workspaceId: string }): Promise<PlanSaveResult> => ipcRenderer.invoke("pi:pick-plan-save", input),
	/** Open a workspace file with the OS default association. */
	openFile: (input: WorkspaceFileTargetInput): Promise<WorkspaceFileActionResult> => ipcRenderer.invoke("pi:file-open", input),
	/** Open a workspace file/directory with a named editor or the OS chooser. */
	openFileWith: (
		input: WorkspaceFileTargetInput & { readonly openerId: "vscode" | "cursor" | "windsurf" | "choose" },
	): Promise<WorkspaceFileActionResult> => ipcRenderer.invoke("pi:file-open-with", input),
	/** Select the target in the file manager (directories open their parent). */
	revealFileInFileManager: (input: WorkspaceFileTargetInput): Promise<WorkspaceFileActionResult> =>
		ipcRenderer.invoke("pi:file-reveal", input),
	/** Resolve a workspace-relative path to its checked absolute path. */
	resolveFileAbsolutePath: (input: WorkspaceFileTargetInput): Promise<string> => ipcRenderer.invoke("pi:file-resolve", input),
	/** Installed editors plus the OS chooser, for the "Open With" menu. */
	listFileOpeners: (_input: { workspaceId: string }): Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>> =>
		ipcRenderer.invoke("pi:file-openers"),

	// -------------------------------------------------------------------------
	// App chrome
	// -------------------------------------------------------------------------

	/** Fixed by the preload; read it through `src/platform.ts`. */
	platform: process.platform,

	getAppVersion: (): Promise<{ readonly version: string; readonly bundledVersion: string }> => ipcRenderer.invoke("pi:app-version"),
	/** Runtime update availability, mapped from the gateway's existing check. */
	checkUpdates: (): Promise<DesktopUpdateCheck | null> => ipcRenderer.invoke("pi:update-check"),
	/** Open an http(s) URL in the system browser (never an Electron window). */
	openUrl: (payload: { url: string }): Promise<void> => ipcRenderer.invoke("pi:open-url", payload),
	/** App-level system notification with fixed copy. */
	notify: (payload: { title: string; body?: string }): Promise<void> => ipcRenderer.invoke("pi:notify", payload),
	/** Open the Host log directory (the path stays in Main). */
	openLogDir: (): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
		ipcRenderer.invoke("pi:open-log-dir"),
	/** Save a copy of the Host log (the path stays in Main). */
	exportLogs: (): Promise<
		{ readonly ok: true } | { readonly ok: false; readonly cancelled: true } | { readonly ok: false; readonly message: string }
	> => ipcRenderer.invoke("pi:export-logs"),
	/** One process memory sample projected from `app.getAppMetrics()`. */
	sampleProcessMemory: (): Promise<{
		readonly capturedAt: string;
		readonly totalWorkingSetKb: number;
		readonly rows: ReadonlyArray<{
			readonly kind: string;
			readonly ordinal: number;
			readonly workingSetKb: number;
			readonly peakWorkingSetKb?: number;
		}>;
	} | null> => ipcRenderer.invoke("pi:sample-memory"),
	/** Menu/tray commands forwarded from Main (settings, palette, project picker…). */
	onMenuCommand: (listener: (command: string) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, command: string): void => listener(command);
		ipcRenderer.on("pi:menu-command", handler);
		return () => ipcRenderer.removeListener("pi:menu-command", handler);
	},
	/** OS-opened URLs/files (single-instance argv, open-url/open-file). */
	onExternalOpen: (listener: (request: DesktopExternalOpen) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, request: DesktopExternalOpen): void => listener(request);
		ipcRenderer.on("pi:external-open", handler);
		return () => ipcRenderer.removeListener("pi:external-open", handler);
	},
};

export type PiDesktopApi = typeof bridge;

contextBridge.exposeInMainWorld("piDesktop", bridge);
contextBridge.exposeInMainWorld("zetaStudioChrome", bridge);
