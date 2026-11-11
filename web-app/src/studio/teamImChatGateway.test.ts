/**
 * IM chat gateway decode tests. These drive real response shapes through a
 * fake fetcher: numbers/labels/summaries must be passed through unchanged, and
 * the transcript must keep each message's own immutable IM route.
 */
import { describe, expect, test } from "bun:test";
import type { SessionId } from "@linxiraos/studio-contract";
import type { GatewayFetch } from "./settings/gatewayRequest";
import { loadImChatCandidates, loadImChatTranscript } from "./teamImChatGateway";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function fakeFetch(payload: unknown, calls: string[] = [], status = 200): GatewayFetch {
	return (input: string) => {
		calls.push(input);
		return Promise.resolve(jsonResponse(payload, status));
	};
}

async function rejectsWith(promise: Promise<unknown>, message: string): Promise<void> {
	try {
		await promise;
	} catch (error) {
		expect(String(error instanceof Error ? error.message : error)).toContain(message);
		return;
	}
	throw new Error(`expected rejection containing ${message}`);
}

const SESSION = "sess-1" as SessionId;

describe("IM candidate selector", () => {
	test("passes the backend number, label, summary and source through unchanged", async () => {
		const calls: string[] = [];
		const fetcher = fakeFetch(
			{
				sessions: [
					{
						selector: "02-00009",
						canonicalSessionId: "sess-a",
						canonicalId: "sess-a",
						bindingId: "bind-2",
						workspaceAlias: "ops",
						workspaceId: "ops",
						label: "Ops release",
						latestTaskSummary: "Released 1.5 build",
						status: "completed",
						lastActiveAt: "2026-11-12T03:00:00.000Z",
						isPm: false,
						tag: "bot",
					},
					{
						selector: "01-00003",
						canonicalSessionId: "sess-b",
						workspaceAlias: "core",
						label: "Core prompt",
						status: "incomplete",
						isPm: true,
						tag: "relay",
					},
				],
				generatedAt: "2026-11-12T04:00:00.000Z",
			},
			calls,
		);
		const rows = await loadImChatCandidates(fetcher);
		expect(calls).toEqual(["/api/im/sessions"]);
		expect(rows.length).toBe(2);
		expect(rows[0]?.selector).toBe("02-00009");
		expect(rows[0]?.canonicalSessionId).toBe("sess-a");
		expect(rows[0]?.label).toBe("Ops release");
		expect(rows[0]?.latestTaskSummary).toBe("Released 1.5 build");
		expect(rows[0]?.summaryState).toBe("completed");
		expect(rows[0]?.bindingId).toBe("bind-2");
		expect(rows[0]?.workspaceAlias).toBe("ops");
		expect(rows[0]?.isPm).toBe(false);
		expect(rows[1]?.selector).toBe("01-00003");
		expect(rows[1]?.canonicalSessionId).toBe("sess-b");
		expect(rows[1]?.label).toBe("Core prompt");
		expect(rows[1]?.summaryState).toBe("incomplete");
		expect(rows[1]?.workspaceAlias).toBe("core");
		expect(rows[1]?.isPm).toBe(true);
		expect(rows[1]?.latestTaskSummary).toBeUndefined();
	});

	test("skips a malformed row instead of inventing a number or label", async () => {
		const rows = await loadImChatCandidates(
			fakeFetch({ sessions: [{ canonicalSessionId: "sess-x" }, { selector: "01-00001", canonicalSessionId: "sess-y", label: "Real" }] }),
		);
		expect(rows.map(row => row.canonicalSessionId)).toEqual(["sess-y"]);
	});

	test("an empty selector is an empty list, not an error", async () => {
		expect(await loadImChatCandidates(fakeFetch({ sessions: [], generatedAt: null }))).toEqual([]);
	});

	test("an unmerged or malformed route is reported, never replaced locally", async () => {
		await rejectsWith(loadImChatCandidates(fakeFetch({ error: "Unknown route" }, [], 404)), "Unknown route");
		await rejectsWith(loadImChatCandidates(fakeFetch({ sessions: "not-a-list" })), "IM selector response is malformed");
	});
});

describe("IM canonical transcript", () => {
	test("keeps each message's immutable IM route, including a late reply's original target", async () => {
		const calls: string[] = [];
		const fetcher = fakeFetch(
			{
				sessionId: "sess-1",
				context: {
					messages: [
						{ role: "user", content: [{ type: "text", text: "deploy the release" }], timestamp: 1000 },
						{ role: "assistant", content: "deploying", timestamp: 2000 },
						{ role: "assistant", content: [{ type: "text", text: "deployed" }], timestamp: 3000 },
						{ role: "toolResult", content: [{ type: "text", text: "exit 0" }], timestamp: 4000 },
					],
					entryIds: ["e1", "e2", "e3", "e4"],
					messageMetadata: [
						{
							source: "im",
							platform: "feishu",
							chatId: "chat-1",
							messageId: "m1",
							sentAt: "2026-11-12T01:00:00.000Z",
							route: { workspaceAlias: "core", agentId: "pm-core", bindingId: "bind-1" },
						},
						null,
						{
							source: "im",
							platform: "feishu",
							chatId: "chat-1",
							messageId: "m2",
							replyToMessageId: "m1",
							sentAt: "2026-11-12T01:01:00.000Z",
							route: { workspaceAlias: "ops", agentId: "eng-ops", bindingId: "bind-2" },
						},
					],
					controlEvents: [
						{
							entryId: "control-1",
							metadata: {
								source: "im_control",
								action: "switch_confirm",
								requestId: "req-1",
								from: { workspaceAlias: "core", agentId: "pm-core" },
								to: { workspaceAlias: "ops", agentId: "eng-ops" },
								sentAt: "2026-11-12T01:02:00.000Z",
							},
						},
					],
				},
				info: { firstMessage: "DO NOT USE THIS AS A SUMMARY" },
			},
			calls,
		);
		const transcript = await loadImChatTranscript(SESSION, fetcher);
		expect(calls).toEqual(["/api/sessions/sess-1?limit=100"]);
		expect(transcript.bubbles.map(row => row.itemId)).toEqual(["e1", "e2", "e3", "e4"]);
		expect(transcript.bubbles[0]?.origin).toEqual({ workspaceAlias: "core", agentId: "pm-core", bindingId: "bind-1" });
		expect(transcript.bubbles[1]?.origin).toBeUndefined();
		expect(transcript.bubbles[2]?.origin).toEqual({ workspaceAlias: "ops", agentId: "eng-ops", bindingId: "bind-2" });
		expect(transcript.bubbles[2]?.replyToMessageId).toBe("m1");
		expect(transcript.bubbles[3]?.role).toBe("tool");
		expect(transcript.controls).toEqual([
			{
				entryId: "control-1",
				action: "switch_confirm",
				requestId: "req-1",
				from: { workspaceAlias: "core", agentId: "pm-core" },
				to: { workspaceAlias: "ops", agentId: "eng-ops" },
				sentAt: "2026-11-12T01:02:00.000Z",
			},
		]);
		expect(transcript.bubbles.every(row => !row.text.includes("DO NOT USE"))).toBe(true);
	});

	test("a transcript without IM metadata still renders its canonical messages", async () => {
		const transcript = await loadImChatTranscript(
			SESSION,
			fakeFetch({
				context: {
					messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1000 }],
					entryIds: ["e1"],
				},
			}),
		);
		expect(transcript.bubbles).toEqual([
			{ itemId: "e1", role: "user", text: "hello", createdAt: new Date(1000).toISOString() },
		]);
		expect(transcript.controls).toEqual([]);
	});

	test("a malformed transcript response is an error, not an empty conversation", async () => {
		await rejectsWith(loadImChatTranscript(SESSION, fakeFetch({ sessionId: "sess-1" })), "Session transcript response is malformed");
	});
});
