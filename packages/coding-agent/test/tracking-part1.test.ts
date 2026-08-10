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
		expect(tool.label).toBe("Tracking Update");
		expect(tool.summary).toBe("Update project tracking documents (status, index, actions, plans)");
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
		expect(trackingIndex).toContain(cwd);
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
