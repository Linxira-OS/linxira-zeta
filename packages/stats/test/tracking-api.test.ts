/**
 * Narrow consumer tests for `/api/tracking` and the bounded snapshot reader.
 * They exercise real files on disk (no mocks) and assert the read path never
 * writes; run them in the dedicated CI window, not during an editor build.
 */
import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectTrackingDir } from "@linxiraos/pi-utils";
import { closeDb, initDb, insertMessageStats } from "../src/db";
import { handleApi } from "../src/server";
import { isTrackableProject, readTrackingSnapshot, TRACKING_READ_LIMITS } from "../src/tracking";
import type { MessageStatsInput } from "../src/types";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@pi-stats-tracking-");

const roots: string[] = [];

function project(name: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), `zeta-tracking-${name}-`));
	roots.push(root);
	return root;
}

function trackingDir(projectDir: string): string {
	const dir = getProjectTrackingDir(projectDir);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function writeTracking(projectDir: string, files: Record<string, string | Buffer>): void {
	const dir = trackingDir(projectDir);
	for (const [name, content] of Object.entries(files)) {
		const filePath = path.join(dir, name);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
}

function diskState(dir: string): unknown {
	const out: Record<string, { size: number; mtimeMs: number; body: string }> = {};
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		const filePath = path.join(entry.parentPath, entry.name);
		const stat = fs.statSync(filePath);
		out[path.relative(dir, filePath)] = {
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			body: fs.readFileSync(filePath).toString("base64"),
		};
	}
	return out;
}

function action(timestamp: string, name: string): string {
	return `${JSON.stringify({ timestamp, action: name })}\n`;
}

function message(folder: string, sessionFile: string, entryId: string): MessageStatsInput {
	return {
		sessionFile,
		entryId,
		folder,
		model: "gpt-5.4",
		provider: "openai-codex",
		api: "openai-codex-responses",
		timestamp: Date.now(),
		duration: 1_000,
		ttft: 100,
		stopReason: "stop",
		errorMessage: null,
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
		agentType: "main",
	};
}

afterAll(() => {
	closeDb();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("tracking snapshot reader", () => {
	it("reports a project with no tracking directory as missing, not empty", async () => {
		const dir = project("missing");
		const snapshot = await readTrackingSnapshot(dir);
		expect(snapshot.exists).toBe(false);
		expect(snapshot.updatedAt).toBeNull();
		expect(snapshot.status.state).toBe("missing");
		expect(snapshot.index.state).toBe("missing");
		expect(snapshot.actions.state).toBe("missing");
		expect(snapshot.sessionsState).toBe("missing");
		expect(fs.existsSync(getProjectTrackingDir(dir))).toBe(false);
	});

	it("reads status, index, actions oldest-first and sessions without writing", async () => {
		const dir = project("present");
		writeTracking(dir, {
			"status.json": JSON.stringify({
				phase: "implementation",
				progress: "50%",
				blockers: ["CI"],
				decisions: ["sqlite"],
				lastUpdated: "2026-11-11T00:00:00Z",
				stage: "coding",
				phases: [{ name: "coding", status: "active" }],
				lastSessionId: "s1",
			}),
			"INDEX.md": "# Index\n- item\n",
			"actions.jsonl": action("2026-11-09T00:00:00Z", "legacy"),
			"actions.2026-11-10.jsonl.log": action("2026-11-10T00:00:00Z", "rotated-0"),
			"actions.2026-11-10.jsonl.log.1": action("2026-11-10T01:00:00Z", "rotated-1"),
			"sessions/plan.md": "# Plan\n",
		});
		const before = diskState(dir);
		const snapshot = await readTrackingSnapshot(dir);
		const after = diskState(dir);

		expect(snapshot.exists).toBe(true);
		expect(snapshot.updatedAt).not.toBeNull();
		expect(snapshot.status.state).toBe("present");
		expect(snapshot.status.value?.phase).toBe("implementation");
		expect(snapshot.index.state).toBe("present");
		expect(snapshot.index.content).toContain("# Index");
		expect(snapshot.actions.state).toBe("present");
		expect(snapshot.actions.rows.map(row => row.action)).toEqual(["legacy", "rotated-0", "rotated-1"]);
		expect(snapshot.sessionsState).toBe("present");
		expect(snapshot.sessions.map(session => session.name)).toEqual(["plan.md"]);
		expect(snapshot.sessions[0]?.content).toContain("# Plan");
		expect(after).toEqual(before);
	});

	it("reports corrupt JSON and malformed action rows truthfully", async () => {
		const dir = project("corrupt");
		writeTracking(dir, {
			"status.json": '{"phase":',
			"actions.jsonl": `not-json\n${JSON.stringify({ timestamp: "2026-11-10T00:00:00Z", action: "ok" })}\n`,
		});
		const snapshot = await readTrackingSnapshot(dir);
		expect(snapshot.status.state).toBe("corrupt");
		expect(snapshot.status.value).toBeNull();
		expect(snapshot.actions.state).toBe("partial");
		expect(snapshot.actions.invalidRows).toBe(1);
		expect(snapshot.actions.rows.map(row => row.action)).toEqual(["ok"]);
	});

	it("bounds status/index/session/action reads and marks truncation", async () => {
		const dir = project("bounded");
		const big = (bytes: number): string => "x".repeat(bytes);
		writeTracking(dir, {
			"status.json": big(TRACKING_READ_LIMITS.statusBytes + 10),
			"INDEX.md": big(TRACKING_READ_LIMITS.indexBytes + 10),
			"sessions/big.md": big(TRACKING_READ_LIMITS.sessionBytes + 10),
			"actions.2026-11-10.jsonl.log": Array.from({ length: 40_000 }, (_, i) =>
				JSON.stringify({ timestamp: String(i), action: `a${i}` }),
			).join("\n"),
		});
		const snapshot = await readTrackingSnapshot(dir);
		expect(snapshot.status.truncated).toBe(true);
		expect(snapshot.status.state).toBe("partial");
		expect(snapshot.index.truncated).toBe(true);
		expect(snapshot.index.state).toBe("partial");
		expect(snapshot.index.content?.length).toBeLessThanOrEqual(TRACKING_READ_LIMITS.indexBytes);
		expect(snapshot.sessions[0]?.truncated).toBe(true);
		expect(snapshot.sessions[0]?.content?.length).toBeLessThanOrEqual(TRACKING_READ_LIMITS.sessionBytes);
		expect(snapshot.actions.truncated).toBe(true);
		expect(snapshot.actions.rows.length).toBeGreaterThan(0);
	});

	it("keeps two projects' snapshots independent", async () => {
		const a = project("a");
		const b = project("b");
		writeTracking(a, {
			"status.json": JSON.stringify({ phase: "alpha", progress: "1", blockers: [], decisions: [], lastUpdated: "" }),
		});
		writeTracking(b, {
			"status.json": JSON.stringify({ phase: "beta", progress: "2", blockers: [], decisions: [], lastUpdated: "" }),
		});
		expect((await readTrackingSnapshot(a)).status.value?.phase).toBe("alpha");
		expect((await readTrackingSnapshot(b)).status.value?.phase).toBe("beta");
	});

	it("rejects traversal and non-registry paths before any read", () => {
		const known = project("known");
		expect(isTrackableProject(known, [known])).toBe(true);
		expect(isTrackableProject(path.join(known, "..", "other"), [known])).toBe(false);
		expect(isTrackableProject("../other", [known])).toBe(false);
		expect(isTrackableProject("/etc", [known])).toBe(false);
	});
});

describe("GET /api/tracking", () => {
	it("serves a snapshot only for a project in the stats registry and never writes", async () => {
		await initDb();
		const known = project("api-known");
		const other = project("api-other");
		// Stats folder labels are encoded session-dir names, not paths. The
		// session header is the authoritative cwd the API must resolve.
		const label = `-encoded-${path.basename(known)}`;
		const sessionFile = path.join(known, "session.jsonl");
		fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", cwd: known })}\n`);
		writeTracking(known, {
			"status.json": JSON.stringify({
				phase: "api-phase",
				progress: "9",
				blockers: [],
				decisions: [],
				lastUpdated: "",
			}),
			"INDEX.md": "# API Index\n",
		});
		insertMessageStats([message(label, sessionFile, "known-1")]);
		const before = diskState(known);

		const list = await handleApi(new Request("http://127.0.0.1/api/tracking/projects"));
		expect(list.status).toBe(200);
		expect(((await list.json()) as { projects: string[] }).projects).toContain(label);

		const ok = await handleApi(new Request(`http://127.0.0.1/api/tracking?project=${encodeURIComponent(label)}`));
		expect(ok.status).toBe(200);
		const snapshot = (await ok.json()) as {
			project: string;
			trackingDir: string;
			status: { value: { phase: string } };
		};
		expect(snapshot.project).toBe(label);
		expect(snapshot.trackingDir).toBe(getProjectTrackingDir(known));
		expect(snapshot.status.value.phase).toBe("api-phase");

		const unknown = await handleApi(
			new Request(`http://127.0.0.1/api/tracking?project=${encodeURIComponent(other)}`),
		);
		expect(unknown.status).toBe(404);
		const traversal = await handleApi(
			new Request(`http://127.0.0.1/api/tracking?project=${encodeURIComponent(`../${path.basename(known)}`)}`),
		);
		expect(traversal.status).toBe(404);
		const missing = await handleApi(new Request("http://127.0.0.1/api/tracking"));
		expect(missing.status).toBe(400);

		expect(diskState(known)).toEqual(before);
	});
});
