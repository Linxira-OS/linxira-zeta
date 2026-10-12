/**
 * Web Gateway — project tracking handlers.
 *
 * Serves the tracking family for the web-ui TrackingPanel: a point-in-time
 * read of `<project>/.zeta/tracking/` and an SSE stream that pushes a
 * lightweight `{ type: "tracking_changed" }` notification when any file in
 * that directory changes (client then re-fetches details — keeps the payload
 * off the wire for large INDEX.md files).
 *
 * The tracking files remain the source of truth (written by the
 * `tracking_update` tool); the gateway only reads and watches.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { getProjectTrackingDir } from "@linxiraos/pi-utils";
import { readTrackingActionRows, trackingActionLogFiles } from "../../tools/tracking-actions-log";

interface TrackingStatus {
	phase: string;
	progress: string;
	blockers: string[];
	decisions: string[];
	lastUpdated: string;
	/** Current todo phase name (Tracking v2 sync_todo). */
	stage?: string;
	/** Ordered todo-phase mirror (Tracking v2 sync_todo). */
	phases?: { name: string; status: string }[];
	/** Session that last wrote tracking state. */
	lastSessionId?: string | null;
}

interface TrackingAction {
	timestamp: string;
	action: string;
	detail?: string;
}

export interface TrackingData {
	index: string | null;
	status: TrackingStatus | null;
	actions: TrackingAction[];
	sessions: { name: string; content: string }[];
	/** Compaction summaries (`summaries/compaction-*.md`), newest first. */
	summaries: { name: string; content: string }[];
	/** Mirrored approved plans (`plans/*-plan.md`), newest first. */
	plans: { name: string; content: string }[];
	/**
	 * Newest mtime among the tracked files, as ISO — content-derived, so two
	 * reads of unchanged files report the same instant. `""` when the project
	 * has no tracking files yet.
	 */
	updatedAt: string;
}

/** Debounce window coalescing rapid write bursts into one notification. */
const WATCH_DEBOUNCE_MS = 100;
const STATUS_FILE = "status.json";
const INDEX_FILE = "INDEX.md";
const SESSIONS_DIR = "sessions";
const SUMMARIES_DIR = "summaries";
const PLANS_DIR = "plans";

function readIndex(trackingDir: string): string | null {
	try {
		return fs.readFileSync(path.join(trackingDir, INDEX_FILE), "utf8");
	} catch {
		return null;
	}
}

function readStatus(trackingDir: string): TrackingStatus | null {
	try {
		const raw = JSON.parse(
			fs.readFileSync(path.join(trackingDir, STATUS_FILE), "utf8"),
		) as Partial<TrackingStatus> | null;
		if (!raw || typeof raw !== "object") return null;
		const phaseRows: unknown = raw.phases;
		const phases = Array.isArray(phaseRows)
			? phaseRows.flatMap(row => {
					if (!row || typeof row !== "object") return [];
					if (!("name" in row) || !("status" in row)) return [];
					if (typeof row.name !== "string" || typeof row.status !== "string") return [];
					return [{ name: row.name, status: row.status }];
				})
			: undefined;
		return {
			phase: String(raw.phase ?? ""),
			progress: String(raw.progress ?? ""),
			blockers: Array.isArray(raw.blockers) ? raw.blockers.map(String) : [],
			decisions: Array.isArray(raw.decisions) ? raw.decisions.map(String) : [],
			lastUpdated: String(raw.lastUpdated ?? ""),
			...(typeof raw.stage === "string" && raw.stage !== "" ? { stage: raw.stage } : {}),
			...(phases && phases.length > 0 ? { phases } : {}),
			...(typeof raw.lastSessionId === "string" || raw.lastSessionId === null
				? { lastSessionId: raw.lastSessionId }
				: {}),
		};
	} catch {
		return null;
	}
}

/**
 * Newest action rows from the rotated action log — a bounded tail read, so a
 * long-lived project never ships its whole history to the panel.
 */
async function readActions(trackingDir: string): Promise<TrackingAction[]> {
	const actions: TrackingAction[] = [];
	for (const line of await readTrackingActionRows(trackingDir)) {
		try {
			const parsed = JSON.parse(line) as Partial<TrackingAction>;
			actions.push({
				timestamp: String(parsed.timestamp ?? ""),
				action: String(parsed.action ?? ""),
				...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}),
			});
		} catch {
			// A malformed row must not hide the rest of the log.
		}
	}
	return actions;
}

/** Newest-first listing of a tracking subdirectory of markdown files. */
function readMarkdownDir(dir: string): { name: string; content: string; mtimeMs: number }[] {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter(entry => entry.isFile() && entry.name.endsWith(".md"))
			.map(entry => {
				const fullPath = path.join(dir, entry.name);
				try {
					return {
						name: entry.name,
						content: fs.readFileSync(fullPath, "utf8"),
						mtimeMs: fs.statSync(fullPath).mtimeMs,
					};
				} catch {
					return { name: entry.name, content: "", mtimeMs: 0 };
				}
			})
			.sort((a, b) => b.mtimeMs - a.mtimeMs);
	} catch {
		return [];
	}
}

/**
 * Freshness stamp for the whole payload: the newest mtime the gateway can see
 * among the files it serves (index, status, action log, session/summary/plan
 * markdown). Taking the request clock instead made every poll look like a
 * content change, which defeats change detection on the client.
 */
function deriveTrackingUpdatedAt(trackingDir: string, markdown: readonly { mtimeMs: number }[]): string {
	let newest = 0;
	for (const row of markdown) {
		if (row.mtimeMs > newest) newest = row.mtimeMs;
	}
	const candidates = [
		path.join(trackingDir, INDEX_FILE),
		path.join(trackingDir, STATUS_FILE),
		...trackingActionLogFiles(trackingDir),
	];
	for (const filePath of candidates) {
		try {
			const { mtimeMs } = fs.statSync(filePath);
			if (mtimeMs > newest) newest = mtimeMs;
		} catch {
			// A file the gateway serves is allowed to be absent.
		}
	}
	return newest > 0 ? new Date(newest).toISOString() : "";
}

export async function handleGetTracking(req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const cwd = url.searchParams.get("cwd")?.trim() || req.headers.get("x-zeta-cwd") || process.cwd();
		const trackingDir = getProjectTrackingDir(cwd);
		const sessions = readMarkdownDir(path.join(trackingDir, SESSIONS_DIR));
		const summaries = readMarkdownDir(path.join(trackingDir, SUMMARIES_DIR));
		const plans = readMarkdownDir(path.join(trackingDir, PLANS_DIR));
		const data: TrackingData = {
			index: readIndex(trackingDir),
			status: readStatus(trackingDir),
			actions: await readActions(trackingDir),
			sessions: sessions.map(({ name, content }) => ({ name, content })),
			summaries: summaries.map(({ name, content }) => ({ name, content })),
			plans: plans.map(({ name, content }) => ({ name, content })),
			updatedAt: deriveTrackingUpdatedAt(trackingDir, [...sessions, ...summaries, ...plans]),
		};
		return Response.json(data);
	} catch (error) {
		return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
	}
}

export async function handleTrackingEvents(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const cwd = url.searchParams.get("cwd")?.trim() || req.headers.get("x-zeta-cwd") || process.cwd();
	const trackingDir = getProjectTrackingDir(cwd);

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			let debounce: ReturnType<typeof setTimeout> | undefined;
			let watcher: fs.FSWatcher | undefined;

			const send = (data: unknown): void => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// controller already closed
				}
			};
			const notify = (): void => {
				clearTimeout(debounce);
				debounce = setTimeout(() => send({ type: "tracking_changed" }), WATCH_DEBOUNCE_MS);
			};

			// `connected` is enqueued synchronously (Bun's ReadableStream under
			// bun test drops enqueues from post-start microtasks — probed empirically).
			// The watcher attaches a microtask later; a write in that sub-millisecond
			// window would be missed by the stream, but the client's mount-time
			// fetch covers the initial state and the manual refresh stays as the
			// fallback, so this is a tolerable lost-update window, not a correctness
			// hole for steady-state sync.
			send({ type: "connected" });

			// Recursive watch on the tracking directory; missing dir is fine —
			// the agent creates it lazily on the first tracking_update call, and
			// the client's next full read reports the (still empty) state.
			fsp.mkdir(trackingDir, { recursive: true })
				.catch(() => {
					// unreadable dir: no live updates; client polling/fetch still works
				})
				.then(() => {
					if (closed) return;
					try {
						watcher = fs.watch(trackingDir, { recursive: true }, notify);
					} catch {
						// unwatchable (platform limits); polling/fetch still works
					}
				});

			const heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(":\n\n"));
				} catch {
					// controller already closed
				}
			}, 30_000);

			const cleanup = (): void => {
				if (closed) return;
				closed = true;
				clearTimeout(debounce);
				watcher?.close();
				clearInterval(heartbeat);
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			req.signal?.addEventListener("abort", cleanup);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
