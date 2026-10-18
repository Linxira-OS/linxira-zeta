import { describe, expect, test } from "bun:test";
import { CLIP_UPLOAD_ENABLED, uploadClip } from "../../src/stream/clip-upload";

/**
 * Zeta ships no clip host. The gate must throw before parsing, gzip work, or
 * fetch, so a recording can never leave the machine even when a caller passes
 * a server URL and a bearer.
 */
describe("clip uploads", () => {
	test("are disabled before any network work", async () => {
		expect(CLIP_UPLOAD_ENABLED).toBe(false);

		const originalFetch = globalThis.fetch;
		let fetched = 0;
		globalThis.fetch = (async () => {
			fetched++;
			throw new Error("network reached");
		}) as unknown as typeof fetch;
		try {
			await expect(
				uploadClip({
					serverUrl: "https://clips.invalid",
					token: "token",
					recording: "",
				}),
			).rejects.toThrow(/clip uploads are unavailable in Zeta/);
			expect(fetched).toBe(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
