/**
 * Electron Main installation for the dictation audio bridge.
 *
 * Kept out of `main.ts` so the shell owner has one call to place: this module
 * owns the IPC channels, the loopback POSTs, and the macOS microphone TCC
 * seams. The Renderer's preload object exposes the matching methods from
 * `live-audio-preload.ts`.
 */
import { ipcMain, shell, systemPreferences } from "electron";
import { LIVE_AUDIO_CHANNELS } from "./live-audio-channels";
import { createLiveAudioRelay, type LiveAudioPost, type LiveAudioResponse } from "./live-audio";

export { LIVE_AUDIO_CHANNELS };

const MICROPHONE_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

async function gatewayResponse(response: Response): Promise<LiveAudioResponse> {
	if (response.ok) return { ok: true, status: response.status };
	const text = await response.text().catch(() => "");
	try {
		const parsed = JSON.parse(text) as { error?: unknown };
		return {
			ok: false,
			status: response.status,
			...(typeof parsed.error === "string" ? { message: parsed.error } : {}),
		};
	} catch {
		return { ok: false, status: response.status, ...(text === "" ? {} : { message: text }) };
	}
}

function postToGateway(getServiceUrl: () => string): LiveAudioPost {
	return async (path, init) => {
		try {
			const response = await fetch(`${getServiceUrl()}${path}`, {
				method: "POST",
				headers: {
					...(init.contentType === undefined ? {} : { "content-type": init.contentType }),
				},
				...(init.body === undefined
					? {}
					: { body: typeof init.body === "string" ? init.body : new Blob([new Uint8Array(init.body)]) }),
				signal: AbortSignal.timeout(15_000),
			});
			return await gatewayResponse(response);
		} catch (error) {
			return {
				ok: false,
				status: 0,
				message: error instanceof Error ? error.message : "Dictation audio transport failed",
			};
		}
	};
}

/**
 * Install the preload bridge's IPC handlers. Call once from Main after the
 * service origin is known; `getServiceUrl` is evaluated per request so a
 * restarted or adopted service keeps working.
 */
export function installLiveAudioIpc(getServiceUrl: () => string): void {
	const relay = createLiveAudioRelay(postToGateway(getServiceUrl));

	ipcMain.handle(LIVE_AUDIO_CHANNELS.attach, async (_event, input: unknown) => relay.attach(input));
	ipcMain.handle(LIVE_AUDIO_CHANNELS.append, async (_event, input: unknown) => relay.append(input));
	ipcMain.handle(LIVE_AUDIO_CHANNELS.detach, async (_event, input: unknown) => relay.detach(input));

	// macOS TCC: the renderer calls this before asking Chromium for a stream so
	// a denied app shows the System Settings affordance instead of a silent
	// empty capture. Windows/Linux leave consent to Chromium.
	ipcMain.handle(LIVE_AUDIO_CHANNELS.requestMicrophoneAccess, async () => {
		if (process.platform !== "darwin") return "granted";
		return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied";
	});
	ipcMain.handle(LIVE_AUDIO_CHANNELS.openMicrophoneSettings, async () => {
		if (process.platform !== "darwin") return false;
		await shell.openExternal(MICROPHONE_SETTINGS_URL);
		return true;
	});
}
