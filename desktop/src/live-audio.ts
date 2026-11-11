/**
 * Desktop → Host dictation audio relay (pure; no Electron imports).
 *
 * The Renderer's AudioWorklet produces ordered 16 kHz mono Float32 frames. The
 * preload bridge hands each frame to Main, and this relay forwards it over the
 * loopback gateway route that the Studio Host exposes for a prepared audioId.
 * Frames for one audioId are serialized so HTTP reordering cannot reach the
 * recognizer; sequence numbers are checked here and again in the Host.
 */

const AUDIO_ID_RE = /^[a-f0-9-]{36}$/u;
/** One Worklet frame: 320 samples × 4 bytes (20 ms at 16 kHz mono Float32). */
const FRAME_BYTES = 320 * 4;

export type LiveAudioResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface LiveAudioResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly message?: string;
}

/** One POST against the service gateway; `body` is raw bytes or JSON text. */
export type LiveAudioPost = (
	path: string,
	init: { readonly body?: Uint8Array | string; readonly contentType?: string },
) => Promise<LiveAudioResponse>;

interface Attachment {
	readonly sessionId: string;
	expectedSequence: number;
	closed: boolean;
	readonly tail: { current: Promise<void> };
}

export interface LiveAudioRelay {
	attach(input: unknown): Promise<LiveAudioResult>;
	append(input: unknown): Promise<LiveAudioResult>;
	detach(input: unknown): Promise<LiveAudioResult>;
}

function fail(message: string): LiveAudioResult {
	return { ok: false, message };
}

function fieldOf(value: unknown, field: string): unknown {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)[field]
		: undefined;
}

function audioIdOf(value: unknown): string | undefined {
	return typeof value === "string" && AUDIO_ID_RE.test(value) ? value : undefined;
}

function sessionIdOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" && value.length <= 512 ? value : undefined;
}

function sequenceOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function bytesOf(value: unknown): Uint8Array | undefined {
	if (value instanceof ArrayBuffer) {
		if (value.byteLength !== FRAME_BYTES) return undefined;
		return new Uint8Array(value.slice(0));
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		if (view.byteLength !== FRAME_BYTES) return undefined;
		return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
	}
	return undefined;
}

function responseMessage(response: LiveAudioResponse): string {
	if (response.message !== undefined && response.message !== "") return response.message;
	return `Dictation audio transport failed (HTTP ${response.status})`;
}

/** Serialize one audioId's HTTP posts; a failure closes that attachment. */
function enqueue(entry: Attachment, work: () => Promise<void>): Promise<void> {
	entry.tail.current = entry.tail.current.then(work, work);
	return entry.tail.current;
}

/** Build a relay over an injected POST seam (Main supplies the gateway URL). */
export function createLiveAudioRelay(post: LiveAudioPost): LiveAudioRelay {
	const attachments = new Map<string, Attachment>();

	return {
		async attach(input) {
			const audioId = audioIdOf(fieldOf(input, "audioId"));
			const sessionId = sessionIdOf(fieldOf(input, "sessionId"));
			if (audioId === undefined || sessionId === undefined) return fail("Invalid audio attach request");
			const existing = attachments.get(audioId);
			if (existing !== undefined) {
				return existing.sessionId === sessionId && !existing.closed
					? { ok: true }
					: fail("Audio session does not match the existing attachment");
			}
			const response = await post("/api/dictation/audio/attach", {
				body: JSON.stringify({ audioId, sessionId }),
				contentType: "application/json",
			});
			if (!response.ok) return fail(responseMessage(response));
			attachments.set(audioId, {
				sessionId,
				expectedSequence: 0,
				closed: false,
				tail: { current: Promise.resolve() },
			});
			return { ok: true };
		},

		async append(input) {
			const audioId = audioIdOf(fieldOf(input, "audioId"));
			const sequence = sequenceOf(fieldOf(input, "sequence"));
			const bytes = bytesOf(fieldOf(input, "bytes"));
			if (audioId === undefined || sequence === undefined || bytes === undefined) {
				return fail("Invalid audio frame");
			}
			const entry = attachments.get(audioId);
			if (entry === undefined) return fail("Dictation audio is not attached");
			if (entry.closed) return fail("Dictation audio is closed");
			if (sequence !== entry.expectedSequence) return fail("Audio frames arrived out of order");
			entry.expectedSequence += 1;
			try {
				await enqueue(entry, async () => {
					if (entry.closed) throw new Error("Dictation audio is closed");
					const response = await post(
						`/api/dictation/audio?audioId=${encodeURIComponent(audioId)}&sequence=${sequence}`,
						{ body: bytes, contentType: "application/octet-stream" },
					);
					if (!response.ok) throw new Error(responseMessage(response));
				});
				return { ok: true };
			} catch (error) {
				entry.closed = true;
				return fail(error instanceof Error ? error.message : "Dictation audio transport failed");
			}
		},

		async detach(input) {
			const audioId = audioIdOf(fieldOf(input, "audioId"));
			if (audioId === undefined) return fail("Invalid audio detach request");
			const entry = attachments.get(audioId);
			if (entry === undefined) return { ok: true };
			entry.closed = true;
			attachments.delete(audioId);
			await entry.tail.current.catch(() => {});
			const response = await post("/api/dictation/audio/detach", {
				body: JSON.stringify({ audioId }),
				contentType: "application/json",
			});
			return response.ok ? { ok: true } : fail(responseMessage(response));
		},
	};
}
