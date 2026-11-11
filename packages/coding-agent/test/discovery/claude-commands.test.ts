import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { __resetDirsFromEnvForTests, removeWithRetries, setAgentDir } from "@linxiraos/pi-utils";
import { clearCache as clearFsCache } from "@linxiraos/zeta/capability/fs";
import { type SlashCommand, slashCommandCapability } from "@linxiraos/zeta/capability/slash-command";
import { setForeignProjectSourceConsent } from "@linxiraos/zeta/config/foreign-sources";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
import { loadCapability } from "@linxiraos/zeta/discovery";

const ORIGINAL_DIR_ENV = {
	ZETA_CODING_AGENT_DIR: process.env.ZETA_CODING_AGENT_DIR,
	PI_PROFILE: process.env.PI_PROFILE,
	OMP_PROFILE: process.env.OMP_PROFILE,
};

async function writeFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
}

describe("Claude Code slash command discovery", () => {
	let root = "";
	let home = "";
	let project = "";
	let agentDir = "";
	let originalHome: string | undefined;
	let originalClaudeConfigDir: string | undefined;

	beforeEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		originalHome = process.env.HOME;
		originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
		root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-claude-commands-"));
		home = path.join(root, "home");
		project = path.join(root, "project");
		agentDir = path.join(root, "agent");
		process.env.HOME = home;
		vi.spyOn(os, "homedir").mockReturnValue(home);
		await fs.mkdir(path.join(project, ".git"), { recursive: true });
		setAgentDir(agentDir);
	});

	afterEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		vi.restoreAllMocks();
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalClaudeConfigDir === undefined) {
			delete process.env.CLAUDE_CONFIG_DIR;
		} else {
			process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
		}
		for (const [key, value] of Object.entries(ORIGINAL_DIR_ENV)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		__resetDirsFromEnvForTests();
		await removeWithRetries(root);
	});

	function approveClaudeProjectSource(): void {
		setForeignProjectSourceConsent("claude", project, true, agentDir);
		clearFsCache();
	}

	test("loads subdirectory commands under both basename and namespace names", async () => {
		await writeFile(path.join(project, ".claude", "commands", "triage.md"), "Triage prompt\n");
		await writeFile(path.join(project, ".claude", "commands", "opsx", "apply.md"), "Apply prompt\n");
		await writeFile(path.join(home, ".claude", "commands", "team", "audit.md"), "Audit prompt\n");

		const unapproved = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: project,
			providers: ["claude"],
		});
		expect(unapproved.items.some(command => command.name === "triage")).toBe(false);
		expect(unapproved.items.some(command => command.name === "opsx:apply")).toBe(false);
		expect(unapproved.items.some(command => command.level === "project")).toBe(false);

		approveClaudeProjectSource();
		const result = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: project,
			providers: ["claude"],
		});
		const names = result.items.map(command => command.name);

		expect(result.warnings).toEqual([]);
		expect(names).toContain("triage");
		expect(names).toContain("apply");
		expect(names).toContain("opsx:apply");
		expect(names).toContain("audit");
		expect(names).toContain("team:audit");
	});

	test("loads user commands from CLAUDE_CONFIG_DIR instead of the legacy home", async () => {
		const relocated = path.join(root, "relocated-claude");
		process.env.CLAUDE_CONFIG_DIR = relocated;
		await writeFile(path.join(home, ".claude", "commands", "stale.md"), "Stale prompt\n");
		await writeFile(path.join(relocated, "commands", "active.md"), "Active prompt\n");

		const result = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: project,
			providers: ["claude"],
		});

		expect(result.warnings).toEqual([]);
		expect(result.items.find(command => command.name === "active")?.path).toBe(
			path.join(relocated, "commands", "active.md"),
		);
		expect(result.items.some(command => command.name === "stale")).toBe(false);
	});
	test("keeps root commands ahead of nested basename duplicates", async () => {
		const rootApply = path.join(project, ".claude", "commands", "apply.md");
		const nestedApply = path.join(project, ".claude", "commands", "agent", "apply.md");
		await writeFile(rootApply, "Root apply prompt\n");
		await writeFile(nestedApply, "Nested apply prompt\n");
		approveClaudeProjectSource();

		const result = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: project,
			providers: ["claude"],
		});
		const apply = result.items.find(command => command.name === "apply");
		const agentApply = result.items.find(command => command.name === "agent:apply");

		expect(result.warnings).toEqual([]);
		expect(apply?.path).toBe(rootApply);
		expect(apply?.content).toBe("Root apply prompt\n");
		expect(agentApply?.path).toBe(nestedApply);
		expect(agentApply?.content).toBe("Nested apply prompt\n");
	});
});
