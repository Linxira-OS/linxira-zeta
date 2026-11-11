/**
 * Desktop dictation audio transport registry.
 *
 * The Studio contract carries dictation *semantics* (`dictation.prepare/start/
 * stop/cancel`), not audio. The Renderer's AudioWorklet produces ordered 16 kHz
 * mono Float32 frames; Electron Main forwards them over a loopback-only HTTP
 * route so the Host can feed the existing `STTController` without a second
 * listener or a second authentication scheme.
 *
 * This module is deliberately dependency-free: `web-gateway.ts` imports it to
 * answer `/api/dictation/audio*`, while `studio-host/ops/dictation.ts` registers
 * one sink per prepared capture. No import cycle and no capability claim: the
 * route only exists for an audioId the Host actually prepared.
 */

/** The HTTP status an audio route should answer for a rejected frame. */
export type DictationAudioStatus = 400 | 404 | 409 | 410;

/** A frame or lifecycle request the active dictation capture rejected. */
export class DictationAudioReject extends Error {
	readonly status: DictationAudioStatus;

	constructor(status: DictationAudioStatus, message: string) {
		super(message);
		this.name = "DictationAudioReject";
		this.status = status;
	}
}

/** The live capture behind one prepared `audioId`. Implemented by the Host ops. */
export interface DictationAudioSink {
	/** Bind the desktop sender to this capture's session; throws on a mismatch. */
	attach(sessionId: string): void;
	/** Consume one ordered frame; throws when it is stale, duplicated or full. */
	append(sequence: number, bytes: Uint8Array): void;
	/** The sender went away without `dictation.stop`; discard the capture. */
	detach(): void;
}

const sinks = new Map<string, DictationAudioSink>();

/** Register a prepared capture; the returned closure unregisters it. */
export function registerDictationAudioSink(audioId: string, sink: DictationAudioSink): () => void {
	sinks.set(audioId, sink);
	return () => {
		if (sinks.get(audioId) === sink) sinks.delete(audioId);
	};
}

/** The sink for `audioId`, or undefined once the capture ended. */
export function dictationAudioSink(audioId: string): DictationAudioSink | undefined {
	return sinks.get(audioId);
}

/** Bind a desktop sender to a prepared capture, enforcing the session target. */
export function attachDictationAudio(audioId: string, sessionId: string): void {
	const sink = sinks.get(audioId);
	if (!sink) throw new DictationAudioReject(404, "Dictation input was not prepared");
	sink.attach(sessionId);
}

/** Deliver one ordered audio frame to the prepared capture. */
export function appendDictationAudio(audioId: string, sequence: number, bytes: Uint8Array): void {
	const sink = sinks.get(audioId);
	if (!sink) throw new DictationAudioReject(404, "Dictation input was not prepared");
	sink.append(sequence, bytes);
}

/** Detach a sender; an unknown audioId is already detached and is not an error. */
export function detachDictationAudio(audioId: string): void {
	sinks.get(audioId)?.detach();
}
