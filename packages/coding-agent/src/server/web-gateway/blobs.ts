import { getBlobsDir } from "@linxiraos/pi-utils";
import { BLOB_HASH_RE, BlobStore } from "../../session/blob-store";

/**
 * The blob store is content-addressed and records no type, so an `<img>` pointed
 * at one used to receive `application/octet-stream`. Browsers sniff images in
 * practice, but not when a proxy adds `X-Content-Type-Options: nosniff`, so
 * identify the handful of types the agent actually produces.
 */
function sniffImageMime(data: Buffer): string | undefined {
	if (data.length >= 8 && data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
	if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
	if (data.length >= 6 && data.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
	if (
		data.length >= 12 &&
		data.subarray(0, 4).toString("latin1") === "RIFF" &&
		data.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "image/webp";
	}
	if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return "image/bmp";
	if (data.length >= 12 && data.subarray(4, 8).toString("latin1") === "ftyp") {
		const brand = data.subarray(8, 12).toString("latin1");
		if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
	}
	return undefined;
}

/** Serve one canonical session blob by SHA-256 hash. */
export async function handleBlobGet(req: Request, hash: string): Promise<Response> {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return Response.json({ error: "Method not allowed" }, { status: 405 });
	}
	if (!BLOB_HASH_RE.test(hash)) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}

	const blob = await new BlobStore(getBlobsDir()).get(hash);
	if (!blob) return Response.json({ error: "not_found" }, { status: 404 });

	return new Response(req.method === "HEAD" ? null : blob, {
		headers: {
			"cache-control": "no-store",
			"content-length": String(blob.byteLength),
			"content-type": sniffImageMime(blob) ?? "application/octet-stream",
		},
	});
}
