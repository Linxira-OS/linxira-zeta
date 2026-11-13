/**
 * Host-side dictation boundaries: frames are ordered and scoped, stop flushes,
 * cancel never emits text, and an unsupported/denied start is an explicit error
 * state rather than a fake success. No ASR model or microphone is involved.
 */
import { describe, expect, test } from "bun:test";
import type { ModelRegistry } from "../src/config/model-registry.js";
import { settings } from "@linxiraos/zeta/config/settings";
import type { SttCallbacks, SttState, SttTarget } from "../src/stt/index.js";
import {
	appendDictationAudio,
	attachDictationAudio,
	detachDictationAudio,
} from "../src/server/studio-host/dictation-audio.js";
import {
	DictationHost,
	dictationOps,
	type HostDictationController,
	type HostDictationHooks,
	type HostDictationSession,
} from "../src/server/studio-host/ops/dictation.js";
import { StudioOperations } from "../src/server/studio-host/registry.js";
import { handleDictationAudio } from "../src/server/web-gateway/dictation-audio.js";

// The injected describeModel/createController own model access; this fixture
// only satisfies the session shape.
const registry = {} as unknown as ModelRegistry;
const SESSION: HostDictationSession = { id: "session-1", settings, registry };

function frame(value: number): Uint8Array {
	const bytes = new Uint8Array(320 * 4);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < 320; index += 1) view.setFloat32(index * 4, value, true);
	return bytes;
}

class FakeController implements HostDictationController {
	state: SttState = "idle";
	readonly received: Float32Array[] = [];
	disposed = false;
	#target: SttTarget | undefined;
	#callbacks: SttCallbacks | undefined;
	readonly #hooks: HostDictationHooks;

	constructor(hooks: HostDictationHooks) {
		this.#hooks = hooks;
	}

	async start(target: SttTarget, callbacks: SttCallbacks): Promise<void> {
		this.#target = target;
		this.#callbacks = callbacks;
		this.#hooks.setSink(samples => this.received.push(samples));
		this.state = "recording";
		callbacks.onStateChange("recording");
	}

	async stop(): Promise<void> {
		this.state = "transcribing";
		this.#callbacks?.onStateChange("transcribing");
		this.#target?.commitVolatileText("hello world");
		this.state = "idle";
		this.#callbacks?.onStateChange("idle");
	}

	dispose(): void {
		this.disposed = true;
		this.state = "idle";
	}
}

class DeniedController implements HostDictationController {
	state: SttState = "idle";

	async start(): Promise<void> {
		this.state = "idle";
		throw new Error("Microphone access is denied");
	}

	async stop(): Promise<void> {}

	dispose(): void {}
}

/** Starts recording, then reports a transcription failure the Host must surface. */
class FaultingStopController implements HostDictationController {
	state: SttState = "idle";
	#callbacks: SttCallbacks | undefined;
	#hooks: HostDictationHooks | undefined;

	constructor(hooks: HostDictationHooks) {
		this.#hooks = hooks;
	}

	async start(_target: SttTarget, callbacks: SttCallbacks): Promise<void> {
		this.#callbacks = callbacks;
		this.#hooks?.setSink(() => {});
		this.state = "recording";
		callbacks.onStateChange("recording");
	}

	async stop(): Promise<void> {
		this.state = "transcribing";
		this.#callbacks?.onStateChange("transcribing");
		this.#callbacks?.showWarning("Speech model runtime is unavailable");
		this.state = "idle";
		this.#callbacks?.onStateChange("idle");
	}

	dispose(): void {
		this.state = "idle";
	}
}

function host(options: { denied?: boolean; faultStop?: boolean } = {}) {
	let controller: FakeController | DeniedController | FaultingStopController | undefined;
	const instance = new DictationHost({
		getSession: sessionId => (sessionId === SESSION.id ? SESSION : undefined),
		flags: () => ({ enabled: true, language: "en" }),
		describeModel: async () => ({ model: "local/test", cloud: false, downloadRequired: false }),
		createController: (_session, hooks) => {
			controller = options.denied
				? new DeniedController()
				: options.faultStop
					? new FaultingStopController(hooks)
					: new FakeController(hooks);
			return controller;
		},
	});
	return { instance, controller: () => controller };
}

describe("Studio host dictation", () => {
	test("advertises exactly the declared dictation commands", () => {
		expect(Object.keys(dictationOps.commands ?? {})).toEqual([
			"dictation.status",
			"dictation.prepare",
			"dictation.start",
			"dictation.stop",
			"dictation.cancel",
		]);
	});

	test("the capability manifest advertises dictation only when the family is registered", () => {
		const registered = new StudioOperations([dictationOps]);
		expect(registered.commands).toContain("dictation.status");
		expect(registered.commands).toContain("dictation.prepare");
		expect(registered.commands).toContain("dictation.start");
		expect(registered.commands).toContain("dictation.stop");
		expect(registered.commands).toContain("dictation.cancel");
		const unregistered = new StudioOperations([]);
		expect(unregistered.commands).not.toContain("dictation.status");
	});

	test("stop before start is a protocol error, not an empty completion", async () => {
		const { instance } = host();
		const prepared = await instance.prepare(SESSION.id);
		await expect(instance.stop(SESSION.id, prepared.audioId!)).rejects.toThrow("not recording");
	});

	test("rejects unknown sessions and disabled dictation", async () => {
		const { instance } = host();
		await expect(instance.status("missing")).rejects.toThrow("Unknown or inactive session");
		const disabled = new DictationHost({
			getSession: () => SESSION,
			flags: () => ({ enabled: false, language: "en" }),
			describeModel: async () => ({ model: "local/test", cloud: false, downloadRequired: false }),
			createController: () => new DeniedController(),
		});
		const state = await disabled.prepare(SESSION.id);
		expect(state.enabled).toBe(false);
		expect(state.phase).toBe("off");
	});

	test("scopes attachment to the prepared session and orders frames", async () => {
		const { instance } = host();
		const prepared = await instance.prepare(SESSION.id);
		expect(prepared.audioId).toBeDefined();
		const audioId = prepared.audioId!;

		expect(() => appendDictationAudio(audioId, 0, frame(0.1))).toThrow("not attached");
		expect(() => attachDictationAudio(audioId, "other-session")).toThrow("prepared session");
		attachDictationAudio(audioId, SESSION.id);
		expect(() => appendDictationAudio(audioId, 1, frame(0.1))).toThrow("in order");
		expect(() => appendDictationAudio(audioId, 0, new Uint8Array(3))).toThrow("Invalid audio frame");
		expect(() => appendDictationAudio(audioId, 0, new Uint8Array(0))).toThrow("Invalid audio frame");
	});

	test("queues pre-start audio and flushes it before stop transcribes", async () => {
		const { instance, controller } = host();
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		attachDictationAudio(audioId, SESSION.id);
		appendDictationAudio(audioId, 0, frame(0.25));

		await instance.start(SESSION.id, audioId);
		await Promise.resolve();
		expect(controller()).toBeInstanceOf(FakeController);
		expect((controller() as FakeController).received).toHaveLength(1);

		appendDictationAudio(audioId, 1, frame(0.5));
		const final = await instance.stop(SESSION.id, audioId);
		expect(final.phase).toBe("complete");
		expect(final.text).toBe("hello world");
		expect((controller() as FakeController).received).toHaveLength(2);
	});

	test("cancel emits no text and closes the audio sink", async () => {
		const { instance, controller } = host();
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		attachDictationAudio(audioId, SESSION.id);
		await instance.start(SESSION.id, audioId);
		appendDictationAudio(audioId, 0, frame(0.1));

		const cancelled = await instance.cancel(SESSION.id, audioId);
		expect(cancelled.phase).toBe("off");
		expect(cancelled.text).toBe("");
		expect((controller() as FakeController).disposed).toBe(true);
		expect(() => appendDictationAudio(audioId, 1, frame(0.2))).toThrow("not prepared");
		expect((await instance.status(SESSION.id)).text).toBe("");
	});

	test("a denied start becomes an explicit error without output", async () => {
		const { instance } = host({ denied: true });
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		attachDictationAudio(audioId, SESSION.id);
		await instance.start(SESSION.id, audioId);
		await Promise.resolve();
		const state = await instance.status(SESSION.id);
		expect(state.phase).toBe("error");
		expect(state.error).toContain("denied");
		expect(state.text).toBe("");
	});

	test("a transcription failure at stop surfaces as an error, not empty text", async () => {
		const { instance } = host({ faultStop: true });
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		attachDictationAudio(audioId, SESSION.id);
		await instance.start(SESSION.id, audioId);
		const final = await instance.stop(SESSION.id, audioId);
		expect(final.phase).toBe("error");
		expect(final.error).toContain("runtime is unavailable");
		expect(final.text).toBe("");
	});

	test("detach discards an abandoned capture", async () => {
		const { instance } = host();
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		attachDictationAudio(audioId, SESSION.id);
		detachDictationAudio(audioId);
		await Promise.resolve();
		expect((await instance.status(SESSION.id)).phase).toBe("off");
	});

	test("the loopback HTTP route enforces attach, order, size and detach", async () => {
		const { instance } = host();
		const prepared = await instance.prepare(SESSION.id);
		const audioId = prepared.audioId!;
		const post = (path: string, body: string | Uint8Array, contentType: string) =>
			handleDictationAudio(
				new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": contentType }, body }),
			);
		expect(
			(
				await post(
					"/api/dictation/audio/attach",
					JSON.stringify({ audioId, sessionId: "other-session" }),
					"application/json",
				)
			).status,
		).toBe(409);
		expect(
			(
				await post(
					"/api/dictation/audio/attach",
					JSON.stringify({ audioId, sessionId: SESSION.id }),
					"application/json",
				)
			).status,
		).toBe(200);
		expect(
			(await post(`/api/dictation/audio?audioId=${audioId}&sequence=1`, frame(0.1), "application/octet-stream"))
				.status,
		).toBe(409);
		expect(
			(
				await post(
					`/api/dictation/audio?audioId=${audioId}&sequence=0`,
					new Uint8Array(3),
					"application/octet-stream",
				)
			).status,
		).toBe(400);
		expect(
			(await post(`/api/dictation/audio?audioId=${audioId}&sequence=0`, frame(0.1), "application/octet-stream"))
				.status,
		).toBe(204);
		expect((await post("/api/dictation/audio/detach", JSON.stringify({ audioId }), "application/json")).status).toBe(
			200,
		);
		expect(
			(await post(`/api/dictation/audio?audioId=${audioId}&sequence=1`, frame(0.1), "application/octet-stream"))
				.status,
		).toBe(404);
		expect(
			(
				await post(
					"/api/dictation/audio/attach",
					JSON.stringify({ audioId: "bad", sessionId: SESSION.id }),
					"application/json",
				)
			).status,
		).toBe(400);
	});
});
