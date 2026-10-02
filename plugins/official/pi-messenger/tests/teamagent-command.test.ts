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
});
