/**
 * D6 — memory is on by default only in the default workspace. The project layer
 * opts that directory into `mnemopi`; a temp repository keeps the user-layer
 * default `off`, exposes no `learn` tool, and writes nothing under the memories
 * root. The default workspace's writes land only in `memories/<encoded cwd>`.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMemoriesDir } from "@linxiraos/pi-utils";
import { Settings } from "../src/config/settings";
import { initializeDefaultWorkspace } from "../src/default-workspace";
import { getMemoryRoot, saveLearnedLesson } from "../src/memories";
import { resolveMemoryBackend } from "../src/memory-backend/resolve";
import { cfgMemoryBackend } from "../src/memory-backend/settings";
import { LearnTool } from "../src/tools/learn";
import type { ToolSession } from "../src/tools";

setDefaultTimeout(30_000);

describe("default workspace memory (D6)", () => {
	let workspace: string;
	let repo: string;
	let agentDir: string;

	beforeEach(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-memory-ws-"));
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-memory-repo-"));
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-memory-agent-"));
		await initializeDefaultWorkspace({ workspace });
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("default workspace resolves to mnemopi from its project layer", async () => {
		const settings = await Settings.loadReadOnly({ cwd: workspace, agentDir });
		expect(cfgMemoryBackend.get(settings)).toBe("mnemopi");
		expect(settings.getProvenance(cfgMemoryBackend)).toBe("project");
		expect((await resolveMemoryBackend(settings)).id).toBe("mnemopi");
	});

	test("memory writes land only under memories/<encoded default workspace cwd>", async () => {
		const settings = await Settings.loadReadOnly({ cwd: workspace, agentDir });
		expect(cfgMemoryBackend.get(settings)).toBe("mnemopi");

		await saveLearnedLesson(agentDir, workspace, {
			content: "Default-workspace-only lesson",
			context: "default-workspace-memory.test",
		});

		const workspaceRoot = getMemoryRoot(agentDir, workspace);
		expect(fs.readFileSync(path.join(workspaceRoot, "learned.md"), "utf8")).toContain(
			"Default-workspace-only lesson",
		);
		expect(fs.readdirSync(getMemoriesDir(agentDir))).toEqual([path.basename(workspaceRoot)]);
	});

	test("a temp repo stays off, has no learn tool, and writes no memory", async () => {
		// Even with auto-learn opted in for this repo, memory stays off because
		// `memory.backend` itself is not enabled there.
		fs.mkdirSync(path.join(repo, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(repo, ".zeta", "settings.json"),
			JSON.stringify({ autolearn: { enabled: true } }),
			"utf8",
		);

		const settings = await Settings.loadReadOnly({ cwd: repo, agentDir });
		expect(cfgMemoryBackend.get(settings)).toBe("off");
		expect(settings.getProvenance(cfgMemoryBackend)).toBe("default");

		const backend = await resolveMemoryBackend(settings);
		expect(backend.id).toBe("off");
		expect(await backend.buildDeveloperInstructions(agentDir, repo, settings)).toBeUndefined();
		expect(LearnTool.createIf({ settings, taskDepth: 0 } as ToolSession)).toBeNull();

		// No writes: no project memory root and no new entries under the memories root.
		expect(fs.existsSync(getMemoryRoot(agentDir, repo))).toBe(false);
		const memoriesDir = getMemoriesDir(agentDir);
		expect(fs.existsSync(memoriesDir) ? fs.readdirSync(memoriesDir) : []).toEqual([]);
	});
});
