/**
 * Mount gate for the composer's draft-dictation control.
 *
 * Dictation is only honest when BOTH halves exist:
 * - the Host advertises every `dictation.*` command in its capability manifest
 *   (so the renderer never polls an operation the Host cannot answer), and
 * - this desktop shell exposes the complete microphone bridge
 *   (`attachLiveAudio`/`appendLiveAudio`/`detachLiveAudio`) and Chromium has
 *   `getUserMedia`.
 *
 * A browser tab, a remote target, or a Host without the family must render
 * nothing; there is no hidden microphone fallback. The W4 availability gate
 * (`available`) stays a separate input; this module only adds the capability
 * and bridge requirements on top of it.
 */

export interface LiveAudioBridgeSurface {
	attachLiveAudio?: unknown;
	appendLiveAudio?: unknown;
	detachLiveAudio?: unknown;
}

export interface MediaDevicesSurface {
	getUserMedia?: unknown;
}

/** True only when all three preload audio methods and device capture exist. */
export function desktopDictationBridge(
	chrome: LiveAudioBridgeSurface | null | undefined,
	mediaDevices: MediaDevicesSurface | null | undefined,
): boolean {
	return (
		typeof chrome?.attachLiveAudio === "function" &&
		typeof chrome.appendLiveAudio === "function" &&
		typeof chrome.detachLiveAudio === "function" &&
		typeof mediaDevices?.getUserMedia === "function"
	);
}

export interface DictationGateInput {
	/** Preview fixtures render the demo control without any bridge. */
	readonly preview: boolean;
	/** The Host capability manifest advertises all five `dictation.*` commands. */
	readonly capabilityAvailable: boolean;
	readonly bridgeComplete: boolean;
	/** W4 gate: runtime connected, local execution target, worktree unobstructed. */
	readonly available: boolean;
	readonly sessionId?: string | undefined;
	/** Remote SSH target: no local microphone capture may be implied. */
	readonly remoteTarget: boolean;
	/** The Host answered `unsupported` to an earlier poll (stale manifest). */
	readonly supported: boolean;
}

/** Whether the control may mount (and therefore poll `dictation.status`). */
export function dictationControlMounts(input: DictationGateInput): boolean {
	if (input.preview) return true;
	return (
		input.capabilityAvailable &&
		input.bridgeComplete &&
		input.available &&
		input.supported &&
		!input.remoteTarget &&
		input.sessionId !== undefined &&
		input.sessionId.trim() !== ""
	);
}
