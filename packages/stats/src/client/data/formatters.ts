import { getLocale, t } from "../i18n";
import type { MessageStats } from "../types";

/**
 * One locale drives every number and date, and it is the *product's* — the
 * host CLI's language injected into the page, not the browser's. Mixing
 * conventions (e.g. `1,4 Mr` beside `97.0%` on a tr-TR browser) stays
 * impossible; the difference from the pre-i18n build is only that a `zh-CN`
 * dashboard now formats in `zh-CN` throughout.
 */
function numberLocale(): string {
	return getLocale();
}

export function formatInteger(value: number): string {
	return value.toLocaleString(numberLocale());
}

export function formatCompact(value: number): string {
	return value.toLocaleString(numberLocale(), { notation: "compact" });
}

export function formatCost(value: number, digits?: number): string {
	if (value === 0) return "$0";
	const fractionDigits = digits !== undefined ? digits : value > 0 && value < 0.01 ? 4 : 2;
	return `$${value.toLocaleString(numberLocale(), {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	})}`;
}

/** Format an API-equivalent estimate, using N/A when all usage is unpriced. */
export function formatEstimatedCost(value: number, unpricedRequests: number, digits?: number): string {
	return value === 0 && unpricedRequests > 0 ? "N/A" : formatCost(value, digits);
}

/**
 * Whether one request's zero cost means unknown spend rather than free usage.
 * Mirrors the server's `unpricedRequestSql`: `xai-oauth` is billed through a
 * subscription, and `costUnpriced` marks a row the ingest path could not price
 * (a scheduled card with no recoverable request timestamp).
 */
export function isUnpricedMessage(message: Pick<MessageStats, "provider" | "usage" | "costUnpriced">): boolean {
	return (
		message.usage.totalTokens > 0 &&
		message.usage.cost.total === 0 &&
		(message.provider === "xai-oauth" || message.costUnpriced === true)
	);
}

/** Format one request's cost, distinguishing unpriced usage from free usage. */
export function formatMessageCost(
	message: Pick<MessageStats, "provider" | "usage" | "costUnpriced">,
	digits?: number,
): string {
	return formatEstimatedCost(message.usage.cost.total, isUnpricedMessage(message) ? 1 : 0, digits);
}

export function formatPercent(value: number, digits = 1): string {
	return `${(value * 100).toFixed(digits)}%`;
}

/** Show small nonzero failure rates without rounding them to zero. */
export function formatErrorRate(value: number): string {
	const percent = value * 100;
	if (percent > 0 && percent < 0.005) return "<0.01%";
	return formatPercent(value, percent > 0 && percent < 0.1 ? 2 : 1);
}

export function formatDurationMs(value: number | null, digits?: number): string {
	if (value === null) return "-";
	const sec = value / 1000;
	const d = digits !== undefined ? digits : sec < 1 ? 2 : 1;
	return `${sec.toFixed(d)}s`;
}

/** Wall-clock length: seconds below a minute, then `17m 41s` / `2h 05m`. */
export function formatElapsed(ms: number): string {
	if (ms < 60_000) return formatDurationMs(ms);
	const totalMin = Math.floor(ms / 60_000);
	if (totalMin < 60) return `${totalMin}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
	return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, "0")}m`;
}

export function formatTokensPerSecond(value: number | null): string {
	if (value === null) return "-";
	return value.toFixed(1);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	["second", 1_000],
	["minute", 60_000],
	["hour", 3_600_000],
	["day", 86_400_000],
	["month", 2_629_800_000],
	["year", 31_557_600_000],
];

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2 minutes ago" / "2 分钟前" — the ladder picks the largest unit the delta reaches. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	const locale = getLocale();
	let formatter = relativeFormatters.get(locale);
	if (!formatter) {
		formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
		relativeFormatters.set(locale, formatter);
	}
	const delta = timestamp - now;
	let unitIndex = 0;
	for (let i = 1; i < RELATIVE_UNITS.length; i++) {
		if (Math.abs(delta) >= RELATIVE_UNITS[i][1]) unitIndex = i;
	}
	const [unit, ms] = RELATIVE_UNITS[unitIndex];
	return formatter.format(Math.round(delta / ms), unit);
}

/** Local month/day plus minute ("Sep 28 14:03" / "9月28日 14:03") for chart range captions. */
export function formatDateTimeShort(timestamp: number): string {
	const locale = getLocale();
	const key = `${locale}:mdhm`;
	let formatter = dateFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		dateFormatters.set(key, formatter);
	}
	return formatter.format(timestamp);
}

/** Absolute local date and time to the second ("Sep 28, 14:03:22" / "9月28日 14:03:22"). */
export function formatTimestamp(timestamp: number): string {
	const locale = getLocale();
	let formatter = dateFormatters.get(locale);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		dateFormatters.set(locale, formatter);
	}
	return formatter.format(timestamp);
}

/** Project folder as stored by ingest (`/work-pi/`), without the slashes. */
export function formatFolder(folder: string): string {
	return folder.replace(/^\/+|\/+$/g, "") || t("common.root");
}

export function formatBytes(value: number): string {
	if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`;
	return `${value} B`;
}
