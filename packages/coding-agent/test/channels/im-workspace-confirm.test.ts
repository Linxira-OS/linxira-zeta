import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { setAgentDir } from "@linxiraos/pi-utils";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { AgentSession } from "../../src/session/agent-session";

const dirs: string[] = [];
const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;
afterEach(async () => {
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
afterAll(() => {
	if (originalAgentDir) setAgentDir(originalAgentDir);
	else setAgentDir(path.join(os.homedir(), ".zeta", "agent"));
});

function stubCoordinator(): AgentSession {
	return {
		getAgentId: () => "coordinator",
		subscribe: () => () => {},
		deliverIrcMessage: async () => "woken" as const,
		dispose: async () => {},
	} as unknown as AgentSession;
}

async function setup(): Promise<{ router: SessionRouter; config: WebConfig; dir: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-im-confirm-"));
	dirs.push(dir);
	const agentDir = path.join(dir, "agent");
	await fs.mkdir(agentDir, { recursive: true });
	setAgentDir(agentDir);
	const file = path.join(dir, "web.yml");
	await Bun.write(
		file,
		YAML.stringify({
			channels: {
				instances: [
					{
						id: "tg",
						platform: "telegram",
						label: "Telegram",
						enabled: true,
						agentProfile: "p",
						allow: { peers: ["c1"] },
						credentials: { botToken: "t" },
					},
				],
			},
			imAgents: [
				{
					id: "p",
					label: "P",
					persona: { mode: "workspace" },
					location: { kind: "workspace", workspace: "main" },
					tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
			],
			remote: { workspaces: [{ alias: "other", path: dir }] },
		}),
	);
	const config = await WebConfig.load(file);
	const router = new SessionRouter({
		coordinator: stubCoordinator(),
		webConfig: config,
		getLastInbound: () => null,
		sendText: async () => {},
		defaultCwd: dir,
	});
	return { router, config, dir };
}

describe("confirm-gated workspace switch", () => {
	test("preview does not persist; another sender cannot confirm", async () => {
		const { router, config } = await setup();
		const preview = await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, { userId: "u1" });
		expect(preview.same).toBe(false);
		expect(config.findImBinding("tg", "c1", { userId: "u1" })).toBeUndefined();
		const denied = await router.confirmWorkspaceSwitch("tg", "c1", { userId: "u2" });
		expect(denied.ok).toBe(false);
		const applied = await router.confirmWorkspaceSwitch("tg", "c1", { userId: "u1" });
		expect(applied.ok).toBe(true);
		expect(config.findImBinding("tg", "c1", { userId: "u1" })?.target).toEqual({ kind: "workspace", workspace: "other" });
	});

	test("same target is a noop; cancel keeps the old target; a new request replaces the pending one", async () => {
		const { router, config } = await setup();
		const same = await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "main" });
		expect(same.same).toBe(true);
		expect(config.findImBinding("tg", "c1")).toBeUndefined();
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" });
		expect(router.cancelWorkspaceSwitch("tg", "c1")).toBe(true);
		expect(await router.confirmWorkspaceSwitch("tg", "c1")).toMatchObject({ ok: false });
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" });
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "main" });
		expect(await router.confirmWorkspaceSwitch("tg", "c1")).toMatchObject({ ok: false });
	});

	test("unbind is also confirm-gated and removes the chat binding", async () => {
		const { router, config } = await setup();
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" });
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(true);
		expect(config.findImBinding("tg", "c1")).toBeDefined();
		expect(router.requestWorkspaceUnbind("tg", "c1")).toBe(true);
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(true);
		expect(config.findImBinding("tg", "c1")).toBeUndefined();
	});
});
