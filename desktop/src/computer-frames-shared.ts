export const COMPUTER_FRAME_CHANNELS = {
	adopt: "zeta-studio:desktop:computer-view-adopt",
	release: "zeta-studio:desktop:computer-view-release",
	read: "zeta-studio:desktop:computer-frame-read",
} as const;
export interface ComputerViewRequest { scopeSessionId: string; leaseId: string; origin: "local" }
export interface ComputerFrameRequest { scopeSessionId: string; leaseId: string; frameId: string; origin: "local" }
export type ComputerViewResult = { ok: true } | { ok: false; message: string };
export type ComputerFrameReadResult = { ok: true; data: ArrayBuffer; width: number; height: number; mimeType: "image/png" } | { ok: false; message: string };
