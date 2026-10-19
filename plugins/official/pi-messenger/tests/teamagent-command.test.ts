import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("node:os", async importOriginal => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: homedirMock,
	};
});

// getAgentDir() snapshots the environment into a module-level resolver at
// import time, so every test re-imports the module graph after pointing
// os.homedir at a fresh temp root.
async function loadModule() {
	vi.resetModules();
	return import("../teamagent-command.ts");
}

interface SentMessage {
	customType: string;
	content: string;
}

type CommandHandler = (args: string, ctx: { cwd: string }) => Promise<void>;

function createMockPi() {
	const sent: SentMessage[] = [];
	const handlers: CommandHandler[] = [];
	const pi = {
		registerCommand: vi.fn((_name: string, options: { handler: CommandHandler }) => {
			handlers.push(options.handler);
		}),
		sendMessage: vi.fn((message: SentMessage) => {
			sent.push(message);
		}),
	};
	return { pi, sent, handlers };
}

const roots: string[] = [];

function createTempRoot(): string {
	const root = fs.mkdtempSync(path.join(tmpdir(), "pi-messenger-teamagent-test-"));
	roots.push(root);
	return root;
}

describe("teamagent command", () => {
	let root: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		root = createTempRoot();
		agentDir = path.join(root, ".zeta", "agent");
		cwd = path.join(root, "project");
		fs.mkdirSync(cwd, { recursive: true });
		homedirMock.mockReset();
		homedirMock.mockReturnValue(root);
	});

	afterEach(() => {
		for (const dir of roots) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		roots.length = 0;
	});

	it("writes user-scope agents into the runtime discovery directory", async () => {
		const { resolveAgentsDir } = await loadModule();
		expect(resolveAgentsDir("user", cwd).dir).toBe(path.join(agentDir, "agents"));
	});

	it("writes project-scope agents into <project>/.zeta/agents", async () => {
		const { resolveAgentsDir } = await loadModule();
		expect(resolveAgentsDir("project", cwd).dir).toBe(path.join(cwd, ".zeta", "agents"));
	});

	it("add --user lands where discovery reads user agents", async () => {
		const { addTeamAgent } = await loadModule();
		const result = addTeamAgent(
			{ name: "worker", description: "Implementation agent" },
			"user",
			cwd,
		);

		expect(result.ok).toBe(true);
		expect(result.filePath).toBe(path.join(agentDir, "agents", "worker.md"));
		expect(fs.existsSync(result.filePath!)).toBe(true);
	});

	it("refuses project scope without the trust opt-in", async () => {
		const { registerTeamAgentCommand } = await loadModule();
		const { pi, sent, handlers } = createMockPi();
		registerTeamAgentCommand(pi as never);

		await handlers[0]("add worker", { cwd });

		expect(sent).toHaveLength(1);
		expect(sent[0].content).toContain("Refused");
		expect(sent[0].content).toContain("trustProjectAgents");
		expect(fs.existsSync(path.join(cwd, ".zeta", "agents", "worker.md"))).toBe(false);
	});

	it("registers project scope and reports immediate spawnability with the opt-in", async () => {
		fs.mkdirSync(path.join(cwd, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".zeta", "pi-messenger.json"),
			JSON.stringify({ trustProjectAgents: true }),
		);

		const { registerTeamAgentCommand } = await loadModule();
		const { pi, sent, handlers } = createMockPi();
		registerTeamAgentCommand(pi as never);

		await handlers[0]("add worker", { cwd });

		expect(sent).toHaveLength(1);
		expect(fs.existsSync(path.join(cwd, ".zeta", "agents", "worker.md"))).toBe(true);
		expect(sent[0].content).toContain("Spawnable now");
		// The stale "restart before spawning" advice is gone.
		expect(sent[0].content).not.toContain("Restart");
	});

	// Two readers consume the written file: the crew role mirror (a hand-rolled
	// frontmatter reader with no key normalization, which reads the literal
	// `thinking` / `skills` keys) and CLI agent discovery (which normalizes
	// kebab-case to camelCase and prefers `thinkingLevel`, falling back to the
	// legacy `thinking` key). A single rendered file must feed both.
	it("round-trips thinking and skills through the crew mirror and CLI discovery", async () => {
		const { addTeamAgent } = await loadModule();
		const result = addTeamAgent(
			{
				name: "worker",
				description: "Implementation agent",
				thinking: "high",
				skills: ["testing", "api"],
			},
			"project",
			cwd,
		);
		expect(result.ok).toBe(true);
		const filePath = result.filePath!;
		const content = fs.readFileSync(filePath, "utf8");
		// The writer must emit the key both readers understand, and must leave
		// `autoloadSkills` alone (that is the CLI's canonical skills key).
		expect(content).toContain('thinking: "high"');
		expect(content).not.toContain("thinking-level:");
		expect(content).toContain("autoloadSkills:");

		// Both readers are loaded after `homedir` is pointed at the temp root:
		// the mirror resolves `~/.zeta/agent/agents` through getAgentDir(), so
		// it must not be hoisted into the module graph this file re-imports per
		// test (see loadModule).
		const { discoverSubagentRoles } = await import("../crew/team/subagent-roles.ts");
		const mirrored = discoverSubagentRoles(cwd, { homeDir: path.join(root, "empty-home") });
		expect(mirrored.worker?.thinking).toBe("high");
		expect(mirrored.worker?.skills).toEqual(["testing", "api"]);

		// CLI discovery: kebab→camel normalization plus the `thinking` fallback.
		const { parseAgent } = await import("@linxiraos/zeta/task/agents");
		const parsed = parseAgent(filePath, content, "project");
		expect(parsed.thinkingLevel).toBe("high");
		expect(parsed.autoloadSkills).toEqual(["testing", "api"]);
	});

	it("renders a tool allowlist that agent discovery parses", async () => {
		const { renderAgentMarkdown } = await loadModule();
		// Runtime import: `@linxiraos/pi-utils` snapshots os.homedir() at module
		// load, so readers must load after beforeEach points it at the temp root.
		const { parseAgent } = await import("@linxiraos/zeta/task/agents");

		const content = renderAgentMarkdown({
			name: "scout",
			description: "Read-only recon",
			tools: ["read", "grep"],
		});

		expect(content).toContain('tools: ["read","grep"]');
		const parsed = parseAgent("inline.md", content, "project");
		expect(parsed.tools).toEqual(["read", "grep"]);
	});

	it("defaults non-editing roles to the minimal allowlist and leaves editing roles unrestricted", async () => {
		const { addTeamAgent, NON_EDITING_ROLE_TOOLS } = await loadModule();

		const planner = addTeamAgent({ name: "planner", description: "Plan only" }, "project", cwd);
		expect(planner.ok).toBe(true);
		const plannerContent = fs.readFileSync(planner.filePath!, "utf8");
		expect(plannerContent).toContain(`tools: ${JSON.stringify([...NON_EDITING_ROLE_TOOLS])}`);

		const worker = addTeamAgent({ name: "worker", description: "Implementation agent" }, "project", cwd);
		expect(worker.ok).toBe(true);
		expect(fs.readFileSync(worker.filePath!, "utf8")).not.toContain("tools:");

		// The crew mirror (which feeds /teamagent add on later runs) keeps the
		// allowlist instead of silently dropping it. Runtime import for the same
		// home-snapshot reason as the CLI reader above.
		const { discoverSubagentRoles } = await import("../crew/team/subagent-roles.ts");
		const mirrored = discoverSubagentRoles(cwd, { homeDir: path.join(root, "empty-home") });
		expect(mirrored.planner?.tools).toEqual([...NON_EDITING_ROLE_TOOLS]);
	});

	it("rejects --user together with --project instead of preferring --user", async () => {
		const { registerTeamAgentCommand } = await loadModule();
		const { pi, sent, handlers } = createMockPi();
		registerTeamAgentCommand(pi as never);

		await handlers[0]("add worker --user --project", { cwd });

		expect(sent).toHaveLength(1);
		expect(sent[0].content).toContain("Cannot combine --user and --project");
		expect(fs.existsSync(path.join(agentDir, "agents", "worker.md"))).toBe(false);
		expect(fs.existsSync(path.join(cwd, ".zeta", "agents", "worker.md"))).toBe(false);
	});

	it("documents agents and --project in the usage text", async () => {
		const { registerTeamAgentCommand } = await loadModule();
		const { pi, sent, handlers } = createMockPi();
		registerTeamAgentCommand(pi as never);

		await handlers[0]("", { cwd });

		expect(sent).toHaveLength(1);
		expect(sent[0].content).toContain("/teamagent agents");
		expect(sent[0].content).toContain("--project");
		expect(sent[0].content).toContain("--user");
	});

	it("names the real verbs when the subcommand is unknown", async () => {
		const { registerTeamAgentCommand } = await loadModule();
		const { pi, sent, handlers } = createMockPi();
		registerTeamAgentCommand(pi as never);

		await handlers[0]("nope", { cwd });

		expect(sent[0].content).toContain("roles, status, profile.list, charter.show, agents, add or remove");
	});
});
