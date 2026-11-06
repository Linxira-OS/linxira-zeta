/**
 * `getUsageHistory` — the Studio home card's stats read.
 *
 * The three series must agree with the stored rows: a day total is the sum of
 * that local day's rows, the per-model split adds up to it, and the "today"
 * strip only carries today. Expected day keys and hours come from the stats
 * database's own `localtime` bucketing because Bun's test runner reports UTC
 * to `Date` while SQLite keeps the machine's zone; the point of these tests is
 * the grouping, not the timezone conversion.
 */
import { describe, expect, it } from "bun:test";
import { getUsageHistory, initDb, insertMessageStats } from "@linxiraos/pi-stats/db";
import { refreshRollups } from "@linxiraos/pi-stats/rollup";
import type { MessageStats } from "@linxiraos/pi-stats/types";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@pi-stats-usage-history-");

const HOUR = 60 * 60 * 1000;

function message(entryId: string, timestamp: number, model: string, totalTokens: number): MessageStats {
	return {
		sessionFile: `/tmp/${entryId}.jsonl`,
		entryId,
		folder: "/work/a",
		model,
		provider: "prov",
		api: "openai-responses",
		timestamp,
		duration: 1000,
		ttft: 100,
		stopReason: "stop",
		errorMessage: null,
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		agentType: "main",
	};
}

/** Local midnight `daysAgo` days back, per the database's `localtime` day keys. */
async function localDayStart(daysAgo: number): Promise<number> {
	const database = await initDb();
	const row = database
		.query(`SELECT unixepoch(date('now', 'localtime', ? || ' days'), 'utc') * 1000 AS start`)
		.get(String(-daysAgo)) as { start: number };
	return row.start;
}

describe("getUsageHistory", () => {
	it("splits days by local calendar day and models within each day", async () => {
		const database = await initDb();
		const dayStatement = database.query("SELECT date(? / 1000, 'unixepoch', 'localtime') AS day");
		// bun:sqlite returns an untyped row; the SELECT above fixes the shape.
		const dayOf = (timestamp: number): string => {
			const row = dayStatement.get(timestamp) as { day: string };
			return row.day;
		};

		const todayStart = await localDayStart(0);
		const yesterdayStart = await localDayStart(1);
		const twoDaysAgoStart = await localDayStart(2);
		const ancient = (await localDayStart(420)) + 10 * HOUR;
		const twoDaysAgo = twoDaysAgoStart + 10 * HOUR;
		const yesterday = yesterdayStart + 9 * HOUR;
		const today = todayStart + 60_000;
		insertMessageStats([
			message("a", twoDaysAgo, "model-a", 300),
			message("b", yesterday, "model-a", 100),
			message("c", yesterday + 60_000, "model-b", 40),
			message("d", today, "model-b", 7),
			// Outside the 400-day window: must not appear anywhere.
			message("old", ancient, "model-a", 9_999),
		]);
		await refreshRollups();

		const history = await getUsageHistory(Date.now());

		const days = new Map(history.days.map(point => [point.day, point.totalTokens]));
		expect(days.get(dayOf(twoDaysAgo))).toBe(300);
		expect(days.get(dayOf(yesterday))).toBe(140);
		expect(days.get(dayOf(today))).toBe(7);
		expect(days.has(dayOf(ancient))).toBe(false);

		const byModelDay = history.byModelDay
			.filter(point => point.totalTokens > 0)
			.map(point => `${point.day} ${point.model} ${point.totalTokens}`)
			.sort();
		expect(byModelDay).toEqual(
			[
				`${dayOf(twoDaysAgo)} model-a 300`,
				`${dayOf(yesterday)} model-a 100`,
				`${dayOf(yesterday)} model-b 40`,
				`${dayOf(today)} model-b 7`,
			].sort(),
		);
	});

	it("attributes today's tokens to the local hour that produced them", async () => {
		const database = await initDb();
		const hourStatement = database.query(
			`SELECT CAST(strftime('%H', ? / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour`,
		);
		// bun:sqlite returns an untyped row; the SELECT above fixes the shape.
		const hourOf = (timestamp: number): number => {
			const row = hourStatement.get(timestamp) as { hour: number };
			return row.hour;
		};

		const todayStart = await localDayStart(0);
		const yesterdayStart = await localDayStart(1);
		const early = todayStart + 60_000;
		const late = todayStart + 2 * HOUR;
		insertMessageStats([
			message("early", early, "model-a", 11),
			message("late", late, "model-a", 5),
			message("late-b", late + 1000, "model-b", 2),
			message("yesterday", yesterdayStart + 12 * HOUR, "model-a", 500),
		]);
		await refreshRollups();

		const { todayByHour } = await getUsageHistory(Date.now());

		// Only today's rows: yesterday's 500 tokens never reach the hour strip.
		expect(todayByHour.reduce((sum, point) => sum + point.totalTokens, 0)).toBe(18);
		const hours = todayByHour.map(point => `${point.hour} ${point.model} ${point.totalTokens}`).sort();
		expect(hours).toEqual(
			[`${hourOf(early)} model-a 11`, `${hourOf(late)} model-a 5`, `${hourOf(late + 1000)} model-b 2`].sort(),
		);
	});

	it("returns empty series for an empty database", async () => {
		await initDb();
		await expect(getUsageHistory(Date.now())).resolves.toEqual({ days: [], byModelDay: [], todayByHour: [] });
	});
});
