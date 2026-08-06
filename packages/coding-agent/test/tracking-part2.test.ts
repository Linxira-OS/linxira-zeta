/**
 * TrackingTool unit tests (part 2) — log_action, sync_plan, and error handling.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TextContent } from "@zeta/pi-ai";
import type { ToolSession } from "@zeta/pi-coding-agent/tools";
import { TrackingTool } from "@zeta/pi-coding-agent/tools/tracking";
import { setAgentDir } from "@zeta/pi-utils";
import { Snowflake } from "@zeta/pi-utils/snowflake";

function createMockSession(cwd: string): ToolSession {
	return { cwd, hasUI: false } as ToolSession;
}

describe("TrackingTool (part 2)", () => {
	let tempDir = "";
	let agentDir = "";

	beforeAll(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `zeta-tracking-2-${Snowflake.next()}-`));
		agentDir = path.join(tempDir, "agent");
		await fs.mkdir(agentDir, { recursive: true });
		setAgentDir(agentDir);
	});

	afterAll(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("log_action: appends entries to actions.jsonl", async () => {
		const cwd = path.join(tempDir, "p1");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		await tool.execute("t1", { op: "log_action", action: "git commit", detail: "Fixed CI" });
		await tool.execute("t2", { op: "log_action", action: "npm publish", detail: "v1.0.0" });

		const lines = (await Bun.file(path.join(cwd, ".zeta", "tracking", "actions.jsonl")).text()).trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).action).toBe("git commit");
		expect(JSON.parse(lines[0]).detail).toBe("Fixed CI");
		expect(JSON.parse(lines[0]).timestamp).toBeDefined();
		expect(JSON.parse(lines[1]).action).toBe("npm publish");
	});

	it("log_action: defaults to 'unknown' when action is missing", async () => {
		const cwd = path.join(tempDir, "p2");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		await tool.execute("t1", { op: "log_action" } as any);

		const entry = JSON.parse((await Bun.file(path.join(cwd, ".zeta", "tracking", "actions.jsonl")).text()).trim());
		expect(entry.action).toBe("unknown");
	});

	it("sync_plan: copies plan file to sessions directory", async () => {
		const cwd = path.join(tempDir, "p3");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const planContent = "# Plan\n1. Step one\n2. Step two";
		await Bun.write(path.join(tempDir, "plan.md"), planContent);

		const result = await tool.execute("t1", { op: "sync_plan", plan_path: path.join(tempDir, "plan.md") });
		expect(result.isError).toBeFalsy();
		expect((result.content[0] as TextContent).text).toContain("Plan synced");

		const written = await Bun.file(path.join(cwd, ".zeta", "tracking", "sessions", "plan.md")).text();
		expect(written.trim()).toBe(planContent.trim());
	});

	it("sync_plan: throws when plan_path is missing", async () => {
		const cwd = path.join(tempDir, "p4");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const result = await tool.execute("t1", { op: "sync_plan" } as any);
		expect(result.isError).toBe(true);
		expect((result.content[0] as TextContent).text).toContain("plan_path is required");
	});

	it("sync_plan: returns error for nonexistent plan file", async () => {
		const cwd = path.join(tempDir, "p5");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const result = await tool.execute("t1", { op: "sync_plan", plan_path: "/nonexistent/plan.md" });
		expect(result.isError).toBe(true);
		expect((result.content[0] as TextContent).text).toContain("Failed to read plan file");
	});

	it("returns error for unknown operation", async () => {
		const cwd = path.join(tempDir, "p6");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool(createMockSession(cwd));

		const result = await tool.execute("t1", { op: "unknown_op" } as any);
		expect(result.isError).toBe(true);
		expect((result.content[0] as TextContent).text).toContain("Unknown operation");
	});
});
