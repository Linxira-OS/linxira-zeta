import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearCache as clearFsCache } from "@linxiraos/zeta/capability/fs";
import { type SlashCommand, slashCommandCapability } from "@linxiraos/zeta/capability/slash-command";
import { setForeignProjectSourceConsent } from "@linxiraos/zeta/config/foreign-sources";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
import { loadCapability } from "@linxiraos/zeta/discovery";
import { loadSlashCommands } from "@linxiraos/zeta/extensibility/slash-commands";
import { commandInspectorData, commandPreview } from "@linxiraos/pi-tui/overlays/extensions/inspector-model";
import { InspectorPanel } from "@linxiraos/pi-tui/overlays/extensions/inspector-panel";
import { applyFilter } from "@linxiraos/pi-tui/overlays/extensions/state-manager";
import type { Extension } from "@linxiraos/pi-tui/overlays/extensions/types";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { __resetDirsFromEnvForTests, removeWithRetries, setAgentDir } from "@linxiraos/pi-utils";

// `setAgentDir` deletes profile env keys; restore the exact pre-suite state.
const ORIGINAL_DIR_ENV = {
	ZETA_CODING_AGENT_DIR: process.env.ZETA_CODING_AGENT_DIR,
	PI_PROFILE: process.env.PI_PROFILE,
	OMP_PROFILE: process.env.OMP_PROFILE,
};

const COMMAND_FILE = `---
description: Deploy a service
argument-hint: <service>
---

Deploy $ARGUMENTS
`;

beforeAll(async () => {
	await initTheme(false);
});

function dashboardCommand(command: SlashCommand): Extension {
	const preserved = typeof command.description === "string" ? command.description.trim() : "";
	return {
		id: `slash-command:${command.name}`,
		kind: "slash-command",
		name: command.name,
		displayName: command.name,
		description: preserved || commandPreview(command.content).description,
		trigger: `/${command.name}`,
		path: command.path,
		source: {
			provider: command._source.provider,
			providerName: command._source.providerName,
			level: command.level,
		},
		state: "active",
		raw: command,
	};
}

describe("Codex and OpenCode slash-command frontmatter", () => {
	let root = "";
	let home = "";
	let project = "";
	let agentDir = "";
	let originalHome: string | undefined;

	beforeEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		originalHome = process.env.HOME;
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-provider-commands-"));
		home = path.join(root, "home");
		project = path.join(root, "project");
		agentDir = path.join(root, "agent");
		process.env.HOME = home;
		vi.spyOn(os, "homedir").mockReturnValue(home);
		await fs.mkdir(path.join(project, ".git"), { recursive: true });
		// Consent lives in <agentDir>/sources.json; keep it inside this test's temp root.
		setAgentDir(agentDir);
	});

	afterEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		vi.restoreAllMocks();
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		for (const [key, value] of Object.entries(ORIGINAL_DIR_ENV)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		__resetDirsFromEnvForTests();
		await removeWithRetries(root);
	});

	/** Approve a foreign project source through the same hash-bound store the CLI writes. */
	function approveProjectSource(provider: "codex" | "opencode" | "claude"): void {
		setForeignProjectSourceConsent(provider, project, true, agentDir);
		clearFsCache();
	}

	async function loadProviderCommands(provider: "codex" | "opencode" | "claude"): Promise<SlashCommand[]> {
		const result = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: project,
			agentDir,
			providers: [provider],
		});
		return result.items;
	}

	test("Codex keeps parsed description and argument hint after stripping frontmatter from content", async () => {
		const file = path.join(project, ".codex", "commands", "deploy.md");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, COMMAND_FILE);

		// Foreign project source default: no consent, no commands.
		expect((await loadProviderCommands("codex")).find(item => item.name === "deploy")).toBeUndefined();
		expect((await loadProviderCommands("codex")).length).toBe(0);

		approveProjectSource("codex");
		const command = (await loadProviderCommands("codex")).find(item => item.name === "deploy");
		expect(command).toBeDefined();
		expect(command?.level).toBe("project");
		expect(command?._source.provider).toBe("codex");
		expect(command?.content.trim()).toBe("Deploy $ARGUMENTS");
		expect(command?.content).not.toContain("description:");
		expect(command?.description).toBe("Deploy a service");
		expect(command?.argumentHint).toBe("<service>");

		const ext = dashboardCommand(command!);
		const data = commandInspectorData(ext);
		expect(data.description).toBe("Deploy a service");
		expect(data.argumentHint).toBe("<service>");
		expect(data.body).toContain("Deploy $ARGUMENTS");
		expect(data.body).not.toContain("description:");
		expect(data.usesArguments).toBe(true);

		const panel = new InspectorPanel();
		panel.setExtension(ext);
		const rendered = Bun.stripANSI(panel.render(72).join("\n"));
		expect(rendered).toContain("Deploy a service");
		expect(rendered).toContain("<service>");
		expect(rendered).toContain("accepts $ARGUMENTS");
		expect(rendered).not.toContain("description:");

		expect(applyFilter([ext], "Deploy a service").map(item => item.name)).toEqual(["deploy"]);
	});

	test("OpenCode keeps parsed description and argument hint after stripping frontmatter from content", async () => {
		const file = path.join(project, ".opencode", "commands", "deploy.md");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, COMMAND_FILE);

		expect((await loadProviderCommands("opencode")).find(item => item.name === "deploy")).toBeUndefined();
		expect((await loadProviderCommands("opencode")).length).toBe(0);

		approveProjectSource("opencode");
		const command = (await loadProviderCommands("opencode")).find(item => item.name === "deploy");
		expect(command).toBeDefined();
		expect(command?.level).toBe("project");
		expect(command?._source.provider).toBe("opencode");
		expect(command?.content.trim()).toBe("Deploy $ARGUMENTS");
		expect(command?.description).toBe("Deploy a service");
		expect(command?.argumentHint).toBe("<service>");

		const ext = dashboardCommand(command!);
		const data = commandInspectorData(ext);
		expect(data.description).toBe("Deploy a service");
		expect(data.argumentHint).toBe("<service>");
		expect(data.usesArguments).toBe(true);

		const panel = new InspectorPanel();
		panel.setExtension(ext);
		const rendered = Bun.stripANSI(panel.render(72).join("\n"));
		expect(rendered).toContain("Deploy a service");
		expect(rendered).toContain("<service>");

		expect(applyFilter([ext], "Deploy a service").map(item => item.name)).toEqual(["deploy"]);
	});

	test("Claude raw-frontmatter commands still resolve through commandPreview", async () => {
		const file = path.join(project, ".claude", "commands", "deploy.md");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, COMMAND_FILE);

		expect((await loadProviderCommands("claude")).find(item => item.name === "deploy")).toBeUndefined();

		approveProjectSource("claude");
		const command = (await loadProviderCommands("claude")).find(item => item.name === "deploy");
		expect(command).toBeDefined();
		expect(command?.level).toBe("project");
		expect(command?._source.provider).toBe("claude");
		expect(command?.content).toContain("description: Deploy a service");
		expect(command?.content).toContain("Deploy $ARGUMENTS");

		const ext = dashboardCommand(command!);
		const data = commandInspectorData(ext);
		expect(data.description).toBe("Deploy a service");
		expect(data.argumentHint).toBe("<service>");
		expect(data.body).toContain("Deploy $ARGUMENTS");
		expect(data.body).not.toContain("description:");
		expect(data.usesArguments).toBe(true);

		expect(applyFilter([ext], "Deploy a service").map(item => item.name)).toEqual(["deploy"]);
	});

	test("Codex and OpenCode side: true commands load as side commands; quoted true does not", async () => {
		const sideFile = ["---", "description: Situation report", "side: true", "---", "Report status", ""].join("\n");
		const quotedFile = ["---", "description: Quoted flag", 'side: "true"', "---", "Body", ""].join("\n");
		for (const [dir, prefix] of [
			[".codex", "codex"],
			[".opencode", "opencode"],
		] as const) {
			const commandsDir = path.join(project, dir, "commands");
			await fs.mkdir(commandsDir, { recursive: true });
			await fs.writeFile(path.join(commandsDir, `${prefix}-sitrep.md`), sideFile);
			await fs.writeFile(path.join(commandsDir, `${prefix}-quoted.md`), quotedFile);
		}

		const unapproved = await loadSlashCommands({ cwd: project });
		for (const prefix of ["codex", "opencode"]) {
			expect(unapproved.find(command => command.name === `${prefix}-sitrep`)).toBeUndefined();
			expect(unapproved.find(command => command.name === `${prefix}-quoted`)).toBeUndefined();
		}

		approveProjectSource("codex");
		approveProjectSource("opencode");
		const commands = await loadSlashCommands({ cwd: project });
		for (const prefix of ["codex", "opencode"]) {
			const sitrep = commands.find(command => command.name === `${prefix}-sitrep`);
			const quoted = commands.find(command => command.name === `${prefix}-quoted`);
			expect(sitrep?.side).toBe(true);
			expect(sitrep?.content.trim()).toBe("Report status");
			expect(quoted).toBeDefined();
			expect(quoted?.side).toBeUndefined();
		}
	});

	test("project-source approval is hash-bound: editing an approved command revokes it", async () => {
		const file = path.join(project, ".codex", "commands", "deploy.md");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, COMMAND_FILE);

		approveProjectSource("codex");
		expect((await loadProviderCommands("codex")).find(item => item.name === "deploy")).toBeDefined();

		await fs.writeFile(file, `${COMMAND_FILE}\nChanged after approval\n`);
		clearFsCache();
		expect((await loadProviderCommands("codex")).find(item => item.name === "deploy")).toBeUndefined();
	});

	test("consent preserves project command agent/model/template execution metadata", async () => {
		const file = path.join(project, ".codex", "commands", "review.md");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(
			file,
			["---", "description: Review changes", "agent: reviewer", "model: anthropic/claude-sonnet-4-5", "template: Review $ARGUMENTS", "---", "Body", ""].join("\n"),
		);

		expect((await loadProviderCommands("codex")).find(item => item.name === "review")).toBeUndefined();

		approveProjectSource("codex");
		const command = (await loadProviderCommands("codex")).find(item => item.name === "review");
		expect(command).toBeDefined();
		expect(command?.agent).toBe("reviewer");
		expect(command?.model).toBe("anthropic/claude-sonnet-4-5");
		expect(command?.template).toBe("Review $ARGUMENTS");
		expect(command?._source.provider).toBe("codex");
		expect(command?.level).toBe("project");
	});

	test("frontmatter-only command preview keeps an empty body", () => {
		const preview = commandPreview(`---
description: Deploy a service
argument-hint: $ARGUMENTS
---
`);
		expect(preview.description).toBe("Deploy a service");
		expect(preview.argumentHint).toBe("$ARGUMENTS");
		expect(preview.body).toBe("");
		expect(preview.body).not.toContain("description:");
		expect(preview.usesArguments).toBe(false);
	});
});
