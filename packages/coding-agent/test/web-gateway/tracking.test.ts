/**
 * Gateway tracking contract — `GET /api/tracking` mirrors the
 * `<project>/.zeta/tracking/` file layout (status.json, INDEX.md,
 * actions.jsonl, sessions/*.md) and `GET /api/tracking/events` pushes a
 * `{ type: "tracking_changed" }` SSE notification after a file write.
 *
 * The SSE test drives the handler through a real Bun.serve listener + fetch
 * (the production path): a direct ReadableStream reader drops post-start
 * async enqueues under bun test (Bun quirk), while the HTTP layer delivers
 * them correctly — which is what the gateway runs in production.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleGetTracking, handleTrackingEvents } from "../../src/server/web-gateway/tracking";

const cleanups: Array<() => Promise<void>> = [];

async function makeTrackingProject(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "zeta-tracking-gw-"));
	cleanups.push(() => rm(cwd, { recursive: true, force: true }));
	const trackingDir = join(cwd, ".zeta", "tracking");
	await mkdir(join(trackingDir, "sessions"), { recursive: true });
	return cwd;
}

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("GET /api/tracking", () => {
	test("returns empty-state fields for a fresh project", async () => {
		const cwd = await makeTrackingProject();
		const res = await handleGetTracking(new Request(`http://127.0.0.1/api/tracking?cwd=${encodeURIComponent(cwd)}`));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.index).toBeNull();
		expect(body.status).toBeNull();
		expect(body.actions).toEqual([]);
		expect(body.sessions).toEqual([]);
		expect(typeof body.updatedAt).toBe("string");
	});

	test("mirrors the tracking file layout", async () => {
		const cwd = await makeTrackingProject();
		const trackingDir = join(cwd, ".zeta", "tracking");
		await writeFile(
			join(trackingDir, "status.json"),
			JSON.stringify({
				phase: "impl",
				progress: "60%",
				blockers: ["ci-red"],
				decisions: ["keep-omp-web-off"],
				lastUpdated: "2026-09-08T00:00:00.000Z",
			}),
			"utf8",
		);
		await writeFile(join(trackingDir, "INDEX.md"), "# Plan index\n\n- item one\n");
		await writeFile(
			join(trackingDir, "actions.jsonl"),
			[
				JSON.stringify({ timestamp: "2026-09-08T00:01:00.000Z", action: "update_status", detail: "60%" }),
				"not-json",
				JSON.stringify({ timestamp: "2026-09-08T00:02:00.000Z", action: "log_action" }),
			].join("\n"),
			"utf8",
		);
		await writeFile(join(trackingDir, "sessions", "PLAN-1.md"), "## Session plan\n");

		const res = await handleGetTracking(new Request(`http://127.0.0.1/api/tracking?cwd=${encodeURIComponent(cwd)}`));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			index: string | null;
			status: { phase: string; blockers: string[] } | null;
			actions: Array<{ action: string; detail?: string }>;
			sessions: Array<{ name: string; content: string }>;
		};
		expect(body.index).toContain("# Plan index");
		expect(body.status?.phase).toBe("impl");
		expect(body.status?.blockers).toEqual(["ci-red"]);
		// malformed lines are skipped, not fatal
		expect(body.actions).toHaveLength(2);
		expect(body.actions[0]?.detail).toBe("60%");
		expect(body.sessions).toEqual([{ name: "PLAN-1.md", content: "## Session plan\n" }]);
	});
});

describe("GET /api/tracking/events (SSE via real HTTP)", () => {
	test("pushes tracking_changed after a tracking file write", async () => {
		const cwd = await makeTrackingProject();
		const trackingDir = join(cwd, ".zeta", "tracking");
		const server = Bun.serve({
			port: 0,
			fetch: req =>
				handleTrackingEvents(
					new Request(`http://127.0.0.1${new URL(req.url).pathname}?cwd=${encodeURIComponent(cwd)}`),
				),
		});
		cleanups.push(() => server.stop(true));

		const res = await fetch(`http://127.0.0.1:${server.port}/api/tracking/events`);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");

		// Split the SSE stream into frames as they arrive.
		const frames: string[] = [];
		const pending: Array<Promise<void>> = [];
		const pump = (async () => {
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const idx = buffer.lastIndexOf("\n\n");
					if (idx >= 0) {
						for (const frame of buffer.slice(0, idx).split("\n\n")) {
							const trimmed = frame.trim();
							if (trimmed) frames.push(trimmed);
						}
						buffer = buffer.slice(idx + 2);
					}
				}
			} catch {
				// stream cancelled at teardown
			}
		})();
		pending.push(pump);

		const waitFor = async (needle: string, windowMs: number): Promise<boolean> => {
			const t0 = Date.now();
			while (Date.now() - t0 < windowMs) {
				if (frames.some(frame => frame.includes(needle))) return true;
				await new Promise(resolve => setTimeout(resolve, 50));
			}
			return frames.some(frame => frame.includes(needle));
		};

		try {
			expect(await waitFor('"type":"connected"', 3000)).toBe(true);
			await writeFile(join(trackingDir, "INDEX.md"), "# written after subscribe\n");
			expect(await waitFor('"type":"tracking_changed"', 3000)).toBe(true);
		} finally {
			server.stop(true);
			await Promise.allSettled(pending);
		}
	});
});
