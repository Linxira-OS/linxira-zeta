import { getBlobsDir } from "@linxiraos/pi-utils";
import { BLOB_HASH_RE, BlobStore } from "../../session/blob-store";

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
			"content-type": "application/octet-stream",
		},
	});
}
