import { ConcatSink } from "@linxiraos/pi-utils";

/** Bound actual streamed bytes, including chunked requests without Content-Length. */
export async function readArtifactBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
	const length = request.headers.get("content-length");
	if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw new Error("body_too_large");
	if (!request.body) throw new Error("empty_artifact");
	const reader = request.body.getReader();
	const sink = new ConcatSink();
	let size = 0;
	try {
		for (;;) {
			request.signal.throwIfAborted();
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > maximum) throw new Error("body_too_large");
			sink.append(chunk.value);
		}
		const bytes = sink.flush();
		if (!bytes) throw new Error("empty_artifact");
		return bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: Uint8Array.from(bytes);
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
