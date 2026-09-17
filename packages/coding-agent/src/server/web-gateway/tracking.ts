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

interface TrackingStatus {
	phase: string;
	progress: string;
	blockers: string[];
	decisions: string[];
	lastUpdated: string;
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
	updatedAt: string;
}

/** Debounce window coalescing rapid write bursts into one notification. */
const WATCH_DEBOUNCE_MS = 100;

function readIndex(trackingDir: string): string | null {
	try {
		return fs.readFileSync(path.join(trackingDir, "INDEX.md"), "utf8");
	} catch {
		return null;
	}
}

function readStatus(trackingDir: string): TrackingStatus | null {
	try {
		const raw = JSON.parse(
			fs.readFileSync(path.join(trackingDir, "status.json"), "utf8"),
		) as Partial<TrackingStatus> | null;
		if (!raw || typeof raw !== "object") return null;
		return {
			phase: String(raw.phase ?? ""),
			progress: String(raw.progress ?? ""),
			blockers: Array.isArray(raw.blockers) ? raw.blockers.map(String) : [],
			decisions: Array.isArray(raw.decisions) ? raw.decisions.map(String) : [],
			lastUpdated: String(raw.lastUpdated ?? ""),
		};
	} catch {
		return null;
	}
}

function readActions(trackingDir: string): TrackingAction[] {
	try {
		const raw = fs.readFileSync(path.join(trackingDir, "actions.jsonl"), "utf8");
		return raw
			.split("\n")
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				try {
					const parsed = JSON.parse(line) as Partial<TrackingAction>;
					return {
						timestamp: String(parsed.timestamp ?? ""),
						action: String(parsed.action ?? ""),
						...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}),
					};
				} catch {
					return null;
				}
			})
			.filter((a): a is TrackingAction => a !== null);
	} catch {
		return [];
	}
}

function readSessions(trackingDir: string): { name: string; content: string }[] {
	const sessionsDir = path.join(trackingDir, "sessions");
	try {
		return fs
			.readdirSync(sessionsDir)
			.filter(name => name.endsWith(".md"))
			.map(name => {
				try {
					return { name, content: fs.readFileSync(path.join(sessionsDir, name), "utf8") };
				} catch {
					return { name, content: "" };
				}
			});
	} catch {
		return [];
	}
}

export async function handleGetTracking(req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const cwd = url.searchParams.get("cwd")?.trim() || req.headers.get("x-zeta-cwd") || process.cwd();
		const trackingDir = getProjectTrackingDir(cwd);
		const data: TrackingData = {
			index: readIndex(trackingDir),
			status: readStatus(trackingDir),
			actions: readActions(trackingDir),
			sessions: readSessions(trackingDir),
			updatedAt: new Date().toISOString(),
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
