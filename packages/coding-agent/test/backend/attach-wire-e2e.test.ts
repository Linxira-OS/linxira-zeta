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
import { mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { ThinkingLevel } from "@linxiraos/pi-agent-core/thinking";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { type } from "@linxiraos/pi-omptype";
import { PROPOSE_DEVICE_NAME } from "@linxiraos/pi-tui/tools/resolve";
import { Composer } from "@linxiraos/pi-tui/prompt/composer";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resolveLocalUrlToPath } from "@linxiraos/zeta/internal-urls";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import type { ToolSession } from "../../src/tools";
import { PROPOSE_DEVICE_PATH, dispatchResolutionDevice } from "../../src/tools/resolve";
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
		await backendSession?.abort({ reason: "test cleanup" }).catch(() => undefined);
		await localSession?.abort({ reason: "test cleanup" }).catch(() => undefined);
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

		// Mode switches are state on the replica too; the backend must enter and
		// leave the same mode or the next turn runs under different rules.
		await mode.session.enterPlanMode();
		const planDeadline = Date.now() + 2_000;
		while (!backendSession.getPlanModeState()?.enabled && Date.now() < planDeadline) await term.waitForRender();
		expect(backendSession.getPlanModeState()?.enabled).toBe(true);
		await mode.session.exitPlanMode();
		const exitDeadline = Date.now() + 2_000;
		while (backendSession.getPlanModeState()?.enabled && Date.now() < exitDeadline) await term.waitForRender();
		expect(backendSession.getPlanModeState()?.enabled).toBeUndefined();

		// A goal is more than a switch: the objective and token budget must reach
		// the backend or it runs a different goal than the one on screen.
		await mode.session.enterGoalMode({ objective: "finish attach parity", tokenBudget: 50_000 });
		const goalDeadline = Date.now() + 2_000;
		while (!backendSession.getGoalModeState()?.enabled && Date.now() < goalDeadline) await term.waitForRender();
		expect(backendSession.getGoalModeState()?.goal.objective).toBe("finish attach parity");
		expect(backendSession.getGoalModeState()?.goal.tokenBudget).toBe(50_000);
		await mode.session.exitGoalMode();
		const dropDeadline = Date.now() + 2_000;
		while (backendSession.getGoalModeState() && Date.now() < dropDeadline) await term.waitForRender();
		expect(backendSession.getGoalModeState()).toBeUndefined();

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

	test("attaches to a backend session that has no saved file yet", async () => {
		// `ensure_session` creates a live session whose file appears only after
		// the first save; its `/api/sessions/<id>` detail reports `model: {}`.
		// Join must tolerate that shape instead of degrading to in-process.
		const cwd = process.cwd();
		const model = createMockModel({ handler: { content: ["unused"] } });
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime(model.model.provider, "test-key");

		const backendManager = SessionManager.create(
			cwd,
			path.join(tempDir.path(), "sessions"),
			new FileSessionStorage(),
			{ client: "cli" },
		);
		backendSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
				streamFn: model.stream,
			}),
			sessionManager: backendManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
		const sessionId = backendManager.getSessionId();
		const sessionFile = backendManager.getSessionFile();
		if (sessionFile) cacheSessionPath(sessionId, sessionFile);
		const wrapper = new AgentSessionWrapper(backendSession, sessionId, sessionFile ?? null);
		gatewaySessions.set(sessionId, wrapper);

		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		gateway = await startWebGateway(port);

		localSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
			}),
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
	});

	test("runs /loop on the attached backend session, never on the replica", async () => {
		const cwd = process.cwd();
		const model = createMockModel({ handler: { content: ["ok"] } });
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime(model.model.provider, "test-key");

		const backendManager = SessionManager.create(
			cwd,
			path.join(tempDir.path(), "sessions"),
			new FileSessionStorage(),
			{ client: "cli" },
		);
		backendSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
				streamFn: model.stream,
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

		localSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
			}),
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

		void mode.getUserInput();
		term.sendInput("/loop 5 attached-only");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("/loop 1 attached-only")));
		term.sendInput("\r");

		const enabledDeadline = Date.now() + 5_000;
		while (Date.now() < enabledDeadline && link.loopState?.enabled !== true) await Bun.sleep(50);
		expect(link.loopState).toMatchObject({ enabled: true, prompt: "attached-only" });

		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			await Bun.sleep(100);
			const users = backendSession.messages.filter(message => message.role === "user");
			if (users.length >= 2) break;
		}
		const backendUsers = backendSession.messages
			.filter(message => message.role === "user")
			.map(message =>
				typeof message.content === "string"
					? message.content
					: message.content
							.filter(block => block.type === "text")
							.map(block => block.text)
							.join(""),
			);
		expect(backendUsers.slice(0, 2)).toEqual(["attached-only", "attached-only"]);

		// A second `/loop` disables the backend loop; the mirrored state follows.
		term.sendInput("/loop");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("/loop")));
		term.sendInput("\r");
		const stateDeadline = Date.now() + 10_000;
		while (Date.now() < stateDeadline && link.loopState !== null) await Bun.sleep(100);
		expect(link.loopState).toBeNull();
		// Let the last repetition finish before teardown; aborting/disposing a
		// streaming session is what hung the following tests.
		await backendSession.waitForIdle();
	}, 30_000);

	test("renders the backend's plan review and executes the approved plan", async () => {
		const cwd = process.cwd();
		const model = createMockModel({
			handler: { content: ["unused"] },
			responses: [
				{
					content: [
						{
							type: "toolCall",
							name: "write",
							arguments: { path: "local://web-plan.md", content: "# Web plan\n\nImplement it.\n" },
						},
					],
				},
				{
					content: [{ type: "toolCall", name: "write", arguments: { path: PROPOSE_DEVICE_PATH, content: "web" } }],
				},
				{ content: ["Plan submitted."] },
				{ content: ["Executing the approved plan."] },
			],
		});
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime(model.model.provider, "test-key");

		// The fake write tool mirrors the internal-URL write scheme: `local://` lands
		// in the session artifacts dir, the propose device submits the plan.
		const writeTool: AgentTool = {
			name: "write",
			label: "write",
			description: "Fake write",
			parameters: type({}),
			async execute(_toolCallId, input) {
				const target = String((input as { path?: unknown }).path ?? "");
				const content = String((input as { content?: unknown }).content ?? "");
				if (target === PROPOSE_DEVICE_PATH) {
					const { result, xdev } = await dispatchResolutionDevice(
						{
							peekPlanProposalHandler: () => backendSession!.peekPlanProposalHandler(),
						} as unknown as ToolSession,
						PROPOSE_DEVICE_NAME,
						content,
					);
					return { content: result.content, details: { xdev }, isError: result.isError };
				}
				const resolved = resolveLocalUrlToPath(target, {
					getArtifactsDir: () => backendSession!.sessionManager.getArtifactsDir(),
					getSessionId: () => backendSession!.sessionManager.getSessionId(),
				});
				await Bun.write(resolved, content);
				return { content: [{ type: "text" as const, text: `Wrote ${target}` }] };
			},
		};

		const backendManager = SessionManager.create(
			cwd,
			path.join(tempDir.path(), "sessions"),
			new FileSessionStorage(),
			{ client: "cli" },
		);
		backendSession = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model: model.model, systemPrompt: ["test"], tools: [writeTool], messages: [] },
				streamFn: model.stream,
			}),
			sessionManager: backendManager,
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
			toolRegistry: new Map<string, AgentTool>([["write", writeTool]]),
			builtInToolNames: ["write"],
			advisorTools: [],
		});
		const backend = backendSession;
		const sessionId = backendManager.getSessionId();
		const sessionFile = backendManager.getSessionFile();
		if (!sessionFile) throw new Error("backend session did not create a file");
		const wrapper = new AgentSessionWrapper(backend, sessionId, sessionFile);
		gatewaySessions.set(sessionId, wrapper);
		cacheSessionPath(sessionId, sessionFile);

		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		gateway = await startWebGateway(port);

		localSession = new AgentSession({
			agent: new Agent({ initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(cwd, path.join(tempDir.path(), "local-sessions")),
			settings: Settings.isolated(),
			modelRegistry: new ModelRegistry(authStorage),
		});
		term = new VirtualTerminal(140, 50);
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
			{ backend: { baseUrl: gateway.url, identity: serveIdentity() }, sessionId, newSession: false, explicit: true },
			{ replicaDir: path.join(tempDir.path(), "replicas") },
		);
		await link.join();
		expect(link.attached).toBe(true);

		// The operator types `/plan <task>` in the attached TUI: the command must
		// enter plan mode on the backend (never prompt the local replica), and the
		// resulting `plan_proposed` must open the review overlay.
		void mode.getUserInput();
		term.sendInput("/plan Draft the web plan");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("/plan")));
		term.sendInput("\r");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("Approve and execute")));
		const review = plainRows(term.getViewport()).join("\n");
		expect(review).toContain("Approve and compact context");
		expect(review).toContain("Refine plan");

		// Approval dispatches into an idle session; wait for the plan turn's end.
		const idleDeadline = Date.now() + 20_000;
		while (backend.isStreaming && Date.now() < idleDeadline) await Bun.sleep(25);
		expect(backend.isStreaming).toBe(false);

		term.sendInput("\r");
		await term.waitForRender(() =>
			plainRows(term.getViewport()).some(row => row.includes("Executing the approved plan.")),
		);
		expect(backend.getPlanModeState()).toBeUndefined();
	}, 120_000);

	test("attaches across directories and forwards backend-capable slash commands", async () => {
		const backendCwd = process.cwd();
		const localCwd = path.join(tempDir.path(), "elsewhere");
		await Bun.write(path.join(localCwd, ".keep"), "");

		const model = createMockModel({ handler: { content: ["unused"] } });
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime(model.model.provider, "test-key");

		const backendManager = SessionManager.create(
			backendCwd,
			path.join(tempDir.path(), "sessions"),
			new FileSessionStorage(),
			{ client: "cli" },
		);
		backendManager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() } as never);
		backendSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
				streamFn: model.stream,
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

		// The client starts in a different workspace than the backend session.
		localSession = new AgentSession({
			agent: new Agent({
				initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
			}),
			sessionManager: SessionManager.create(localCwd, path.join(tempDir.path(), "local-sessions")),
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
		// A cross-directory attach adopts the backend workspace instead of
		// degrading to an in-process session (`SESSION_CWD_CHANGE_REJECTED`).
		await link.join();
		expect(link.attached).toBe(true);
		expect(path.resolve(mode.sessionManager.getCwd())).toBe(path.resolve(backendCwd));

		void mode.getUserInput();

		// A workflow whose runtime lives in the backend process is refused with
		// the host action that performs it.
		term.sendInput("/live");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("/live")));
		term.sendInput("\r");
		await term.waitForRender(() =>
			plainRows(term.getViewport()).some(row => row.includes("/live is not available while attached")),
		);
		const refusal = plainRows(term.getViewport()).join("\n");
		expect(refusal).toContain("owns the backend session");
		expect(link.attached).toBe(true);

		// A headless-capable builtin runs on the backend; its command_output is
		// rendered in the attached TUI.
		term.sendInput("/todo");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("/todo")));
		term.sendInput("\r");
		await term.waitForRender(() => plainRows(term.getViewport()).some(row => row.includes("No todos")));
		expect(plainRows(term.getViewport()).some(row => row.includes("No todos"))).toBe(true);

		// `/resume <id>` re-attaches the same client to a backend session, and a
		// loop started there is stopped before the client leaves it behind.
		await wrapper.send({ type: "loop_start", args: "3" });
		const loopDeadline = Date.now() + 5_000;
		while (Date.now() < loopDeadline && link.loopState?.enabled !== true) await Bun.sleep(50);
		expect(link.loopState).toMatchObject({ enabled: true });
		await link.reattach(sessionId);
		expect(link.attached).toBe(true);
		expect(link.sessionId).toBe(sessionId);
		expect(path.resolve(mode.sessionManager.getCwd())).toBe(path.resolve(backendCwd));
		const afterReattach = (await link.client.send(sessionId, { type: "get_state" })) as { loop?: unknown };
		expect(afterReattach.loop).toBeNull();

		// Auth surfaces: the backend answers provider/account queries over the
		// socket the same way the local TUI's pickers do.
		expect(Array.isArray(await link.getLoginProviders())).toBe(true);

		// `/clear` drops the backend context but keeps the session id.
		const dropped = await link.clearContext();
		expect(dropped).toBeGreaterThanOrEqual(0);
		expect(link.sessionId).toBe(sessionId);

		// `/fork` moves both sides to the forked session; `/delete` starts a fresh
		// one and drops the old transcript.
		const forked = await link.forkSession();
		expect(forked).not.toBe(sessionId);
		expect(link.sessionId).toBe(forked);
		const replacement = await link.deleteSession();
		expect(replacement).not.toBe(forked);
		expect(link.attached).toBe(true);
	}, 120_000);
});
