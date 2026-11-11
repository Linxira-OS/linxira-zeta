/**
 * Latest-task projection for a session row.
 *
 * This is a deterministic read of the bounded session window, not an LLM
 * summary: it names the latest completed task by its user intent and the last
 * assistant result, or explicitly says the task is still open. It never reuses
 * `firstMessage`, a branch summary, or the latest IM inbound as if they were a
 * completed task summary. Rows written before this projection existed have no
 * dedicated field; readers see `undefined` and must not invent one.
 */
export type SessionTaskSummaryStatus = "completed" | "incomplete" | "unknown";

/**
 * Where the projection came from:
 * - `completed_turn`: the bounded window's last turn ended cleanly.
 * - `open_turn`: the last turn is pending/interrupted/aborted/errored; intent
 *   may exist but there is deliberately no result.
 * - `none`: no reliable bounded window.
 */
export type SessionTaskSummarySource = "completed_turn" | "open_turn" | "none";

export interface SessionTaskSummary {
	readonly status: SessionTaskSummaryStatus;
	/** Latest task's user intent, short single-line plain text. */
	readonly intent?: string;
	/** Last assistant result of that completed turn, short plain text. Absent while open. */
	readonly result?: string;
	/** ISO timestamp of the summarizing turn/record. */
	readonly at?: string;
	readonly source: SessionTaskSummarySource;
}

/** Intent excerpt cap; the UI renders one line. */
export const SESSION_TASK_INTENT_MAX_CHARS = 120;
/** Result excerpt cap; the UI renders one line. */
export const SESSION_TASK_RESULT_MAX_CHARS = 200;

/** One-line plain excerpt with an ellipsis when truncated. Empty text → undefined. */
export function excerptTaskText(value: unknown, maxChars: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const compact = value.replace(/\s+/g, " ").trim();
	if (!compact) return undefined;
	return compact.length > maxChars ? `${compact.slice(0, Math.max(1, maxChars - 1))}…` : compact;
}

/**
 * What a row should display as its task summary: the completed result, else the
 * open intent, else undefined (callers show “no summary”, never a fake one).
 */
export function sessionTaskSummaryText(summary: SessionTaskSummary | undefined): string | undefined {
	if (!summary) return undefined;
	if (summary.status === "completed") return summary.result ?? summary.intent;
	return summary.intent;
}

/** Validate a persisted/DTO projection; malformed shapes read as absent. */
export function normalizeSessionTaskSummary(value: unknown): SessionTaskSummary | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const status = record.status;
	const source = record.source;
	if (status !== "completed" && status !== "incomplete" && status !== "unknown") return undefined;
	if (source !== "completed_turn" && source !== "open_turn" && source !== "none") return undefined;
	const stringField = (key: string): string | undefined => {
		const field = record[key];
		return typeof field === "string" && field.trim() ? field : undefined;
	};
	const intent = stringField("intent");
	const result = stringField("result");
	const at = stringField("at");
	return {
		status,
		source,
		...(intent === undefined ? {} : { intent }),
		...(result === undefined ? {} : { result }),
		...(at === undefined ? {} : { at }),
	};
}
