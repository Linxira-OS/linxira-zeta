import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { setAgentDir } from "@linxiraos/pi-utils";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import { SessionManager } from "../../src/session/session-manager";
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

function stubCoordinator(sessionManager?: SessionManager): AgentSession {
	return {
		getAgentId: () => "coordinator",
		subscribe: () => () => {},
		deliverIrcMessage: async () => "woken" as const,
		dispose: async () => {},
		...(sessionManager ? { sessionManager } : {}),
	} as unknown as AgentSession;
}

async function setup(): Promise<{ router: SessionRouter; config: WebConfig; dir: string; sessionFile: string }> {
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
						agentProfile: "mainp",
						allow: { peers: ["c1"] },
						credentials: { botToken: "t" },
					},
				],
			},
			imAgents: [
				{
					id: "mainp",
					label: "P",
					persona: { mode: "workspace" },
					location: { kind: "workspace", workspace: "main" },
					tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
			],
			remote: {
				workspaces: [
					{ alias: "other", path: dir },
					{ alias: "third", path: dir },
				],
			},
		}),
	);
	const config = await WebConfig.load(file);
	const sessionManager = SessionManager.create(dir, path.join(dir, "sessions"));
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("coordinator transcript was not created");
	// A brand-new session file stays lazy until the first assistant message; a
	// real relay has history, so seed one to exercise restart recovery.
	sessionManager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "relay ready" }],
		provider: "p",
		model: "m",
		timestamp: 0,
	} as never);
	const router = new SessionRouter({
		coordinator: stubCoordinator(sessionManager),
		webConfig: config,
		getLastInbound: () => null,
		sendText: async () => {},
		defaultCwd: dir,
	});
	return { router, config, dir, sessionFile };
}

describe("confirm-gated workspace switch", () => {
	test("preview does not persist; another sender cannot confirm", async () => {
		const { router, config } = await setup();
		const preview = await router.requestWorkspaceSwitch(
			"tg",
			"c1",
			{ kind: "workspace", workspace: "other" },
			{ userId: "u1" },
		);
		expect(preview.same).toBe(false);
		expect(config.findImBinding("tg", "c1", { userId: "u1" })).toBeUndefined();
		const denied = await router.confirmWorkspaceSwitch("tg", "c1", { userId: "u2" });
		expect(denied.ok).toBe(false);
		const applied = await router.confirmWorkspaceSwitch("tg", "c1", { userId: "u1" });
		expect(applied.ok).toBe(true);
		expect(config.findImBinding("tg", "c1", { userId: "u1" })?.target).toEqual({
			kind: "workspace",
			workspace: "other",
		});
	});

	test("same target is a noop; cancel keeps the old target; a new request replaces the pending one", async () => {
		const { router, config } = await setup();
		const same = await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "main" });
		expect(same.same).toBe(true);
		expect(config.findImBinding("tg", "c1")).toBeUndefined();
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" });
		expect(await router.cancelWorkspaceSwitch("tg", "c1")).toBe(true);
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
		expect(await router.requestWorkspaceUnbind("tg", "c1")).toBe(true);
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(true);
		expect(config.findImBinding("tg", "c1")).toBeUndefined();
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(false);
	});

	test("staged switches are isolated by thread and sender, and unbind removes only its own binding", async () => {
		const { router, config } = await setup();
		const t1 = { threadId: "t1", userId: "u1" };
		const t2 = { threadId: "t2", userId: "u1" };
		// Only one answer binding may exist per instance+chat; the sibling thread
		// is a mention binding, exactly as the channel layer would create it.
		await config.patchImBinding("tg", "c1", { role: "mention" }, t2);

		expect(
			(await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, t1)).same,
		).toBe(false);
		expect(
			(await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, t2)).same,
		).toBe(false);

		expect((await router.confirmWorkspaceSwitch("tg", "c1", t1)).ok).toBe(true);
		expect(config.findImBinding("tg", "c1", t1)).toBeDefined();
		expect(config.findImBinding("tg", "c1", t2)?.target).toEqual({ kind: "workspace", workspace: "main" });

		expect((await router.confirmWorkspaceSwitch("tg", "c1", t2)).ok).toBe(true);
		expect(config.findImBinding("tg", "c1", t2)?.target).toEqual({ kind: "workspace", workspace: "other" });
		expect(config.findImBinding("tg", "c1", t2)?.role).toBe("mention");

		expect(await router.requestWorkspaceUnbind("tg", "c1", t1)).toBe(true);
		expect((await router.confirmWorkspaceSwitch("tg", "c1", t1)).ok).toBe(true);
		expect(config.findImBinding("tg", "c1", t1)).toBeUndefined();
		expect(config.findImBinding("tg", "c1", t2)).toBeDefined();
	});

	test("a preview survives a restart and can be confirmed from the persisted handshake", async () => {
		const { router, config, dir, sessionFile } = await setup();
		const context = { threadId: "t1" };
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, context);

		// A fresh process opens the same persisted coordinator transcript.
		const reopened = await SessionManager.open(sessionFile);
		const restarted = new SessionRouter({
			coordinator: stubCoordinator(reopened),
			webConfig: config,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: dir,
		});
		const applied = await restarted.confirmWorkspaceSwitch("tg", "c1", context);
		expect(applied.ok).toBe(true);
		expect(config.findImBinding("tg", "c1", context)?.target).toEqual({ kind: "workspace", workspace: "other" });
	});

	test("gateway request ids are atomic: stale/replaced previews never change the binding", async () => {
		const { router, config } = await setup();
		const context = { threadId: "t1", userId: "u1" };

		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, context);
		const first = (await router.workspaceSwitchStatus("tg", "c1", context)).pending;
		if (!first) throw new Error("first preview missing");
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "third" }, context);
		const second = (await router.workspaceSwitchStatus("tg", "c1", context)).pending;
		if (!second) throw new Error("second preview missing");
		expect(second.requestId).not.toBe(first.requestId);

		// A stale UI id cannot apply the replaced preview.
		expect(await router.confirmWorkspaceSwitch("tg", "c1", context, first.requestId)).toMatchObject({
			ok: false,
			error: "stale-request",
		});
		expect(config.findImBinding("tg", "c1", context)).toBeUndefined();
		expect((await router.workspaceSwitchStatus("tg", "c1", context)).pending?.requestId).toBe(second.requestId);

		// Another sender cannot see/confirm the same chat+thread's pending switch.
		expect(
			await router.confirmWorkspaceSwitch("tg", "c1", { threadId: "t1", userId: "u2" }, second.requestId),
		).toMatchObject({ ok: false });
		expect((await router.workspaceSwitchStatus("tg", "c1", context)).pending?.requestId).toBe(second.requestId);

		// A stale cancel leaves the newer pending handshake intact.
		expect(await router.cancelWorkspaceSwitch("tg", "c1", context, first.requestId)).toBe(false);
		expect((await router.workspaceSwitchStatus("tg", "c1", context)).pending?.requestId).toBe(second.requestId);
		expect(await router.cancelWorkspaceSwitch("tg", "c1", context, second.requestId)).toBe(true);
		expect((await router.workspaceSwitchStatus("tg", "c1", context)).pending).toBeUndefined();

		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" }, context);
		const third = (await router.workspaceSwitchStatus("tg", "c1", context)).pending;
		if (!third) throw new Error("third preview missing");
		expect((await router.confirmWorkspaceSwitch("tg", "c1", context, third.requestId)).ok).toBe(true);
		expect(config.findImBinding("tg", "c1", context)?.target).toEqual({ kind: "workspace", workspace: "other" });
	});

	test("the same cwd under different targets keeps distinct target-scoped sessions", async () => {
		const { router, config, dir } = await setup();
		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "other" });
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(true);
		const otherBinding = config.findImBinding("tg", "c1");
		if (!otherBinding) throw new Error("other binding missing");
		const other = await router.ensureImBindingSession(otherBinding);
		expect(other.ok).toBe(true);

		await router.requestWorkspaceSwitch("tg", "c1", { kind: "workspace", workspace: "main" });
		expect((await router.confirmWorkspaceSwitch("tg", "c1")).ok).toBe(true);
		const mainBinding = config.findImBinding("tg", "c1");
		if (!mainBinding) throw new Error("main binding missing");
		const main = await router.ensureImBindingSession(mainBinding);
		expect(main.ok).toBe(true);
		if (!other.ok || !main.ok) throw new Error("session creation failed");
		expect(main.id).not.toBe(other.id);

		const otherEntry = config.getBotSession(other.id);
		const mainEntry = config.getBotSession(main.id);
		expect(otherEntry?.cwd).toBe(dir);
		expect(mainEntry?.cwd).toBe(dir);
		expect(otherEntry?.target).toEqual({ kind: "workspace", workspace: "other" });
		expect(mainEntry?.target).toEqual({ kind: "workspace", workspace: "main" });
	});
});
