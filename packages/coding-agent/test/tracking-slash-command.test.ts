/**
 * /tracking slash command tests — explicit activation surface for the project
 * tracking document system (tracking_update tool).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setAgentDir } from "@linxiraos/pi-utils";
import { Snowflake } from "@linxiraos/pi-utils/snowflake";
import { BUILTIN_ZETA_SLASH_COMMANDS } from "@linxiraos/zeta/slash-commands/builtin-zeta";
import type { ParsedSlashCommand, SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { TrackingTool } from "@linxiraos/zeta/tools/tracking";

function command(args: string): ParsedSlashCommand {
	return { name: "tracking", args, text: `/tracking ${args}`.trim() };
}

function mockRuntime(cwd: string, capture: { text: string }): SlashCommandRuntime {
	return {
		cwd,
		output: async (text: string) => {
			capture.text = text;
		},
	} as unknown as SlashCommandRuntime;
}

describe("/tracking slash command", () => {
	let tempDir = "";
	let agentDir = "";
	const trackingCmd = BUILTIN_ZETA_SLASH_COMMANDS.find(c => c.name === "tracking");

	beforeAll(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `zeta-tracking-cmd-${Snowflake.next()}-`));
		agentDir = path.join(tempDir, "agent");
		await fs.mkdir(agentDir, { recursive: true });
		setAgentDir(agentDir);
	});

	afterAll(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("is registered with i18n descriptions and subcommands", () => {
		expect(trackingCmd).toBeDefined();
		expect(trackingCmd!.description).toBeTruthy();
		expect(trackingCmd!.subcommands?.map(s => s.name)).toEqual(["status", "plan", "log", "index", "start"]);
	});

	it("status on an empty project reports no data and points at start", async () => {
		const cwd = path.join(tempDir, "empty");
		await fs.mkdir(cwd, { recursive: true });
		const capture = { text: "" };
		await trackingCmd!.handle!(command("status"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("状态文件不存在");
		expect(capture.text).toContain("/tracking start");
	});

	it("start prints guidance to maintain the tracking documents", async () => {
		const cwd = path.join(tempDir, "start");
		await fs.mkdir(cwd, { recursive: true });
		const capture = { text: "" };
		await trackingCmd!.handle!(command("start"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("开始维护项目追踪文档");
		expect(capture.text).toContain("tracking_update");
	});

	it("status reads a status.json written by tracking_update", async () => {
		const cwd = path.join(tempDir, "p1");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool({ cwd, hasUI: false } as ToolSession);
		await tool.execute("t1", {
			op: "update_status",
			phase: "implementation",
			progress: "50%",
			blockers: ["CI failing"],
			decisions: ["Use sqlite"],
		});

		const capture = { text: "" };
		await trackingCmd!.handle!(command("status"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("阶段: implementation");
		expect(capture.text).toContain("进度: 50%");
		expect(capture.text).toContain("CI failing");
	});

	it("log summarizes recent entries from actions.jsonl", async () => {
		const cwd = path.join(tempDir, "p2");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool({ cwd, hasUI: false } as ToolSession);
		await tool.execute("t2", { op: "log_action", action: "merged PR", detail: "#12" });

		const capture = { text: "" };
		await trackingCmd!.handle!(command("log"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("merged PR");
		expect(capture.text).toContain("1 条");
	});

	it("index shows INDEX.md written by update_index", async () => {
		const cwd = path.join(tempDir, "p3");
		await fs.mkdir(cwd, { recursive: true });
		const tool = new TrackingTool({ cwd, hasUI: false } as ToolSession);
		await tool.execute("t3", { op: "update_index", content: "# Project Index\n- module A done" });

		const capture = { text: "" };
		await trackingCmd!.handle!(command("index"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("Project Index");
	});

	it("plan lists synced plan files", async () => {
		const cwd = path.join(tempDir, "p4");
		await fs.mkdir(cwd, { recursive: true });
		const planFile = path.join(cwd, "docs", "plan.md");
		await fs.mkdir(path.join(cwd, "docs"), { recursive: true });
		await fs.writeFile(planFile, "# Plan");
		const tool = new TrackingTool({ cwd, hasUI: false } as ToolSession);
		await tool.execute("t4", { op: "sync_plan", plan_path: planFile });

		const capture = { text: "" };
		await trackingCmd!.handle!(command("plan"), mockRuntime(cwd, capture));
		expect(capture.text).toContain("plan.md");
	});
});
