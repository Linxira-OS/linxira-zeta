/**
 * TrackingTool unit tests (part 1) — update_status, update_index, and metadata.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TextContent } from "@linxiraos/pi-ai";
import { setAgentDir } from "@linxiraos/pi-utils";
import { Snowflake } from "@linxiraos/pi-utils/snowflake";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { TrackingTool } from "@linxiraos/zeta/tools/tracking";
import { readTrackingActionRows } from "@linxiraos/zeta/tools/tracking-actions-log";

function createMockSession(cwd: string): ToolSession {
	return { cwd, hasUI: false } as ToolSession;
}

describe("TrackingTool (part 1)", () => {
	let tempDir = "";
	let agentDir = "";

	beforeAll(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `zeta-tracking-1-${Snowflake.next()}-`));
		agentDir = path.join(tempDir, "agent");
		await fs.mkdir(agentDir, { recursive: true });
		setAgentDir(agentDir);
	});

	afterAll(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("has the correct tool name and properties", () => {
		const tool = new TrackingTool(createMockSession(tempDir));
		expect(tool.name).toBe("tracking_update");
		// label/summary 是本地化文案（`M.toolTrackingLabel` / `M.toolTrackingSummary`，见 src/tools/tracking.ts:469,478），
		// 语言由 `src/i18n/index.ts` 的优先级决定（配置 > ZETA_LANG > LC_* > LANG > 系统语言），
		// 所以断言英文字面量会随机器语言红/绿 —— 这里不做文案断言；键的完整性由
		// `src/i18n/messages.test.ts` 的 "catalogue completeness" 守卫。
	});

	it("update_status: creates status.json with all fields", async () => {
		const cwd = path.join(tempDir, "p1");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const result = await tool.execute("t1", {
			op: "update_status",
			phase: "implementation",
			progress: "50%",
			blockers: ["CI failing"],
			decisions: ["Use sqlite"],
		});

		expect(result.isError).toBeFalsy();
		expect((result.content[0] as TextContent).text).toContain("Status updated");

		const status = await Bun.file(path.join(cwd, ".zeta", "tracking", "status.json")).json();
		expect(status.phase).toBe("implementation");
		expect(status.progress).toBe("50%");
		expect(status.blockers).toEqual(["CI failing"]);
		expect(status.decisions).toEqual(["Use sqlite"]);
		expect(status.lastUpdated).toBeDefined();
	});

	it("update_status: preserves existing fields and deduplicates decisions", async () => {
		const cwd = path.join(tempDir, "p2");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		await tool.execute("t1", { op: "update_status", phase: "planning", progress: "10%", decisions: ["A", "B"] });
		await tool.execute("t2", { op: "update_status", progress: "20%", decisions: ["B", "C"] });

		const status = await Bun.file(path.join(cwd, ".zeta", "tracking", "status.json")).json();
		expect(status.phase).toBe("planning");
		expect(status.progress).toBe("20%");
		expect(status.decisions).toEqual(["A", "B", "C"]);
	});

	it("update_index: writes content and updates tracking index", async () => {
		const cwd = path.join(tempDir, "p3");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const content = "# Index\n- Phase: planning";
		const result = await tool.execute("t1", { op: "update_index", content });

		expect(result.isError).toBeFalsy();
		expect((result.content[0] as TextContent).text).toContain("INDEX.md updated");

		const written = await Bun.file(path.join(cwd, ".zeta", "tracking", "INDEX.md")).text();
		expect(written.trim()).toBe(content);

		const trackingIndex = await Bun.file(path.join(agentDir, "tracking-index.json")).json();
		// v2: object rows keyed by project path (v1 bare strings are migrated
		// on first write).
		const entry = trackingIndex.find((row: { path?: string } | string) =>
			typeof row === "string" ? row === cwd : row.path === cwd,
		);
		expect(entry).toBeDefined();
		expect(entry.name).toBe(path.basename(cwd));
		expect(entry.lastActiveSessionId).toBeNull();
	});

	it("sync_todo: mirrors phases into status.json and logs phase_complete on stage advance", async () => {
		const cwd = path.join(tempDir, "p3b");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const first = await tool.execute("t1", {
			op: "sync_todo",
			current_phase: "setup",
			phases: ["setup", "implement", "verify"],
		});
		expect(first.isError).toBeFalsy();

		const second = await tool.execute("t2", {
			op: "sync_todo",
			current_phase: "implement",
			phases: ["setup", "implement", "verify"],
		});
		expect(second.isError).toBeFalsy();

		const status = await Bun.file(path.join(cwd, ".zeta", "tracking", "status.json")).json();
		expect(status.stage).toBe("implement");
		expect(status.phases).toEqual([
			{ name: "setup", status: "completed" },
			{ name: "implement", status: "in_progress" },
			{ name: "verify", status: "pending" },
		]);

		const actions = (await readTrackingActionRows(path.join(cwd, ".zeta", "tracking"))).map(
			line => JSON.parse(line) as { action: string; detail?: string },
		);
		const phaseComplete = actions.filter(entry => entry.action === "phase_complete");
		expect(phaseComplete).toHaveLength(1);
		expect(phaseComplete[0]!.detail).toBe("setup");
	});

	it("update_status: two interleaved writers keep both updates", async () => {
		const cwd = path.join(tempDir, "p5");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		// Both calls read-modify-write the same status.json: without the lease the
		// later write is built on a stale read and drops the earlier field.
		const [first, second] = await Promise.all([
			tool.execute("t1", { op: "update_status", progress: "writer-A" }),
			tool.execute("t2", { op: "update_status", blockers: ["writer-B"] }),
		]);
		expect(first.isError).toBeFalsy();
		expect(second.isError).toBeFalsy();

		const status = await Bun.file(path.join(cwd, ".zeta", "tracking", "status.json")).json();
		expect(status.progress).toBe("writer-A");
		expect(status.blockers).toEqual(["writer-B"]);
	});

	it("update_status: concurrent writes to two projects both land in the global index", async () => {
		const cwdA = path.join(tempDir, "p6a");
		const cwdB = path.join(tempDir, "p6b");
		await Promise.all([fs.mkdir(cwdA, { recursive: true }), fs.mkdir(cwdB, { recursive: true })]);

		await Promise.all([
			new TrackingTool(createMockSession(cwdA)).execute("t1", { op: "update_index", content: "# A" }),
			new TrackingTool(createMockSession(cwdB)).execute("t2", { op: "update_index", content: "# B" }),
		]);

		const rows: { path: string }[] = await Bun.file(path.join(agentDir, "tracking-index.json")).json();
		const paths = rows.map(row => row.path);
		expect(paths).toContain(cwdA);
		expect(paths).toContain(cwdB);
	});

	it("update_index: throws when content is missing", async () => {
		const cwd = path.join(tempDir, "p4");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const result = await tool.execute("t1", { op: "update_index" } as any);
		expect(result.isError).toBe(true);
		expect((result.content[0] as TextContent).text).toContain("content is required");
	});
});
