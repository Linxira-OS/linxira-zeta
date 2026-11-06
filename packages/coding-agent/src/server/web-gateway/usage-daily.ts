/**
 * Web Gateway — daily usage series for the Studio home card.
 *
 * `GET /api/usage/daily` answers the same questions the native dashboard's
 * range queries answer, but already shaped for the home card:
 *
 * - per-day token totals for the last ~400 days (the card draws a
 *   calendar-year heatmap, so the window has to reach back past January 1st);
 * - per-day tokens for the year's top five models plus one `other` bucket;
 * - per-model tokens for each local hour of today.
 *
 * Everything comes from the stats database (`messages` + the hourly
 * `message_rollup`) through `@linxiraos/pi-stats/db`; no session transcript is
 * re-parsed here. `GET /api/usage` remains the per-session lifetime listing.
 *
 * Reading here also guarantees ingest: the stats dashboard only starts its
 * background sync when a page connects to it (`statsLive().start()` in
 * `pi-stats/server.ts`), and the home card is often the first usage surface a
 * serve process shows. Starting the same singleton is idempotent.
 */

import type {
	TokenUsageDayPoint,
	TokenUsageHourPoint,
	TokenUsageModelDayPoint,
	TokenUsageModelRef,
	TokenUsageReadModel,
} from "../studio-host/contract/read-models.js";

/**
 * Bucket id for every model outside the year's top five. The Studio renderer
 * keys its localized "other" legend entry and its own chart tone off this
 * exact id (`OTHER_MODEL_ID` in `web-app/src/studio/HomePage.tsx`), so it is a
 * wire value, not a display label.
 */
export const USAGE_OTHER_MODEL = "其他";

/** Models the per-day chart legend keeps before folding the rest into `other`. */
const USAGE_TOP_MODELS = 5;

/** Stated when the stats database holds no usage at all. */
export const USAGE_EMPTY_REASON = "Zeta's statistics database has no recorded usage yet";

/** The aggregate rows the shaping below needs; `getUsageHistory` satisfies it. */
export interface UsageDailySource {
	readonly days: readonly { readonly day: string; readonly totalTokens: number }[];
	readonly byModelDay: readonly {
		readonly day: string;
		readonly model: string;
		readonly totalTokens: number;
	}[];
	readonly todayByHour: readonly { readonly hour: number; readonly model: string; readonly totalTokens: number }[];
}

/**
 * Year-to-date token totals per model, ranked. Ties break on model id so the
 * legend is stable across refreshes instead of following row order.
 */
function ranking(rows: UsageDailySource["byModelDay"], yearStart: string): Map<string, number> {
	const totals = new Map<string, number>();
	for (const row of rows) {
		if (row.day < yearStart) continue;
		totals.set(row.model, (totals.get(row.model) ?? 0) + row.totalTokens);
	}
	return new Map(
		[...totals].sort(([leftId, leftTokens], [rightId, rightTokens]) => {
			if (rightTokens !== leftTokens) return rightTokens - leftTokens;
			return leftId.localeCompare(rightId);
		}),
	);
}

/**
 * Shape the stats aggregates into the home card's read model.
 *
 * - `days` keeps the sparse per-day totals as recorded (a day without usage is
 *   absent; the renderer draws it as zero).
 * - `byModel` covers the current calendar year only and folds every model
 *   outside the top five into one `other` row per day.
 * - `hours` is today's per-model series with the same legend, so `models` is
 *   the one legend both views use.
 */
export function buildUsageDaily(source: UsageDailySource, now = Date.now()): TokenUsageReadModel {
	const yearStart = `${new Date(now).getFullYear()}-01-01`;
	const ranked = ranking(source.byModelDay, yearStart);
	const topModels = new Set([...ranked.keys()].slice(0, USAGE_TOP_MODELS));
	const hasOther = [...ranked].some(([model, totalTokens]) => !topModels.has(model) && totalTokens > 0);

	const models: TokenUsageModelRef[] = [...topModels].map(id => ({ id }));
	if (hasOther) models.push({ id: USAGE_OTHER_MODEL });

	const byModel: TokenUsageModelDayPoint[] = [];
	const otherByDay = new Map<string, number>();
	for (const row of source.byModelDay) {
		if (row.day < yearStart) continue;
		if (!topModels.has(row.model)) {
			otherByDay.set(row.day, (otherByDay.get(row.day) ?? 0) + row.totalTokens);
			continue;
		}
		byModel.push({ date: row.day, model: row.model, tokens: row.totalTokens });
	}
	for (const [date, tokens] of otherByDay) {
		if (tokens > 0) byModel.push({ date, model: USAGE_OTHER_MODEL, tokens });
	}
	byModel.sort((left, right) => left.date.localeCompare(right.date) || left.model.localeCompare(right.model));

	const hours: TokenUsageHourPoint[] = [];
	const otherByHour = new Map<number, number>();
	for (const row of source.todayByHour) {
		if (!topModels.has(row.model)) {
			otherByHour.set(row.hour, (otherByHour.get(row.hour) ?? 0) + row.totalTokens);
			continue;
		}
		hours.push({ hour: row.hour, model: row.model, tokens: row.totalTokens });
	}
	for (const [hour, tokens] of otherByHour) {
		if (tokens > 0) hours.push({ hour, model: USAGE_OTHER_MODEL, tokens });
	}
	hours.sort((left, right) => left.hour - right.hour || left.model.localeCompare(right.model));

	const days: TokenUsageDayPoint[] = source.days.map(row => ({ date: row.day, totalTokens: row.totalTokens }));
	const empty = days.length === 0 && byModel.length === 0 && hours.length === 0;

	return {
		generatedAt: new Date(now).toISOString(),
		days,
		models,
		byModel,
		hours,
		...(empty ? { unavailableReason: USAGE_EMPTY_REASON } : {}),
	};
}

/** Read the aggregates from the stats database, starting background ingest if needed. */
async function readStatsHistory(now: number): Promise<UsageDailySource> {
	// Lazy: the stats graph (SQLite schema, catalog pricing, session parser) is
	// only loaded by a process that actually serves a usage read.
	const [{ getUsageHistory }, { statsLive }] = await Promise.all([
		import("@linxiraos/pi-stats/db"),
		import("@linxiraos/pi-stats/live"),
	]);
	// Idempotent; the dashboard's own SSE handler calls the same singleton.
	statsLive().start();
	return getUsageHistory(now);
}

/**
 * GET /api/usage/daily — the home card's daily/model/hourly series.
 *
 * The reader is injectable so tests exercise the shaping and the response
 * envelope without a stats database. A read failure still answers 200 with the
 * reason attached: an empty card with an honest sentence beats a failed card.
 */
export async function handleUsageDaily(
	now = Date.now(),
	read: (now: number) => Promise<UsageDailySource> = readStatsHistory,
): Promise<Response> {
	try {
		return Response.json(buildUsageDaily(await read(now), now));
	} catch (error) {
		const reason = `Zeta could not read its statistics database: ${error instanceof Error ? error.message : String(error)}`;
		const empty: TokenUsageReadModel = {
			generatedAt: new Date(now).toISOString(),
			days: [],
			models: [],
			byModel: [],
			hours: [],
			unavailableReason: reason,
		};
		return Response.json(empty);
	}
}
