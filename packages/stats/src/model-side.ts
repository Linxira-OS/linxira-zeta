/**
 * Model-side dashboard: how often each model's own replies show the textual
 * marks of a turn going badly ("AI breakdown level", AI 崩溃度).
 *
 * The signals are computed at ingest (`model-metrics.ts`) and stored in
 * `assistant_text`; this module merges them by catalog identity and shapes the
 * payload for the frustration page's second section. It never judges anything:
 * there is no model call and no extra storage beyond the capped prose row.
 */
import { getTimeRangeConfig } from "./aggregator";
import {
	getModelSideByModel,
	getModelSideBySession,
	getModelSideOverall,
	getModelSideTimeSeries,
	initDb,
	type ModelSideModelRow,
} from "./db";
import { compareModelIdentity, modelIdentityOf } from "./model-identity";
import type { ModelSideDashboardStats, ModelSideModelStats } from "./shared-types";

/** Sessions the payload carries. The long tail is available only through the DB. */
const SESSION_LIMIT = 40;

/** Merge per-(model, provider) rows into catalog identities, same grouping as the user side. */
export function mergeModelSideRows(rows: readonly ModelSideModelRow[]): ModelSideModelStats[] {
	const merged = new Map<string, ModelSideModelStats>();
	for (const row of rows) {
		const identity = modelIdentityOf(row.provider, row.model);
		const existing = merged.get(identity.key);
		if (existing) {
			existing.messages += row.messages;
			existing.blamed += row.blamed;
			existing.restated += row.restated;
			existing.hedged += row.hedged;
			existing.verbose += row.verbose;
			existing.spiraled += row.spiraled;
			existing.breakdown += row.breakdown;
			existing.collapse += row.collapse;
			existing.words += row.words;
			existing.toolErrors += row.toolErrors;
			existing.unscored += row.unscored;
			existing.firstSeen = Math.min(existing.firstSeen, row.firstSeen);
			if (!existing.models.includes(row.model)) existing.models.push(row.model);
			continue;
		}
		merged.set(identity.key, {
			...identity,
			models: [row.model],
			firstSeen: row.firstSeen,
			messages: row.messages,
			blamed: row.blamed,
			restated: row.restated,
			hedged: row.hedged,
			verbose: row.verbose,
			spiraled: row.spiraled,
			breakdown: row.breakdown,
			collapse: row.collapse,
			words: row.words,
			toolErrors: row.toolErrors,
			unscored: row.unscored,
		});
	}
	return [...merged.values()].sort(compareModelIdentity);
}

/** Model-side section of `GET /api/stats/frustration`. */
export async function getModelSideDashboardStats(range?: string | null): Promise<ModelSideDashboardStats> {
	await initDb();
	const { cutoff, bucketMs } = getTimeRangeConfig(range);
	return {
		overall: getModelSideOverall(cutoff),
		byModel: mergeModelSideRows(getModelSideByModel(cutoff)),
		series: getModelSideTimeSeries({ cutoff, bucketMs }),
		bySession: getModelSideBySession(cutoff, SESSION_LIMIT),
	};
}
