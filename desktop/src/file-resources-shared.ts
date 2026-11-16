/** Host file shapes mirror the upstream semantic contract; this package is standalone. */
export interface WorkspaceFileInfo {
	readonly workspaceId: string;
	readonly path: string;
	readonly id: string;
	readonly name: string;
	readonly mime: string;
	readonly size: number;
	readonly version: string;
	readonly writable: boolean;
}
export interface FileResourceTarget { targetId: string | null; workspaceId: string; path: string }
export interface FileResource { id: string; url: string; file: WorkspaceFileInfo }
export const FILE_RESOURCE_CHANNELS = {
	open: "zeta-studio:files-open",
	release: "zeta-studio:files-release",
	export: "zeta-studio:files-export",
	dirty: "zeta-studio:files-dirty",
	closeRequested: "zeta-studio:files-close-requested",
	finishClose: "zeta-studio:files-finish-close",
} as const;
