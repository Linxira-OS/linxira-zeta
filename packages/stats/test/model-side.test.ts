import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { syncAllSessions } from "@linxiraos/pi-stats/aggregator";
import {
	closeDb,
	currentDb,
	getMessageCount,
	getModelSideByModel,
	getModelSideBySession,
	getModelSideOverall,
	getModelSideTimeSeries,
	initDb,
	insertAssistantText,
} from "@linxiraos/pi-stats/db";
import { getModelSideDashboardStats } from "@linxiraos/pi-stats/model-side";
import type { AssistantTextStats } from "@linxiraos/pi-stats/types";
import { PROSE_MAX_CHARS } from "@linxiraos/pi-stats/user-metrics";
import { getSessionsDir, getStatsDbPath } from "@linxiraos/pi-utils";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@pi-stats-model-side-");

const FOLDER_SLUG = "--tmp--model-side";
const MODEL = "gpt-5.4";
const PROVIDER = "openai";
const TS1 = "2026-06-24T10:00:00.000Z";
const TS2 = "2026-06-24T10:05:00.000Z";
const HOUR_MS = 60 * 60 * 1000;

interface ToolCallBlock {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

interface TurnOptions {
	entryId: string;
	parentId: string | null;
	timestamp: string;
	text?: string;
	thinking?: string;
	toolCalls?: ToolCallBlock[];
}

function buildAssistantEntry(opts: TurnOptions) {
	return {
		type: "message",
		id: opts.entryId,
		parentId: opts.parentId,
		timestamp: opts.timestamp,
		message: {
			role: "assistant",
			content: [
				...(opts.thinking ? [{ type: "thinking", thinking: opts.thinking }] : []),
				...(opts.text ? [{ type: "text", text: opts.text }] : []),
				...(opts.toolCalls ?? []),
			],
			api: "openai-responses",
			provider: PROVIDER,
			model: MODEL,
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: opts.toolCalls && opts.toolCalls.length > 0 ? "toolUse" : "stop",
			timestamp: Date.parse(opts.timestamp),
			duration: 10,
			ttft: 5,
		},
	};
}

function buildToolResult(entryId: string, parentId: string, timestamp: string, toolCallId: string, isError: boolean) {
	return {
		type: "message",
		id: entryId,
		parentId,
		timestamp,
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "read",
			content: [{ type: "text", text: isError ? "ENOENT: no such file" : "ok" }],
			isError,
			timestamp: Date.parse(timestamp),
		},
	};
}

async function writeSessionFile(fileName: string, entries: unknown[]): Promise<string> {
	const sessionDir = path.join(getSessionsDir(), FOLDER_SLUG);
	await fs.mkdir(sessionDir, { recursive: true });
	const sessionFile = path.join(sessionDir, fileName);
	const header = { type: "session", version: 3, id: "sess-model-side", timestamp: TS1, cwd: "/tmp/project" };
	await Bun.write(sessionFile, `${[header, ...entries].map(entry => JSON.stringify(entry)).join("\n")}\n`);
	return sessionFile;
}

/** Four turns: a failed-tool spiral, a thinking-only turn, and a markup-only turn. */
function buildSpiralEntries(): unknown[] {
	const call = (id: string): ToolCallBlock => ({ id, name: "read", arguments: { path: "/tmp/missing" } });
	return [
		buildAssistantEntry({
			entryId: "asst-1",
			parentId: null,
			timestamp: TS1,
			text: "I'm sorry, let me check the file.",
			toolCalls: [call("call-1"), call("call-2"), call("call-3")],
		}),
		buildToolResult("tr-1", "asst-1", TS1, "call-1", true),
		buildToolResult("tr-2", "asst-1", TS1, "call-2", true),
		buildToolResult("tr-3", "asst-1", TS1, "call-3", true),
		buildAssistantEntry({
			entryId: "asst-2",
			parentId: "tr-3",
			timestamp: TS2,
			text: "I'm not sure. As I said earlier, this may be a permissions issue.",
		}),
		buildAssistantEntry({
			entryId: "asst-3",
			parentId: "asst-2",
			timestamp: TS2,
			thinking: "I'm sorry, I can't do that.",
		}),
		buildAssistantEntry({ entryId: "asst-4", parentId: "asst-3", timestamp: TS2, text: "```sh\nls -la\n```" }),
	];
}

describe("model-side ingest and aggregation", () => {
	it("merges provider/spelling variants into one dashboard row", async () => {
		await initDb();
		const row = (entryId: string, model: string, timestamp: number): AssistantTextStats => ({
			sessionFile: `/tmp/${entryId}.jsonl`,
			entryId,
			folder: "/tmp/project",
			timestamp,
			model,
			provider: "anthropic",
			agentType: "main",
			chars: 20,
			words: 4,
			selfBlame: 1,
			restatement: 0,
			hedge: 0,
			verbose: 0,
			toolErrors: 0,
			toolSpiral: 0,
			collapse: 1,
			unsupportedScript: 0,
			prose: "I'm sorry about that.",
		});
		const now = Date.now();
		insertAssistantText([row("a-1", "claude-opus-4-6", now - 1000), row("a-2", "claude-opus-4.6", now)]);

		const dashboard = await getModelSideDashboardStats(null);
		expect(dashboard.overall.messages).toBe(2);
		expect(dashboard.byModel).toHaveLength(1);
		expect(dashboard.byModel[0]).toMatchObject({
			key: "anthropic/opus/4.6.0",
			label: "opus 4.6",
			family: "opus",
			messages: 2,
			blamed: 2,
			breakdown: 2,
			collapse: 2,
		});
		expect(dashboard.byModel[0].models.toSorted()).toEqual(["claude-opus-4-6", "claude-opus-4.6"]);
		expect(dashboard.bySession).toHaveLength(2);
		expect(dashboard.series.length).toBeGreaterThan(0);
	});

	it("stores assistant prose, skips thinking/markup, and aggregates by model, bucket and session", async () => {
		await writeSessionFile("spiral.jsonl", buildSpiralEntries());
		await syncAllSessions({ workers: 1 });

		const overall = getModelSideOverall(null);
		expect(overall.messages).toBe(2);
		expect(overall.blamed).toBe(1);
		expect(overall.restated).toBe(1);
		expect(overall.hedged).toBe(1);
		expect(overall.spiraled).toBe(1);
		expect(overall.breakdown).toBe(2);
		// Turn 1: one apology. Turn 2: one hedge + one restatement + a 3-failure spiral.
		expect(overall.collapse).toBe(1 + (1 + 1 + 3));
		expect(overall.toolErrors).toBe(3);

		const stored = currentDb()
			?.query<{ entry_id: string; prose: string; self_blame: number }, []>(
				"SELECT entry_id, prose, self_blame FROM assistant_text ORDER BY entry_id",
			)
			.all();
		expect(stored?.map(row => row.entry_id)).toEqual(["asst-1", "asst-2"]);
		expect(stored?.[0].prose).not.toContain("thinking");
		expect(stored?.[1].prose).toContain("permissions issue");

		const byModel = getModelSideByModel(null);
		expect(byModel).toHaveLength(1);
		expect(byModel[0]).toMatchObject({ model: MODEL, provider: PROVIDER, messages: 2, breakdown: 2 });

		const bySession = getModelSideBySession(null);
		expect(bySession).toHaveLength(1);
		expect(bySession[0].models).toEqual([MODEL]);
		expect(bySession[0].folder).toBe("/tmp/model-side");
		expect(bySession[0].messages).toBe(2);

		const series = getModelSideTimeSeries({ cutoff: null, bucketMs: HOUR_MS });
		expect(series).toHaveLength(1);
		expect(series[0].messages).toBe(2);
		expect(series[0].breakdown).toBe(2);

		// An unchanged transcript re-syncs without duplicating rows.
		await syncAllSessions({ workers: 1 });
		expect(getModelSideOverall(null)).toEqual(overall);
	});

	it("caps the stored prose like the user-side judge body", async () => {
		await writeSessionFile("long.jsonl", [
			buildAssistantEntry({ entryId: "asst-long", parentId: null, timestamp: TS1, text: "y ".repeat(3000) }),
		]);
		await syncAllSessions({ workers: 1 });

		const row = currentDb()
			?.query<{ prose_length: number; words: number; verbose: number }, []>(
				"SELECT LENGTH(prose) AS prose_length, words, verbose FROM assistant_text",
			)
			.get();
		expect(row?.prose_length).toBe(PROSE_MAX_CHARS);
		// The cap applies before counting, so only the stored body is measured.
		expect(row?.words).toBe(PROSE_MAX_CHARS / 2);
		expect(row?.verbose).toBe(1);
	});

	it("backfills once, bounds the wipe to assistant text, and stays idempotent", async () => {
		await writeSessionFile("backfill.jsonl", buildSpiralEntries());
		await syncAllSessions({ workers: 1 });

		const before = getModelSideOverall(null);
		const messagesBefore = getMessageCount();
		expect(before.messages).toBe(2);

		// Simulate an old database that predates the model-side table: dropping
		// the sentinel must enroll the one-time backfill.
		closeDb();
		const raw = new Database(getStatsDbPath());
		raw.run("DELETE FROM meta WHERE key = 'assistant_text_v1'");
		raw.close();
		await initDb();
		expect(getModelSideOverall(null).messages).toBe(0);
		// Bounded: the backfill wipes only assistant_text and file offsets.
		expect(getMessageCount()).toBe(messagesBefore);

		await syncAllSessions({ workers: 1 });
		expect(getModelSideOverall(null)).toEqual(before);

		// The sentinel is COMPLETE now: a later init must not wipe the rows.
		closeDb();
		await initDb();
		expect(getModelSideOverall(null)).toEqual(before);
	});
});
