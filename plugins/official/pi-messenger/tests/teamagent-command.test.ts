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
});
