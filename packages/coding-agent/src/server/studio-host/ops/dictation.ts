/**
 * `dictation.*` — draft-only speech-to-text for the Studio composer.
 *
 * The semantic names already exist in `protocol/contracts/dictation.ts`; this
 * family is the missing Host side. It reuses the TUI's `STTController` (model
 * role resolution, `stt.enabled`/`stt.language`, model cache/download and the
 * ASR subprocess), but swaps the microphone boundary for ordered frames that
 * Electron Main forwards from the Renderer's AudioWorklet.
 *
 * Invariants:
 * - one prepared capture per session, one audioId per capture;
 * - frames require an explicit desktop attach and strictly increasing sequence;
 * - stopping flushes queued frames before the controller transcribes;
 * - cancel/dispose never emit text, even if a transcription was in flight;
 * - status is cheap and never starts the ASR worker or downloads a model.
 */
import { randomUUID } from "node:crypto";
import type { ModelRegistry } from "../../../config/model-registry.js";
import { resolveRoleChain } from "../../../config/model-resolver.js";
import { roleCandidatePool } from "../../../config/model-roles.js";
import type { Settings } from "../../../config/settings.js";
import { STTController, type SttCallbacks, type SttTarget, type SttState } from "../../../stt/index.js";
import { isSttModelCached } from "../../../stt/downloader.js";
import { resolveSttModelSpec } from "../../../stt/models.js";
import { cfgSttEnabled, cfgSttLanguage } from "../../../stt/settings.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import type { CommandInput } from "../contract/index.js";
import type { DictationState } from "../protocol/index.js";
import type { StudioFamily } from "../registry.js";
import { invalid } from "../errors.js";
import { DictationAudioReject, registerDictationAudioSink, type DictationAudioSink } from "../dictation-audio.js";

/** The slice of a live session dictation needs; injectable for tests. */
export interface HostDictationSession {
	readonly id: string;
	readonly settings: Settings;
	readonly registry: ModelRegistry;
}

/** Presentation facts resolved from the configured `dictation` model role. */
export interface ModelFacts {
	readonly model: string;
	readonly cloud: boolean;
	readonly downloadRequired: boolean;
	readonly downloadSize?: string;
	readonly unsupportedApi?: string;
}

/** Controller surface used here; tests substitute a fake microphone boundary. */
export type HostDictationController = Pick<STTController, "state" | "start" | "stop" | "dispose">;

export interface HostDictationHooks {
	readonly target: SttTarget;
	readonly callbacks: SttCallbacks;
	/** The controller's capture boundary hands over its sample sink here. */
	setSink(sink: ((samples: Float32Array) => void) | null): void;
}

export type HostDictationControllerFactory = (
	session: HostDictationSession,
	hooks: HostDictationHooks,
) => HostDictationController;

/** Injection seams: production uses the live gateway session and STTController. */
export interface DictationHostDeps {
	getSession(sessionId: string): HostDictationSession | undefined;
	describeModel?(session: HostDictationSession): Promise<ModelFacts>;
	createController?: HostDictationControllerFactory;
	/** `stt.enabled` / `stt.language`; tests substitute a fixed pair. */
	flags?(session: HostDictationSession): { readonly enabled: boolean; readonly language: string };
}

const MAX_FRAME_BYTES = 65_536;
/** The Worklet's fixed cadence: 320 samples = 20 ms at 16 kHz. */
const FRAME_SAMPLES = 320;
const MAX_QUEUED_FRAMES = 250;
const LAST_FRAME_QUIET_MS = 60;
const STOP_DRAIN_CEILING_MS = 500;
const DESCRIPTION_TTL_MS = 5_000;

interface Capture {
	readonly audioId: string;
	readonly session: HostDictationSession;
	readonly description: ModelFacts;
	phase: DictationState["phase"];
	text: string;
	error: string | undefined;
	readonly committed: { value: string };
	readonly volatile: { value: string };
	controller: HostDictationController | undefined;
	target: SttTarget | undefined;
	callbacks: SttCallbacks | undefined;
	sink: ((samples: Float32Array) => void) | undefined;
	queued: Float32Array[];
	nextSequence: number;
	lastFrameAt: number;
	attached: boolean;
	stopping: boolean;
	cancelled: boolean;
	generation: number;
	startPromise: Promise<void> | undefined;
	stopPromise: Promise<DictationState> | undefined;
	unregister: () => void;
}

function sessionIdOf(input: { readonly sessionId?: unknown }): string {
	const sessionId = input.sessionId;
	if (typeof sessionId !== "string" || sessionId.trim() === "" || sessionId.length > 512) {
		throw invalid("sessionId must be a non-blank string");
	}
	return sessionId;
}

function audioIdOf(input: { readonly audioId?: unknown }): string {
	const audioId = input.audioId;
	if (typeof audioId !== "string" || !/^[a-f0-9-]{36}$/u.test(audioId)) throw invalid("Invalid audioId");
	return audioId;
}

/** Decode one little-endian Float32 frame; the Renderer's worklet is 16 kHz mono. */
function decodeFrame(bytes: Uint8Array): Float32Array {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength % 4 !== 0) {
		throw new DictationAudioReject(400, "Invalid audio frame");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const samples = new Float32Array(bytes.byteLength / 4);
	if (samples.length !== FRAME_SAMPLES) {
		throw new DictationAudioReject(400, "Audio frame must be 20 ms at 16 kHz");
	}
	for (let index = 0; index < samples.length; index += 1) {
		const value = view.getFloat32(index * 4, true);
		samples[index] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
	}
	return samples;
}

function defaultSession(sessionId: string): HostDictationSession | undefined {
	const wrapper = getRpcSession(sessionId);
	if (wrapper === undefined || !wrapper.isAlive()) return undefined;
	const live = wrapper.getSession();
	if (!live) return undefined;
	return { id: live.sessionId, settings: live.settings, registry: live.modelRegistry };
}

async function defaultDescribeModel(session: HostDictationSession): Promise<ModelFacts> {
	const pool = roleCandidatePool("dictation", session.settings, session.registry);
	const model = resolveRoleChain("dictation", session.settings, pool)[0]?.model;
	if (model?.api === "openai-transcriptions") {
		return { model: `${model.provider}/${model.id}`, cloud: true, downloadRequired: false };
	}
	if (model && model.api !== "local-inference") {
		return {
			model: `${model.provider}/${model.id}`,
			cloud: false,
			downloadRequired: false,
			unsupportedApi: model.api,
		};
	}
	const spec = resolveSttModelSpec(model?.id);
	const cached = await isSttModelCached(spec.key);
	return {
		model: `local/${spec.key}`,
		cloud: false,
		downloadRequired: !cached,
		...(cached ? {} : { downloadSize: spec.sizeHint }),
	};
}

function defaultController(session: HostDictationSession, hooks: HostDictationHooks): HostDictationController {
	return new STTController(
		// The controller's capture boundary reports `(error, samples)`; Host frames
		// are already validated 16 kHz mono samples, so the error arm is unused.
		onAudio => {
			hooks.setSink(samples => onAudio(null, samples));
			return {
				stop: () => {
					hooks.setSink(null);
				},
			};
		},
		{
			settings: session.settings,
			registry: session.registry,
			getSessionId: () => session.id,
		},
	);
}

/** One Host-side dictation bridge. Production exports a singleton below. */
export class DictationHost {
	readonly #deps: Required<Pick<DictationHostDeps, "getSession" | "createController" | "flags">> & {
		readonly describeModel: (session: HostDictationSession) => Promise<ModelFacts>;
	};
	readonly #bySession = new Map<string, Capture>();
	readonly #byAudioId = new Map<string, Capture>();
	readonly #lastBySession = new Map<string, DictationState>();
	readonly #descriptions = new Map<string, { at: number; facts: ModelFacts }>();

	constructor(deps: DictationHostDeps = { getSession: defaultSession }) {
		this.#deps = {
			getSession: deps.getSession,
			describeModel: deps.describeModel ?? defaultDescribeModel,
			createController: deps.createController ?? defaultController,
			flags:
				deps.flags ??
				(session => ({
					enabled: cfgSttEnabled.get(session.settings),
					language: cfgSttLanguage.get(session.settings),
				})),
		};
	}

	async status(sessionId: string): Promise<DictationState> {
		const session = this.#session(sessionId);
		const capture = this.#bySession.get(sessionId);
		if (capture) return this.#state(capture);
		const last = this.#lastBySession.get(sessionId);
		if (last) return last;
		return this.#baseState(session, await this.#describe(session));
	}

	async prepare(sessionId: string): Promise<DictationState> {
		const session = this.#session(sessionId);
		const existing = this.#bySession.get(sessionId);
		if (existing) {
			if (!existing.stopping && !existing.cancelled) this.#cancel(existing);
		}
		const description = await this.#describe(session, true);
		const base = this.#baseState(session, description);
		if (!base.enabled) return { ...base, phase: "off", text: "" };
		if (description.unsupportedApi !== undefined) {
			return {
				...base,
				phase: "error",
				text: "",
				error: `Unsupported speech-to-text API: ${description.unsupportedApi}`,
			};
		}
		const audioId = randomUUID();
		const capture: Capture = {
			audioId,
			session,
			description,
			phase: "prepared",
			text: "",
			error: undefined,
			controller: undefined,
			target: undefined,
			callbacks: undefined,
			sink: undefined,
			startPromise: undefined,
			stopPromise: undefined,
			committed: { value: "" },
			volatile: { value: "" },
			queued: [],
			nextSequence: 0,
			lastFrameAt: 0,
			attached: false,
			stopping: false,
			cancelled: false,
			generation: 0,
			unregister: () => {},
		};
		const sink: DictationAudioSink = {
			attach: targetSession => this.#attach(capture, targetSession),
			append: (sequence, bytes) => this.#append(capture, sequence, bytes),
			detach: () => this.#detach(capture),
		};
		capture.unregister = registerDictationAudioSink(audioId, sink);
		this.#bySession.set(sessionId, capture);
		this.#byAudioId.set(audioId, capture);
		this.#lastBySession.delete(sessionId);
		return this.#state(capture);
	}

	async start(sessionId: string, audioId: string): Promise<DictationState> {
		const capture = this.#capture(this.#session(sessionId), audioId);
		const base = this.#baseState(capture.session, capture.description);
		if (!base.enabled) throw invalid("Speech-to-text is disabled");
		if (capture.phase === "recording" || capture.phase === "starting") return this.#state(capture);
		if (capture.phase !== "prepared" && capture.phase !== "error") {
			throw invalid("Dictation input is no longer prepared");
		}
		capture.error = undefined;
		capture.phase = "starting";
		capture.cancelled = false;
		capture.stopping = false;
		const generation = ++capture.generation;
		const committed = capture.committed;
		const volatile = capture.volatile;
		const target: SttTarget = {
			setVolatileText: text => {
				if (capture.cancelled || capture.generation !== generation) return;
				volatile.value = text;
				capture.text = committed.value + volatile.value;
			},
			clearVolatileText: () => {
				if (capture.cancelled || capture.generation !== generation) return;
				volatile.value = "";
				capture.text = committed.value;
			},
			commitVolatileText: text => {
				if (capture.cancelled || capture.generation !== generation) return;
				committed.value += text;
				volatile.value = "";
				capture.text = committed.value;
			},
			submit: () => {
				// Draft-only: the composer owns submission.
			},
			deleteBeforeCursor: () => {
				// Draft-only: never edits the owner's draft.
			},
		};
		const callbacks: SttCallbacks = {
			manualSubmit: true,
			showWarning: message => {
				if (!capture.cancelled) capture.error = message;
			},
			showStatus: () => {},
			requestRender: () => {},
			onStateChange: state => this.#onControllerState(capture, generation, state),
		};
		capture.target = target;
		capture.callbacks = callbacks;
		const controller = this.#deps.createController(capture.session, {
			target,
			callbacks,
			setSink: sink => {
				capture.sink = sink ?? undefined;
			},
		});
		capture.controller = controller;
		capture.startPromise = controller
			.start(target, callbacks)
			.then(() => {
				if (capture.cancelled || capture.generation !== generation) return;
				if (controller.state === "recording") {
					if (capture.phase === "starting") capture.phase = "recording";
					this.#flush(capture);
				} else if (capture.phase === "starting") {
					capture.phase = "error";
					capture.error ??= "Failed to start dictation";
				}
			})
			.catch((cause: unknown) => {
				if (capture.cancelled || capture.generation !== generation) return;
				capture.phase = "error";
				capture.error ??= cause instanceof Error ? cause.message : "Failed to start dictation";
			});
		return this.#state(capture);
	}

	async stop(sessionId: string, audioId: string): Promise<DictationState> {
		const capture = this.#capture(this.#session(sessionId), audioId);
		if (capture.stopPromise) return capture.stopPromise;
		// A capture that never started has nothing to flush or transcribe; report
		// the protocol error instead of returning a fake "complete" with no text.
		if (capture.phase !== "starting" && capture.phase !== "recording") {
			throw invalid("Dictation input is not recording");
		}
		capture.stopping = true;
		capture.phase = "transcribing";
		const generation = capture.generation;
		capture.stopPromise = (async () => {
			await this.#drainBeforeStop(capture);
			try {
				await capture.controller?.stop();
				await capture.startPromise;
			} catch (cause) {
				if (!capture.cancelled) {
					capture.error ??= cause instanceof Error ? cause.message : "Dictation stop failed";
				}
			}
			if (capture.cancelled || capture.generation !== generation) {
				return this.#baseState(capture.session, capture.description);
			}
			capture.text = capture.committed.value;
			if (capture.error !== undefined) {
				capture.phase = "error";
			} else {
				capture.phase = "complete";
			}
			const final = this.#state(capture);
			this.#lastBySession.set(capture.session.id, final);
			this.#finalize(capture);
			return final;
		})();
		return capture.stopPromise;
	}

	async cancel(sessionId: string, audioId: string): Promise<DictationState> {
		const capture = this.#capture(this.#session(sessionId), audioId);
		this.#cancel(capture);
		return this.#baseState(capture.session, capture.description);
	}

	#session(sessionId: string): HostDictationSession {
		const session = this.#deps.getSession(sessionId);
		if (!session) throw invalid("Unknown or inactive session");
		return session;
	}

	#capture(session: HostDictationSession, audioId: string): Capture {
		const capture = this.#byAudioId.get(audioId);
		if (!capture || capture.session.id !== session.id) throw invalid("Unknown dictation input");
		return capture;
	}

	async #describe(session: HostDictationSession, refresh = false): Promise<ModelFacts> {
		const cached = this.#descriptions.get(session.id);
		if (!refresh && cached && Date.now() - cached.at < DESCRIPTION_TTL_MS) return cached.facts;
		const facts = await this.#deps.describeModel(session);
		this.#descriptions.set(session.id, { at: Date.now(), facts });
		return facts;
	}

	#baseState(session: HostDictationSession, facts: ModelFacts): DictationState {
		const flags = this.#deps.flags(session);
		return {
			available: true,
			enabled: flags.enabled,
			phase: "off",
			text: "",
			model: facts.model,
			language: flags.language,
			cloud: facts.cloud,
			downloadRequired: facts.downloadRequired,
			...(facts.downloadSize === undefined ? {} : { downloadSize: facts.downloadSize }),
		};
	}

	#state(capture: Capture): DictationState {
		return {
			...this.#baseState(capture.session, capture.description),
			audioId: capture.audioId,
			phase: capture.phase,
			text: capture.text,
			...(capture.error === undefined ? {} : { error: capture.error }),
		};
	}

	#attach(capture: Capture, sessionId: string): void {
		if (capture.session.id !== sessionId) {
			throw new DictationAudioReject(409, "Audio target does not match the prepared session");
		}
		if (capture.phase === "complete" || capture.phase === "error" || capture.cancelled) {
			throw new DictationAudioReject(410, "Dictation input is closed");
		}
		capture.attached = true;
	}

	#append(capture: Capture, sequence: number, bytes: Uint8Array): void {
		if (!capture.attached) throw new DictationAudioReject(409, "Audio input is not attached");
		if (capture.cancelled || capture.phase === "complete" || capture.phase === "error") {
			throw new DictationAudioReject(410, "Dictation input is closed");
		}
		if (sequence !== capture.nextSequence) {
			throw new DictationAudioReject(409, "Audio frames must arrive in order");
		}
		const samples = decodeFrame(bytes);
		capture.nextSequence += 1;
		capture.lastFrameAt = Date.now();
		if (capture.stopping) return;
		if (capture.phase === "recording" && capture.sink) capture.sink(samples);
		else if (capture.queued.length >= MAX_QUEUED_FRAMES) {
			throw new DictationAudioReject(409, "Audio buffer overflow");
		} else {
			capture.queued.push(samples);
		}
	}

	#detach(capture: Capture): void {
		if (!capture.stopping && !capture.cancelled && capture.phase !== "complete") this.#cancel(capture);
	}

	#onControllerState(capture: Capture, generation: number, state: SttState): void {
		if (capture.cancelled || capture.generation !== generation) return;
		if (state === "recording") {
			// A substitution warning during preflight is not a failure once the
			// capture is actually recording; keep the error slot for stop/faults.
			capture.error = undefined;
			capture.phase = "recording";
			this.#flush(capture);
			return;
		}
		if (state === "transcribing") {
			capture.phase = "transcribing";
			return;
		}
		// `idle` before stop is a start failure (the controller reports the reason
		// through showWarning first); stop owns the terminal state.
		if (!capture.stopping && capture.phase === "starting") {
			capture.phase = "error";
			capture.error ??= "Failed to start dictation";
		}
	}

	#flush(capture: Capture): void {
		if (!capture.sink || capture.phase !== "recording") return;
		const queued = capture.queued;
		capture.queued = [];
		for (const samples of queued) capture.sink(samples);
	}

	async #drainBeforeStop(capture: Capture): Promise<void> {
		const started = Date.now();
		while (
			Date.now() - started < STOP_DRAIN_CEILING_MS &&
			capture.lastFrameAt > 0 &&
			Date.now() - capture.lastFrameAt < LAST_FRAME_QUIET_MS
		) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 10);
			await promise;
		}
		this.#flush(capture);
	}

	#cancel(capture: Capture): void {
		if (capture.cancelled) return;
		capture.cancelled = true;
		capture.stopping = true;
		capture.generation += 1;
		capture.queued = [];
		try {
			capture.controller?.dispose();
		} catch {
			// controller disposal is best effort
		}
		this.#lastBySession.delete(capture.session.id);
		this.#finalize(capture);
	}

	#finalize(capture: Capture): void {
		capture.unregister();
		capture.sink = undefined;
		if (this.#bySession.get(capture.session.id) === capture) this.#bySession.delete(capture.session.id);
		if (this.#byAudioId.get(capture.audioId) === capture) this.#byAudioId.delete(capture.audioId);
	}
}

/** Process-wide bridge: the StudioHost ops delegate here. */
export const dictationHost = new DictationHost();

const requireSession = (input: CommandInput<"dictation.status">): string => sessionIdOf(input);

/** Runtime family for the Studio composer's draft dictation. */
export const dictationOps: StudioFamily = {
	id: "dictation",
	commands: {
		"dictation.status": async input => dictationHost.status(requireSession(input)),
		"dictation.prepare": async input => dictationHost.prepare(requireSession(input)),
		"dictation.start": async input => dictationHost.start(sessionIdOf(input), audioIdOf(input)),
		"dictation.stop": async input => dictationHost.stop(sessionIdOf(input), audioIdOf(input)),
		"dictation.cancel": async input => dictationHost.cancel(sessionIdOf(input), audioIdOf(input)),
	},
};
