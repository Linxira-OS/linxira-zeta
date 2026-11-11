/**
 * Desktop dictation relay: the Renderer's preload hands ordered Worklet frames
 * to Main, and Main posts them to the Host's prepared `audioId` sink. These
 * tests pin the pure relay boundary (validation, ordering, serialized HTTP
 * posts, error propagation) without Electron or a gateway.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createLiveAudioRelay } from "../src/live-audio.ts";

const AUDIO_ID = "11111111-2222-3333-4444-555555555555";
const SESSION = "session-1";
const FRAME = new Uint8Array(320 * 4);

function recorder(responses = []) {
	const calls = [];
	const post = async (path, init) => {
		calls.push({ path, init });
		const next = responses.shift();
		return next ?? { ok: true, status: 200 };
	};
	return { calls, post };
}

test("attach validates the id and posts the session once per audioId", async () => {
	const { calls, post } = recorder();
	const relay = createLiveAudioRelay(post);

	assert.deepEqual(await relay.attach({ audioId: "not-a-uuid", sessionId: SESSION }), {
		ok: false,
		message: "Invalid audio attach request",
	});
	assert.deepEqual(await relay.attach({ audioId: AUDIO_ID, sessionId: "" }), {
		ok: false,
		message: "Invalid audio attach request",
	});

	assert.deepEqual(await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION }), { ok: true });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].path, "/api/dictation/audio/attach");
	assert.equal(calls[0].init.contentType, "application/json");
	assert.deepEqual(JSON.parse(calls[0].init.body), { audioId: AUDIO_ID, sessionId: SESSION });

	// Re-attaching the same pair is idempotent; another session is refused.
	assert.deepEqual(await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION }), { ok: true });
	assert.equal(calls.length, 1);
	assert.equal((await relay.attach({ audioId: AUDIO_ID, sessionId: "other" })).ok, false);
	assert.equal(calls.length, 1);
});

test("a transport failure surfaces its Host message at attach", async () => {
	const { post } = recorder([{ ok: false, status: 404, message: "Dictation input was not prepared" }]);
	const relay = createLiveAudioRelay(post);
	assert.deepEqual(await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION }), {
		ok: false,
		message: "Dictation input was not prepared",
	});
});

test("frames require attachment, exact size and strictly increasing sequence", async () => {
	const { calls, post } = recorder();
	const relay = createLiveAudioRelay(post);

	assert.equal((await relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: FRAME })).ok, false);
	await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION });

	assert.equal((await relay.append({ audioId: AUDIO_ID, sequence: 1, bytes: FRAME })).ok, false);
	assert.equal((await relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: new Uint8Array(0) })).ok, false);
	assert.equal((await relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: new Uint8Array(65_540) })).ok, false);
	assert.equal(calls.length, 1);

	assert.deepEqual(await relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: FRAME }), { ok: true });
	assert.equal(calls[1].path, `/api/dictation/audio?audioId=${encodeURIComponent(AUDIO_ID)}&sequence=0`);
	assert.equal(calls[1].init.contentType, "application/octet-stream");
	assert.equal(calls[1].init.body.byteLength, FRAME.byteLength);
});

test("posts for one audioId are serialized so HTTP reordering cannot reach the recognizer", async () => {
	const frames = [];
	const started = [];
	const { promise: firstGate, resolve: releaseFirst } = Promise.withResolvers();
	const post = async (path, init) => {
		if (!path.startsWith("/api/dictation/audio?")) return { ok: true, status: 200 };
		const sequence = Number(new URL(`http://x${path}`).searchParams.get("sequence"));
		frames.push({ path, init });
		started.push(sequence);
		if (sequence === 0) await firstGate;
		return { ok: true, status: 204 };
	};
	const relay = createLiveAudioRelay(post);
	await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION });

	const first = relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: FRAME });
	const second = relay.append({ audioId: AUDIO_ID, sequence: 1, bytes: FRAME });
	const { promise: settled, resolve: release } = Promise.withResolvers();
	setTimeout(release, 0);
	await settled;
	// The second frame is queued behind the first POST, not sent concurrently.
	assert.deepEqual(started, [0]);
	releaseFirst();
	assert.deepEqual(await first, { ok: true });
	assert.deepEqual(await second, { ok: true });
	assert.deepEqual(started, [0, 1]);
	assert.equal(frames[1].path, `/api/dictation/audio?audioId=${encodeURIComponent(AUDIO_ID)}&sequence=1`);
});

test("a rejected frame closes the attachment and later frames fail explicitly", async () => {
	const { post } = recorder([
		{ ok: true, status: 200 },
		{ ok: false, status: 409, message: "Audio frames arrived out of order" },
	]);
	const relay = createLiveAudioRelay(post);
	await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION });

	assert.deepEqual(await relay.append({ audioId: AUDIO_ID, sequence: 0, bytes: FRAME }), {
		ok: false,
		message: "Audio frames arrived out of order",
	});
	assert.deepEqual(await relay.append({ audioId: AUDIO_ID, sequence: 1, bytes: FRAME }), {
		ok: false,
		message: "Dictation audio is closed",
	});
});

test("detach is idempotent and posts the Host detach once", async () => {
	const { calls, post } = recorder();
	const relay = createLiveAudioRelay(post);
	await relay.attach({ audioId: AUDIO_ID, sessionId: SESSION });

	assert.deepEqual(await relay.detach({ audioId: AUDIO_ID }), { ok: true });
	assert.equal(calls.at(-1).path, "/api/dictation/audio/detach");
	assert.deepEqual(JSON.parse(calls.at(-1).init.body), { audioId: AUDIO_ID });
	assert.deepEqual(await relay.detach({ audioId: AUDIO_ID }), { ok: true });
	assert.equal(calls.length, 2);
});
