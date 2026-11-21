/**
 * Opening the standalone stats dashboard from the shell (client side).
 *
 * The dashboard (`@linxiraos/pi-stats`) is a SEPARATE service on its own origin
 * (default `http://127.0.0.1:3847`, started by `zetacode stats` or by
 * `zetacode serve`). It is deliberately not a dock panel any more: its data is
 * cross-session (costs, models, providers, tools, frustration judge, gain,
 * timeseries, session traces) while the dock's own context ring reports a single
 * live session — two different jobs, and stacking them in one rail only made the
 * "statistics" entry ambiguous. The shell therefore keeps the capability as an
 * action entry (command palette + the sidebar's today-usage line) that opens the
 * dashboard in its own tab.
 *
 * URL resolution: `GET /api/webui/stats-url`, the same route the removed iframe
 * pane used, which resolves `NEXT_PUBLIC_STATS_URL` with the documented default
 * as a fallback. Before opening, the origin is probed so a stopped service
 * surfaces as a message naming the command instead of a dead browser tab.
 */

/** Reachability probe budget: enough for a loopback handshake, short enough to feel immediate. */
const PROBE_TIMEOUT_MS = 1_500;

export interface OpenStatsResult {
	/** true when the dashboard answered and the tab was opened. */
	ok: boolean;
	/** Resolved dashboard origin; null when even the URL could not be read. */
	url: string | null;
}

/** `GET /api/webui/stats-url` → the dashboard origin, or null if the route fails. */
async function resolveStatsUrl(): Promise<string | null> {
	try {
		const response = await fetch("/api/webui/stats-url", { cache: "no-store" });
		if (!response.ok) return null;
		const body: unknown = await response.json();
		if (!body || typeof body !== "object") return null;
		const url = (body as Record<string, unknown>).url;
		return typeof url === "string" && url.trim() !== "" ? url : null;
	} catch {
		return null;
	}
}

/** no-cors reachability probe: the response stays opaque, only refusal/timeout rejects. */
async function isReachable(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Open the standalone stats dashboard in a new tab.
 *
 * Returns `{ ok: false, url }` when the origin is known but nothing is listening,
 * so the caller can name the start command; `{ ok: false, url: null }` when the
 * origin could not even be resolved.
 */
export async function openStandaloneStats(): Promise<OpenStatsResult> {
	const url = await resolveStatsUrl();
	if (!url) return { ok: false, url: null };
	if (!(await isReachable(url))) return { ok: false, url };
	window.open(url, "_blank", "noopener,noreferrer");
	return { ok: true, url };
}
