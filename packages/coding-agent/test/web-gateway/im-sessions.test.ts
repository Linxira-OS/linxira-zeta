import { afterEach, describe, expect, test } from "bun:test";
import type { ImSessionCandidateOptions } from "../../src/channels/session-router";
import { registerImSessionCandidateReader } from "../../src/channels/session-router";
import { handleImSessions } from "../../src/server/web-gateway/im-instances";

afterEach(() => registerImSessionCandidateReader(null));

describe("IM session candidates", () => {
	test("passes includePm through to the live router", async () => {
		const seen: ImSessionCandidateOptions[] = [];
		registerImSessionCandidateReader(async options => {
			seen.push(options ?? {});
			return { generatedAt: 1, candidates: [], bySelector: new Map() };
		});

		const response = await handleImSessions(
			new Request("http://127.0.0.1/api/im/sessions?includePm=true"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ sessions: [], generatedAt: new Date(1).toISOString() });
		expect(seen).toEqual([{ includePm: true }]);
	});

	test("defaults includePm off when the query omits it", async () => {
		const seen: ImSessionCandidateOptions[] = [];
		registerImSessionCandidateReader(async options => {
			seen.push(options ?? {});
			return { generatedAt: 2, candidates: [], bySelector: new Map() };
		});

		await handleImSessions(new Request("http://127.0.0.1/api/im/sessions"));
		expect(seen).toEqual([{ includePm: false }]);
	});
});
