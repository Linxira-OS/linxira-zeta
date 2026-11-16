import type { WebContents } from "electron";

export type PrivateSender = Pick<WebContents, "id" | "mainFrame" | "isDestroyed" | "getURL" | "send" | "once" | "on" | "removeListener">;
export interface PrivateIpcMain {
	handle(channel: string, listener: (event: { sender: PrivateSender; senderFrame?: unknown }, value: unknown) => unknown): void;
	removeHandler(channel: string): void;
}
export interface StudioPrivatePaths {
	readonly schema: 1;
	readonly mediaDirectory: string;
	readonly socketDirectory: string;
}
export interface PrivateDesktopCapabilities {
	readonly managedBrowser: boolean;
	readonly browserObservation: boolean;
	readonly computerCapture: boolean;
	readonly computerFrames: boolean;
	readonly prediction: boolean;
}
export type TrustedPrivateSender = Pick<WebContents, "id" | "isDestroyed" | "getURL">;
