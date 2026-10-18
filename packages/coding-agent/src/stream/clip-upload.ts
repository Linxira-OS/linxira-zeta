import { type ClipUploadResponse, STREAM_ROUTES } from "@linxiraos/pi-wire";
import { parseRecording, type RecordingHeader } from "./recording";

export interface ClipUploadOptions {
	/** Stream server base URL (`stream.serverUrl`); no server ships with Zeta. */
	serverUrl: string;
	/** Stencil bearer (see `StencilCredential`); the clip belongs to its account. */
	token: string;
	/** `.zetacast` file contents. */
	recording: string;
	/** Replaces the recording's title. */
	title?: string;
	description?: string;
}

/**
 * Clip uploads are unavailable in Zeta: no clip/stream server ships. Kept as a
 * flag so the check is visible at the call boundary; flip only alongside
 * shipping real hosting.
 */
export const CLIP_UPLOAD_ENABLED: boolean = false;

/**
 * Publish a `/record` capture as a clip at `<server>/c/<id>`. Uploads are
 * disabled in Zeta (see {@link CLIP_UPLOAD_ENABLED}); the call always throws
 * before touching the network, and recordings stay local for `zetacode play`.
 *
 * @throws {Error} always while {@link CLIP_UPLOAD_ENABLED} is false.
 */
export async function uploadClip(options: ClipUploadOptions): Promise<ClipUploadResponse> {
	if (!CLIP_UPLOAD_ENABLED) {
		throw new Error(
			"clip uploads are unavailable in Zeta: no upload server ships; recordings stay local (use `zetacode play`)",
		);
	}
	const base = new URL(options.serverUrl);
	if (base.protocol !== "https:" && base.protocol !== "http:") {
		throw new Error(`clip server URL must use http or https: ${options.serverUrl}`);
	}
	const { header } = parseRecording(options.recording);
	const stamped: RecordingHeader = {
		...header,
		...(options.title !== undefined && { title: options.title }),
		...(options.description !== undefined && { description: options.description }),
	};
	const body = JSON.stringify(stamped) + options.recording.slice(options.recording.indexOf("\n"));
	const response = await fetch(`${base.origin}${base.pathname.replace(/\/+$/, "")}${STREAM_ROUTES.clips}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.token}`,
			"Content-Type": "application/x-ndjson",
			"Content-Encoding": "gzip",
		},
		body: Bun.gzipSync(body),
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const reason =
			payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
				? payload.error
				: response.statusText;
		throw new Error(`clip upload failed (${response.status}): ${reason}`);
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		!("id" in payload) ||
		!("url" in payload) ||
		typeof payload.id !== "string" ||
		typeof payload.url !== "string"
	) {
		throw new Error("clip upload failed: unexpected server response");
	}
	return { id: payload.id, url: payload.url };
}
