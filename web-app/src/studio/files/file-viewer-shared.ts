import type { WorkspaceFileInfo } from "@linxiraos/studio-contract";

export interface FileResourceTarget { targetId: string | null; workspaceId: string; path: string }
export interface FileResource { id: string; url: string; file: WorkspaceFileInfo }
export interface OfficeComponentState {
  id: "office-preview";
  status: "not-installed" | "ready" | "checking" | "downloading" | "installing" | "error";
  installedVersion?: string;
  availableVersion?: string;
  downloadBytes?: number;
  receivedBytes?: number;
  message?: string;
}
export interface FileViewerDesktopApi {
  open(input: FileResourceTarget): Promise<FileResource>;
  release(id: string): Promise<void>;
  export(input: FileResourceTarget): Promise<boolean>;
  officeState?(check?: boolean): Promise<OfficeComponentState>;
  officeInstall?(): Promise<OfficeComponentState>;
  officeCancel?(): Promise<void>;
  officeUninstall?(): Promise<OfficeComponentState>;
  officePreview?(id: string): Promise<{ url: string }>;
  onOfficeState?(listener: (state: OfficeComponentState) => void): () => void;
  setDirty(count: number): Promise<void>;
  onCloseRequested(listener: (id: string) => void): () => void;
  finishClose(id: string, allow: boolean): Promise<void>;
}
export const FILE_VIEWER_CHANNELS = {
  open: "zeta-studio:files-open", release: "zeta-studio:files-release", export: "zeta-studio:files-export",
  officeState: "zeta-studio:office-state", officeInstall: "zeta-studio:office-install", officeCancel: "zeta-studio:office-cancel",
  officeUninstall: "zeta-studio:office-uninstall", officePreview: "zeta-studio:office-preview", officeChanged: "zeta-studio:office-changed",
  dirty: "zeta-studio:files-dirty", closeRequested: "zeta-studio:files-close-requested", finishClose: "zeta-studio:files-finish-close",
} as const;
