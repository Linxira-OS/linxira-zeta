/** IPC channel names shared by the Main installer and the preload bridge. */
export const LIVE_AUDIO_CHANNELS = {
	attach: "pi:live-audio-attach",
	append: "pi:live-audio-append",
	detach: "pi:live-audio-detach",
	requestMicrophoneAccess: "pi:request-microphone-access",
	openMicrophoneSettings: "pi:open-microphone-settings",
} as const;
