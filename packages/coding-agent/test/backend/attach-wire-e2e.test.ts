/**
 * Attached TUI end to end: the local renderer, a backend-owned session, and the
 * wire protocol in between.
 *
 * Covers the contract the attach switch exists for — a prompt is submitted over
 * the socket, the backend runs it, the SSE mirror feeds the same renderer a
 * local turn would, and a backend dialog is presented by the TUI and answered
 * over the socket (settling the backend's pending request).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { ThinkingLevel } from "@linxiraos/pi-agent-core/thinking";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { Composer } from "@linxiraos/pi-tui/prompt/composer";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { FileSessionStorage } from "@linxiraos/zeta/session/session-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal";
import { BackendAttachLink } from "../../src/backend/attach-link";
import { startWebGateway, type WebGatewayInstance } from "../../src/server/web-gateway";
import { AgentSessionWrapper, sessions as gatewaySessions } from "../../src/server/web-gateway/agents";
import { serveIdentity } from "../../src/server/web-gateway/identity";
import { cacheSessionPath } from "../../src/server/web-gateway/sessions";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

function plainRows(rows: readonly string[]): string[] {
	return rows.map(row => Bun.stripANSI(row).trimEnd());
}

describe("attached TUI over the wire protocol", () => {
	let tempDir: TempDir;
	let gateway: WebGatewayInstance | undefined;
	let mode: InteractiveMode | undefined;
	let link: BackendAttachLink | undefined;
	let term: VirtualTerminal;
	let backendSession: AgentSession | undefined;
	let localSession: AgentSession | undefined;
	let previousAgentDir: string | undefined;
	let previousConfigDir: string | undefined;

	beforeEach(async () => {
		initTheme();
		resetSettingsForTest();
		tempDir = TempDir.createSync("@zeta-attach-wire-");
		// Extensions are discovered from the config root; keep the user's global
		// install out of this run so only the attach path is under test.
		previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
		previousConfigDir = process.env.ZETA_CONFIG_DIR;
		process.env.ZETA_CODING_AGENT_DIR = path.join(tempDir.path(), "agent");
		process.env.ZETA_CONFIG_DIR = `.zeta-attach-wire-${process.pid}`;
		refreshDirsFromEnv();
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
	});

	afterEach(async () => {
		await link?.detach().catch(() => undefined);
		mode?.stop();
		await localSession?.dispose().catch(() => undefined);
		await gateway?.shutdown().catch(() => undefined);
		if (backendSession) {
			const id = backendSession.sessionId;
			gatewaySessions.delete(id);
			await backendSession.dispose().catch(() => undefined);
		}
		gateway = undefined;
		link = undefined;
		mode = undefined;
		backendSession = undefined;
		localSession = undefined;
		// Windows keeps the replica/session handles open for a moment after
		// dispose; removal is best-effort and must not delay the hook.
		void rm(tempDir.path(), { recursive: true, force: true, maxRetries: 0 }).catch(() => undefined);
		resetSettingsForTest();
		if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
		if (previousConfigDir === undefined) delete process.env.ZETA_CONFIG_DIR;
		else process.env.ZETA_CONFIG_DIR = previousConfigDir;
		refreshDirsFromEnv();
	});

	test("prompts and dialogs cross the wire while the renderer stays local", async () => {
		// The gateway reports the session's project directory; a scratch dir
		// outside a project resolves to the enclosing repo, so use the checkout
		// itself as the workspace both sides share.
		const cwd = process.cwd();

		// Backend session, owned by the gateway.
		const replyModel = createMockModel({ handler: { content: ["wire reply"] } });
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime(replyModel.model.provider, "test-key");
		const backendManager = SessionManager.create(
			cwd,
			path.join(tempDir.path(), "sessions"),
			new FileSessionStorage(),
			{
				client: "cli",
			},
		);
		backendManager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() } as never);
		backendSession = new AgentSession({
			agent: new Agent({
				initialState: { model: replyModel.model, systemPrompt: ["test"], tools: [], messages: [] },
				streamFn: replyModel.stream,
			}),
			sessionManager: backendManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
		const sessionId = backendManager.getSessionId();
		const sessionFile = backendManager.getSessionFile();
		if (!sessionFile) throw new Error("backend session did not create a file");
		const wrapper = new AgentSessionWrapper(backendSession, sessionId, sessionFile);
		gatewaySessions.set(sessionId, wrapper);
		cacheSessionPath(sessionId, sessionFile);

		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		gateway = await startWebGateway(port);

		// Local TUI, then the attach link over it.
		const localModel = createMockModel({ handler: { content: ["local reply"] } });
		localSession = new AgentSession({
			agent: new Agent({
				initialState: { model: localModel.model, systemPrompt: ["test"], tools: [], messages: [] },
			}),
			// Same cwd as the backend session: attach refuses a cwd change, which
			// mirrors the CLI launching inside the project it attaches to.
			sessionManager: SessionManager.create(cwd, path.join(tempDir.path(), "local-sessions")),
			settings: Settings.isolated(),
			modelRegistry: new ModelRegistry(authStorage),
		});
		term = new VirtualTerminal(120, 40);
		mode = new InteractiveMode(
			localSession,
			"test",
			undefined,
			() => {},
			undefined,
			undefined,
			undefined,
			new Composer({ terminal: term }),
		);
		await mode.init({ suppressWelcomeIntro: true });

		link = new BackendAttachLink(
			mode,
			{
				backend: { baseUrl: gateway.url, identity: serveIdentity() },
				sessionId,
				newSession: false,
				explicit: true,
			},
			{ replicaDir: path.join(tempDir.path(), "replicas") },
		);
		await link.join();
		expect(link.attached).toBe(true);

		// Prompt over the socket → backend turn → mirrored into the TUI.
		link.sendPrompt("hello over the wire");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("wire reply")));
		expect(plainRows(term.getViewport()).some(row => row.includes("wire reply"))).toBe(true);
		// Reading the session detail must not open a second writer over the live
		// session: the backend keeps saving into the same file.
		expect(backendManager.getSessionFile()).toBe(sessionFile);

		// `/thinking`-style switches happen on the replica; the backend must end
		// up on the same level or the next run disagrees with the status line.
		mode.session.setThinkingLevel(ThinkingLevel.Low);
		const thinkingDeadline = Date.now() + 2_000;
		while (backendSession.thinkingLevel !== mode.session.thinkingLevel && Date.now() < thinkingDeadline) {
			await term.waitForRender();
		}
		expect(backendSession.thinkingLevel).toBe(mode.session.thinkingLevel);

		// Backend dialog → TUI selector → answer over the socket settles it.
		const answered = Promise.withResolvers<Record<string, unknown>>();
		wrapper.registerUiRequest("tui-dialog", answered.resolve, () => answered.resolve({ cancelled: true }));
		wrapper.dispatchUiRequest({
			type: "extension_ui_request",
			id: "tui-dialog",
			method: "confirm",
			title: "Continue the backend run?",
			message: "dialog over the wire",
		});
		await term.waitForRender(() =>
			plainRows(term.getViewport()).some(row => row.includes("Continue the backend run?")),
		);
		term.sendInput("\r");
		expect(await answered.promise).toEqual({ confirmed: true });
	}, 120_000);
});
