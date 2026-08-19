/**
 * Web Gateway — `/api/docs/<path>` handler for the packaged Markdown corpus.
 *
 * Content comes from the same docs index the `omp://docs/` protocol serves
 * (`internal-urls/docs-index.ts`): compiled binaries / the npm bundle read the
 * gzip+base64 embed, a dev tree falls back to the source `docs/` directory.
 * Paths are restricted to `[A-Za-z0-9._/-]` and must not contain `..` or be
 * absolute, so a request can never escape the docs root.
 */

import { getEmbeddedDoc } from "../../internal-urls/docs-index";

const DOC_PATH_RE = /^[A-Za-z0-9._/-]+$/;

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** GET /api/docs/<path> — `{ path, content }`, or 404 `{ error: "not_found" }`. */
export async function handleDocsGet(req: Request, docPath: string): Promise<Response> {
	if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

	if (!DOC_PATH_RE.test(docPath) || docPath.includes("..") || docPath.startsWith("/")) {
		return json({ error: "Invalid docs path" }, 400);
	}

	const content = await getEmbeddedDoc(docPath);
	if (content === undefined) {
		return json({ error: "not_found" }, 404);
	}

	return json({ path: docPath, content });
}
