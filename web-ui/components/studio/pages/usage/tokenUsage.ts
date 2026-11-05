/**
 * Local-date helpers for the usage chart's x-axis.
 *
 * The bucket timestamps `/api/stats/timeseries` returns are epoch millis; the
 * axis prints the local calendar day, never the UTC one, so a token day lines
 * up with the day the operator experienced.
 */

/** `YYYY-MM-DD` in the browser's local time zone. */
export function localDateKey(ts: number): string {
	const date = new Date(ts);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}
