/**
 * Loopback audio transport for Studio draft dictation.
 *
 * The Renderer never posts audio itself: Electron Main owns the preload bridge
 * (`attachLiveAudio` / `appendLiveAudio` / `detachLiveAudio`) and forwards the
 * Ordered 16 kHz mono Float32 frames here. Access is the gateway's normal
 * loopback rule (no `Origin` on Main's fetch, no remote token needed locally);
 * an audioId is only accepted after `dictation.prepare` registered its sink.
 */
import {
	appendDictationAudio,
	attachDictationAudio,
	detachDictationAudio,
	DictationAudioReject,
} from "../studio-host/dictation-audio";

const MAX_FRAME_BYTES = 65_536;
const AUDIO_ID_RE = /^[a-f0-9-]{36}$/u;

interface JsonObject {
	readonly [key: string]: unknown;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}

function bodyObject(value: unknown): JsonObject | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function stringField(body: JsonObject | undefined, field: string): string | undefined {
	const value = body?.[field];
	return typeof value === "string" ? value : undefined;
}

function audioIdOf(value: string | undefined): string | undefined {
	return value !== undefined && AUDIO_ID_RE.test(value) ? value : undefined;
}

function rejected(error: unknown): Response {
	if (error instanceof DictationAudioReject) return json({ ok: false, error: error.message }, error.status);
	return json({ ok: false, error: error instanceof Error ? error.message : "Audio transport failed" }, 500);
}

async function attach(req: Request): Promise<Response> {
	const body = bodyObject(await req.json().catch(() => undefined));
	const audioId = audioIdOf(stringField(body, "audioId"));
	const sessionId = stringField(body, "sessionId");
	if (audioId === undefined || sessionId === undefined || sessionId === "" || sessionId.length > 512) {
		return json({ ok: false, error: "Invalid audio attach input" }, 400);
	}
	try {
		attachDictationAudio(audioId, sessionId);
		return json({ ok: true });
	} catch (error) {
		return rejected(error);
	}
}

async function append(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const audioId = audioIdOf(url.searchParams.get("audioId") ?? undefined);
	const rawSequence = url.searchParams.get("sequence");
	const sequence = rawSequence === null ? Number.NaN : Number(rawSequence);
	if (audioId === undefined || !Number.isSafeInteger(sequence) || sequence < 0) {
		return json({ ok: false, error: "Invalid audio frame input" }, 400);
	}
	const bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES) {
		return json({ ok: false, error: "Invalid audio frame size" }, 400);
	}
	try {
		appendDictationAudio(audioId, sequence, bytes);
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	} catch (error) {
		return rejected(error);
	}
}

async function detach(req: Request): Promise<Response> {
	const body = bodyObject(await req.json().catch(() => undefined));
	const audioId = audioIdOf(stringField(body, "audioId"));
	if (audioId === undefined) return json({ ok: false, error: "Invalid audio detach input" }, 400);
	try {
		detachDictationAudio(audioId);
		return json({ ok: true });
	} catch (error) {
		return rejected(error);
	}
}

/** Answer one `/api/dictation/audio*` request. */
export async function handleDictationAudio(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const pathname = new URL(req.url).pathname;
	if (pathname === "/api/dictation/audio/attach") return attach(req);
	if (pathname === "/api/dictation/audio/detach") return detach(req);
	if (pathname === "/api/dictation/audio") return append(req);
	return json({ error: "not_found" }, 404);
}
