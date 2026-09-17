import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeSyncWithRetries } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { ReadTool } from "@linxiraos/zeta/tools/read";

const LINE_COUNT = 500;

function writeNumberedFile(filePath: string, lines: number): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join("\n")}\n`);
}

function createSession(cwd: string, artifactsDir: string, planReferencePath: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "images.autoResize": false }),
		localProtocolOptions: {
			getArtifactsDir: () => artifactsDir,
			getSessionId: () => "test-session",
		},
		getPlanReferencePath: () => planReferencePath,
	};
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}

describe("read plan-aware default limit", () => {
	let testDir: string;
	let artifactsDir: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-plan-limit-"));
		artifactsDir = path.join(testDir, "artifacts");
		writeNumberedFile(path.join(artifactsDir, "local", "PLAN.md"), LINE_COUNT);
		writeNumberedFile(path.join(artifactsDir, "local", "my-task-plan.md"), LINE_COUNT);
		writeNumberedFile(path.join(testDir, "plain.md"), LINE_COUNT);
	});

	afterEach(() => {
		removeSyncWithRetries(testDir);
	});

	it("reads the canonical local://PLAN.md alias past the default window without an explicit selector", async () => {
		const tool = new ReadTool(createSession(testDir, artifactsDir, "local://PLAN.md"));
		const result = await tool.execute("read-plan", { path: "local://PLAN.md" });

		const text = textOf(result);
		expect(text).toContain("line 500");
		expect(result.details?.truncation).toBeUndefined();
	});

	it("reads the session plan reference path past the default window", async () => {
		const tool = new ReadTool(createSession(testDir, artifactsDir, "local://my-task-plan.md"));
		const result = await tool.execute("read-plan", { path: "local://my-task-plan.md" });

		expect(textOf(result)).toContain("line 500");
		expect(result.details?.truncation).toBeUndefined();
	});

	it("keeps an explicit selector window on plan files", async () => {
		const tool = new ReadTool(createSession(testDir, artifactsDir, "local://PLAN.md"));
		const result = await tool.execute("read-plan", { path: "local://PLAN.md:1-10" });

		const text = textOf(result);
		expect(text).toContain("line 10");
		expect(text).not.toContain("line 311");
	});

	it("applies the configured default limit to non-plan files", async () => {
		const tool = new ReadTool(createSession(testDir, artifactsDir, "local://PLAN.md"));
		const result = await tool.execute("read-plain", { path: path.join(testDir, "plain.md") });

		const text = textOf(result);
		// Truncated output elides the window interior (only the tail line is
		// echoed), so an intermediate line beyond the default window must be
		// absent and the truncation marker must be set.
		expect(text).not.toContain("line 400");
		expect(result.details?.truncation).toBeDefined();
	});
});
