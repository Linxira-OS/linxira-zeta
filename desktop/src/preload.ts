import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { TerminalCreateInput } from "./terminal/validation";
import type { FileResource, FileResourceTarget } from "./file-resources-shared";
import type { FloatWindowControl, FloatWindowEvent, FloatWindowPrepare, FloatWindowTicket } from "./floating-windows-shared";
import type { PerfProfileSnapshot } from "./perf-profile-shared";
import type { ImageInput, ImageResult, AvatarBytes } from "./chrome-media";
import type { BrowserObservationAttach, BrowserObservationControl, BrowserObservationEvent, BrowserObservationResult } from "./browser-observation-shared";
import type { ManagedBrowserApi, ManagedBrowserCommand, ManagedBrowserEvent, ManagedBrowserPresentation, ManagedBrowserState } from "./managed-browser-protocol";
import type { MemoryCredentialResult } from "./memory-credentials-ipc";
import type { ComputerViewRequest, ComputerViewResult, ComputerFrameRequest, ComputerFrameReadResult } from "./computer-frames-shared";
import type { ComputerCaptureRequest, ComputerCaptureResult } from "./computer-observation-shared";
import type { PredictionChannel, PredictionInput, PredictionEvent, PredictionResult } from "./prediction-protocol";

let privateCapabilities: { browserObservation?: boolean; managedBrowser?: boolean; computerFrames?: boolean; computerCapture?: boolean; prediction?: boolean } | null = null;
try { privateCapabilities = ipcRenderer.sendSync("zeta-studio:desktop:private-capabilities") ?? null; } catch { /* No private producer was discovered. */ }
const browserObservationBridge = privateCapabilities?.browserObservation === true ? {
	attachBrowserObservation: (input: BrowserObservationAttach): Promise<BrowserObservationResult> => ipcRenderer.invoke("zeta-studio:desktop:browser-attach", input),
	controlBrowserObservation: (input: BrowserObservationControl): Promise<BrowserObservationResult> => ipcRenderer.invoke("zeta-studio:desktop:browser-input", input),
	detachBrowserObservation: (input: { observationId: string }): Promise<BrowserObservationResult> => ipcRenderer.invoke("zeta-studio:desktop:browser-detach", input),
	onBrowserObservation: (listener: (event: BrowserObservationEvent) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, payload: BrowserObservationEvent): void => listener(payload);
		ipcRenderer.on("zeta-studio:desktop:browser-event", handler);
		return () => ipcRenderer.removeListener("zeta-studio:desktop:browser-event", handler);
	},
} : {};
const managedBrowserBridge: { managedBrowser?: ManagedBrowserApi } = privateCapabilities?.managedBrowser === true ? {
	managedBrowser: {
		available: (): Promise<boolean> => ipcRenderer.invoke("zeta-studio:managed-browser:available"),
		attach: (input: { sessionId: string; descriptorId: string }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("zeta-studio:managed-browser:attach", input),
		release: (input: { sessionId: string }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("zeta-studio:managed-browser:release", input),
		read: (sessionId: string): Promise<ManagedBrowserState> => ipcRenderer.invoke("zeta-studio:managed-browser:read", sessionId),
		execute: (command: ManagedBrowserCommand): Promise<ManagedBrowserState> => ipcRenderer.invoke("zeta-studio:managed-browser:execute", command),
		present: (presentation: ManagedBrowserPresentation): Promise<void> => ipcRenderer.invoke("zeta-studio:managed-browser:present", presentation),
		subscribe: (listener: (event: ManagedBrowserEvent) => void): (() => void) => {
			const handler = (_event: IpcRendererEvent, event: ManagedBrowserEvent): void => listener(event);
			ipcRenderer.on("zeta-studio:managed-browser:event", handler);
			return () => ipcRenderer.removeListener("zeta-studio:managed-browser:event", handler);
		},
	},
} : {};
const computerFrameBridge = privateCapabilities?.computerFrames === true ? {
	adoptComputerView: (input: ComputerViewRequest): Promise<ComputerViewResult> => ipcRenderer.invoke("zeta-studio:desktop:computer-view-adopt", input),
	releaseComputerView: (input: ComputerViewRequest): Promise<ComputerViewResult> => ipcRenderer.invoke("zeta-studio:desktop:computer-view-release", input),
	readComputerFrame: (input: ComputerFrameRequest): Promise<ComputerFrameReadResult> => ipcRenderer.invoke("zeta-studio:desktop:computer-frame-read", input),
} : {};
const computerCaptureBridge = privateCapabilities?.computerCapture === true ? {
	readComputerCapture: (input: ComputerCaptureRequest): Promise<ComputerCaptureResult> => ipcRenderer.invoke("zeta-studio:desktop:computer-capture", input),
} : {};
const predictionBridge = privateCapabilities?.prediction === true ? {
	attachPrediction: (input: PredictionChannel): Promise<PredictionResult> => ipcRenderer.invoke("zeta-studio:desktop:prediction-attach", input),
	predictionInput: (input: { channelId: string; input: Exclude<PredictionInput, { kind: "import" }> }): Promise<PredictionResult> => ipcRenderer.invoke("zeta-studio:desktop:prediction-input", input),
	detachPrediction: (input: { channelId: string }): Promise<PredictionResult> => ipcRenderer.invoke("zeta-studio:desktop:prediction-detach", input),
	importPredictionHistory: (input: { channelId: string }): Promise<PredictionResult> => ipcRenderer.invoke("zeta-studio:desktop:prediction-import", input),
	onPrediction: (listener: (event: PredictionEvent) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, payload: PredictionEvent): void => listener(payload);
		ipcRenderer.on("zeta-studio:desktop:prediction-event", handler);
		return () => ipcRenderer.removeListener("zeta-studio:desktop:prediction-event", handler);
	},
} : {};

// Electron sandbox preloads can require Electron only; keep runtime channels
// here rather than depending on a local CommonJS module that cannot load.
const liveAudioBridge = {
	attachLiveAudio: (input: { audioId: string; sessionId: string }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("pi:live-audio-attach", input),
	appendLiveAudio: (input: { audioId: string; sequence: number; bytes: ArrayBuffer }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("pi:live-audio-append", input),
	detachLiveAudio: (input: { audioId: string }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("pi:live-audio-detach", input),
	requestMicrophoneAccess: (): Promise<"granted" | "denied"> => ipcRenderer.invoke("pi:request-microphone-access"),
	openMicrophoneSettings: (): Promise<boolean> => ipcRenderer.invoke("pi:open-microphone-settings"),
};

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
 * `window.zetaStudioChrome` owns window controls, pickers, project/file shell
 * actions and app metadata. A plain browser has no preload bridge and keeps
 * its browser capability behavior.
 */
const bridge = {
	...managedBrowserBridge,
	...browserObservationBridge,
	...computerFrameBridge,
	...computerCaptureBridge,
	...predictionBridge,
	memoryCredentialStatus: (input: { targetId: string | null; url: string }): Promise<MemoryCredentialResult> => ipcRenderer.invoke("zeta-studio:memory-credential-status", input),
	setMemoryCredential: (input: { targetId: string | null; url: string; token: string }): Promise<MemoryCredentialResult> => ipcRenderer.invoke("zeta-studio:memory-credential-set", input),
	removeMemoryCredential: (input: { targetId: string | null; url: string }): Promise<MemoryCredentialResult> => ipcRenderer.invoke("zeta-studio:memory-credential-remove", input),
	files: {
		open: (input: FileResourceTarget): Promise<FileResource> => ipcRenderer.invoke("zeta-studio:files-open", input),
		release: (id: string): Promise<void> => ipcRenderer.invoke("zeta-studio:files-release", id),
		export: (input: FileResourceTarget): Promise<boolean> => ipcRenderer.invoke("zeta-studio:files-export", input),
		setDirty: (count: number): Promise<void> => ipcRenderer.invoke("zeta-studio:files-dirty", count),
		onCloseRequested: (listener: (id: string) => void): (() => void) => {
			const handler = (_event: IpcRendererEvent, id: string): void => listener(id);
			ipcRenderer.on("zeta-studio:files-close-requested", handler);
			return () => ipcRenderer.removeListener("zeta-studio:files-close-requested", handler);
		},
		finishClose: (id: string, allow: boolean): Promise<void> => ipcRenderer.invoke("zeta-studio:files-finish-close", id, allow),
	},
	prepareFloatWindow: (input: FloatWindowPrepare): Promise<FloatWindowTicket> => ipcRenderer.invoke("zeta-studio:float:prepare", input),
	controlFloatWindow: (input: FloatWindowControl): Promise<void> => ipcRenderer.invoke("zeta-studio:float:control", input),
	onFloatWindow: (listener: (event: FloatWindowEvent) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, event: FloatWindowEvent): void => listener(event);
		ipcRenderer.on("zeta-studio:float:changed", handler);
		return () => ipcRenderer.removeListener("zeta-studio:float:changed", handler);
	},
	setTheme: (theme: "light" | "dark", tint?: { color: string; symbolColor: string }): Promise<void> => ipcRenderer.invoke("pi:theme", { theme, tint }),
	copyImage: (input: Pick<ImageInput, "mime" | "bytes">): Promise<ImageResult> => ipcRenderer.invoke("pi:image-copy", input),
	saveImage: (input: ImageInput): Promise<ImageResult> => ipcRenderer.invoke("pi:image-save", input),
	saveAvatar: (input: ImageInput): Promise<ImageResult> => ipcRenderer.invoke("pi:avatar-save", input),
	loadAvatar: (): Promise<AvatarBytes | null> => ipcRenderer.invoke("pi:avatar-load"),
	clearAvatar: (): Promise<void> => ipcRenderer.invoke("pi:avatar-clear"),
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
	pickWorkspace: (input?: { startPath?: string; alias?: string }): Promise<{ cancelled: boolean; workspaceId?: string; name?: string }> =>
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

// Audio channels remain fixed and self-contained in this sandbox preload.
Object.assign(bridge, liveAudioBridge);
type RemoteUnsubscribe = () => void;

/**
 * SSH execution targets. Every call is keyed by a saved connection id; the
 * renderer never sees a path to execute or a persisted password. When this
 * object is absent, Work Studio keeps its browser/local path.
 */
const remoteBridge = {
	list: (): Promise<unknown> => ipcRenderer.invoke("pi:remote-list"),
	save: (draft: unknown): Promise<unknown> => ipcRenderer.invoke("pi:remote-save", draft),
	remove: (id: string): Promise<void> => ipcRenderer.invoke("pi:remote-remove", id),
	connect: (id: string, credentials?: { password?: string }): Promise<void> => ipcRenderer.invoke("pi:remote-connect", id, credentials),
	disconnect: (id: string): Promise<void> => ipcRenderer.invoke("pi:remote-disconnect", id),
	approveDeployment: (id: string): Promise<void> => ipcRenderer.invoke("pi:remote-approve", id),
	select: (id: string | null): Promise<void> => ipcRenderer.invoke("pi:remote-select", id),
	directories: (id: string, path?: string): Promise<unknown> => ipcRenderer.invoke("pi:remote-directories", id, path),
	register: (id: string, path: string): Promise<void> => ipcRenderer.invoke("pi:remote-register", id, path),
	openContext: (id: string, scope: { workspaceId: string; sessionId?: string }): Promise<string> => ipcRenderer.invoke("pi:remote-context-open", id, scope),
	closeContext: (id: string, contextId: string): Promise<void> => ipcRenderer.invoke("pi:remote-context-close", id, contextId),
	bootstrap: (id: string, contextId?: string): Promise<unknown> => ipcRenderer.invoke("pi:remote-bootstrap", id, contextId),
	query: (id: string, request: unknown, contextId?: string): Promise<unknown> => ipcRenderer.invoke("pi:remote-query", id, request, contextId),
	command: (id: string, request: unknown, contextId?: string): Promise<unknown> => ipcRenderer.invoke("pi:remote-command", id, request, contextId),
	installRuntime: (id: string): Promise<{ readonly installed: boolean; readonly message?: string }> =>
		ipcRenderer.invoke("pi:remote-install-runtime", id),
	retryNetwork: (id: string): Promise<void> => ipcRenderer.invoke("pi:remote-retry-network", id),
	onChanged: (listener: () => void): RemoteUnsubscribe => {
		const handler = (): void => listener();
		ipcRenderer.on("pi:remote-changed", handler);
		return () => ipcRenderer.removeListener("pi:remote-changed", handler);
	},
	onEvent: (listener: (envelope: unknown) => void): RemoteUnsubscribe => {
		const handler = (_event: IpcRendererEvent, envelope: unknown): void => listener(envelope);
		ipcRenderer.on("pi:remote-event", handler);
		return () => ipcRenderer.removeListener("pi:remote-event", handler);
	},
};

type TerminalRecording = {
	readonly terminalId: string;
	readonly state: "idle" | "recording" | "saving" | "saved" | "failed";
	readonly elapsedMs: number;
	readonly bytes: number;
	readonly artifactId?: string;
	readonly notice?: string;
};

const terminalBridge = {
	create: (size?: TerminalCreateInput): Promise<unknown> =>
		ipcRenderer.invoke("pi:terminal-create", size),
	write: (id: string, data: string): Promise<void> => ipcRenderer.invoke("pi:terminal-write", id, data),
	resize: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke("pi:terminal-resize", id, cols, rows),
	dispose: (id: string): Promise<void> => ipcRenderer.invoke("pi:terminal-dispose", id),
	profiles: (targetId?: string): Promise<unknown> => ipcRenderer.invoke("pi:terminal-profiles", targetId),
	list: (targetId?: string): Promise<unknown> => ipcRenderer.invoke("pi:terminal-list", targetId),
	recordingStart: (input: { id: string; workspaceId?: string; sessionId?: string }): Promise<TerminalRecording> =>
		ipcRenderer.invoke("pi:terminal-recording-start", input),
	recordingStop: (id: string): Promise<TerminalRecording> => ipcRenderer.invoke("pi:terminal-recording-stop", id),
	recordingStatus: (id: string): Promise<TerminalRecording> => ipcRenderer.invoke("pi:terminal-recording-status", id),
	recordingExport: (artifactId: string): Promise<{ exported: boolean; path?: string }> =>
		ipcRenderer.invoke("pi:terminal-recording-export", artifactId),
	onData: (listener: (event: { id: string; data: string; bytes?: number }) => void): RemoteUnsubscribe => {
		const handler = (_event: IpcRendererEvent, payload: { id: string; data: string; bytes?: number }): void => listener(payload);
		ipcRenderer.on("pi:terminal-data", handler);
		return () => ipcRenderer.removeListener("pi:terminal-data", handler);
	},
	onExit: (listener: (event: { id: string }) => void): RemoteUnsubscribe => {
		const handler = (_event: IpcRendererEvent, payload: { id: string }): void => listener(payload);
		ipcRenderer.on("pi:terminal-exit", handler);
		return () => ipcRenderer.removeListener("pi:terminal-exit", handler);
	},
};

let cachedProfile: PerfProfileSnapshot | null = null;
try { cachedProfile = ipcRenderer.sendSync("zeta-studio:desktop:perf-profile-cached") ?? null; } catch { /* First launch has no persisted sample. */ }
const performanceBridge = Object.freeze({
	cached: cachedProfile,
	probe: (): Promise<PerfProfileSnapshot> => ipcRenderer.invoke("zeta-studio:desktop:perf-profile-probe").then((snapshot: PerfProfileSnapshot | null) => {
		if (!snapshot) throw new Error("Performance profile is unavailable");
		return snapshot;
	}),
	onChanged: (listener: (snapshot: PerfProfileSnapshot) => void): (() => void) => {
		const handler = (_event: IpcRendererEvent, snapshot: PerfProfileSnapshot | null): void => { if (snapshot) listener(snapshot); };
		ipcRenderer.on("zeta-studio:desktop:perf-profile-changed", handler);
		return () => ipcRenderer.removeListener("zeta-studio:desktop:perf-profile-changed", handler);
	},
});

contextBridge.exposeInMainWorld("zetaStudioChrome", bridge);
contextBridge.exposeInMainWorld("zetaStudioRemote", remoteBridge);
contextBridge.exposeInMainWorld("zetaStudioTerminal", terminalBridge);
contextBridge.exposeInMainWorld("zetaStudioPerf", performanceBridge);
