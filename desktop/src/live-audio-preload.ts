/**
 * Renderer bridge methods for draft dictation. Spread into the existing preload
 * capability object; the channels are owned by `live-audio-main.ts`.
 */
import { ipcRenderer } from "electron";
import { LIVE_AUDIO_CHANNELS } from "./live-audio-channels";

/** Result shape the Studio renderer's `zetaStudioChrome` contract expects. */
export interface LiveAudioBridgeResult {
	readonly ok: boolean;
	readonly message?: string;
}

export const liveAudioBridge = {
	attachLiveAudio: (input: { readonly audioId: string; readonly sessionId: string }): Promise<LiveAudioBridgeResult> =>
		ipcRenderer.invoke(LIVE_AUDIO_CHANNELS.attach, input),
	appendLiveAudio: (input: {
		readonly audioId: string;
		readonly sequence: number;
		readonly bytes: ArrayBuffer;
	}): Promise<LiveAudioBridgeResult> => ipcRenderer.invoke(LIVE_AUDIO_CHANNELS.append, input),
	detachLiveAudio: (input: { readonly audioId: string }): Promise<LiveAudioBridgeResult> =>
		ipcRenderer.invoke(LIVE_AUDIO_CHANNELS.detach, input),
	requestMicrophoneAccess: (): Promise<"granted" | "denied"> =>
		ipcRenderer.invoke(LIVE_AUDIO_CHANNELS.requestMicrophoneAccess),
	openMicrophoneSettings: (): Promise<boolean> => ipcRenderer.invoke(LIVE_AUDIO_CHANNELS.openMicrophoneSettings),
};
