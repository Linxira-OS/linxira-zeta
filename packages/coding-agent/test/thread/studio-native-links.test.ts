/**
 * Extension links stay with the session whose extensions own them: a native
 * session dispatches through its own runner and UI context, a worker-homed
 * view publishes those schemes, and main's mirror routes the click back to the
 * home session instead of an ancestor's runner.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import type { Model } from "@linxiraos/pi-ai";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { Agent } from "@linxiraos/pi-agent-core";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import type { ExtensionRunner, ExtensionUIContext } from "../../src/extensibility/extensions";
import { ExtensionRuntime } from "../../src/extensibility/extensions/loader";
import { ExtensionRunner as Runner } from "../../src/extensibility/extensions/runner";
import { AgentRegistry, MAIN_AGENT_ID } from "../../src/registry/agent-registry";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { currentThreadId } from "../../src/thread/identity";
import { RemoteAgentSession } from "../../src/thread/remote-agent-session";
import type { SessionBridgeClient, SessionOpened, SessionViewState } from "../../src/thread/session-mirror";
import { SessionPublisher, SESSION_HOST_SERVE } from "../../src/thread/session-publisher";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "../helpers/settings-test-state";

const TEST_MODEL: Model = buildModel({
	provider: "mock",
	id: "studio-links",
	name: "Studio Links",
	api: "openai-completions",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
});

let settingsState: SettingsTestState | undefined;
let auth: AuthStorage | undefined;
let session: AgentSession | undefined;

beforeEach(() => {
	settingsState = beginSettingsTest();
	AgentRegistry.resetGlobalForTests();
});

afterEach(async () => {
	await session?.dispose();
	session = undefined;
	auth?.close();
	auth = undefined;
	AgentRegistry.resetGlobalForTests();
	restoreSettingsTestState(settingsState);
	settingsState = undefined;
});

describe("studio extension links", () => {
	test("native dispatch and worker mirror stay on the owning session's runner", async () => {
		await Settings.init({ inMemory: true });
		auth = await AuthStorage.create(":memory:");
		const registry = new ModelRegistry(auth, "/nonexistent/studio-links/models.yml");
		const sessionManager = SessionManager.inMemory();
		const ownUi = { marker: "own-ui" } as unknown as ExtensionUIContext;
		const dispatch: Array<{ url: string; ui: ExtensionUIContext | undefined }> = [];
		const ownRunner = new Runner(
			[],
			new ExtensionRuntime(),
			process.cwd(),
			sessionManager,
			registry,
		) as ExtensionRunner;
		const schemes = vi.spyOn(ownRunner, "getLinkSchemes").mockReturnValue(["native-test"]);
		vi.spyOn(ownRunner, "getUIContext").mockReturnValue(ownUi);
		vi.spyOn(ownRunner, "emitLinkActivate").mockImplementation(async (url, ui) => {
			dispatch.push({ url, ui });
			return true;
		});

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: TEST_MODEL, systemPrompt: ["Studio links"], tools: [], messages: [] },
			streamFn: createMockModel({ responses: [] }).stream,
		});
		session = new AgentSession({
			agent,
			sessionManager,
			modelRegistry: registry,
			settings: Settings.isolated({ "compaction.enabled": false }),
			extensionRunner: ownRunner,
			agentId: "worker",
		});

		// Native: own runner, own UI context, no bypass argument.
		expect(session.getStudioLinkSchemes()).toEqual(["native-test"]);
		expect(await session.activateStudioLink("native-test:details/1")).toBe(true);
		expect(schemes.mock.calls).toEqual([[]]);
		expect(dispatch).toEqual([{ url: "native-test:details/1", ui: ownUi }]);

		// Worker side: the publisher snapshots the home session's own schemes.
		const notes: Array<{ method: string; args: unknown[] }> = [];
		const bridge = {
			remote: {
				id: 1,
				notify: (method: string, ...args: unknown[]) => notes.push({ method, args }),
				call: async () => undefined,
				callSync: () => [],
			},
		} as unknown as SessionBridgeClient;
		const publisher = new SessionPublisher(session, bridge);
		publisher.watch(true);
		const viewNote = notes.findLast(note => note.method === "view");
		expect(viewNote).toBeDefined();
		const [, view, entries] = viewNote!.args as [string, SessionViewState, unknown];
		expect(view.studioLinkSchemes).toEqual(["native-test"]);

		// Main side: an ancestor runner with different schemes must not answer.
		const ancestorRunner = { getLinkSchemes: () => ["ancestor-only"] } as unknown as ExtensionRunner;
		AgentRegistry.global().register({
			id: MAIN_AGENT_ID,
			displayName: "Main",
			kind: "main",
			session: { instanceKey: `${currentThreadId()}:ancestor`, extensionRunner: ancestorRunner } as never,
		});
		const opened = notes.find(note => note.method === "opened")!.args[0] as SessionOpened;
		const routed: string[] = [];
		const host = {
			remote: {
				id: 2,
				call: async (method: string, ...args: unknown[]) => {
					routed.push(method);
					return SESSION_HOST_SERVE.activateStudioLink(publisher, args[0] as string);
				},
				notify: () => {},
				callSync: () => [],
			},
		} as never;
		const mirror = new RemoteAgentSession({
			key: session.instanceKey,
			home: "w1",
			agentId: "worker",
			host,
			state: opened.state,
			messages: opened.messages,
		});
		mirror.applyView(view, entries as never);
		expect(mirror.extensionRunner).toBe(ancestorRunner);
		expect(mirror.getStudioLinkSchemes()).toEqual(["native-test"]);
		expect(await mirror.activateStudioLink("native-test:details/2")).toBe(true);
		expect(routed).toEqual(["activateStudioLink"]);
		expect(dispatch.at(-1)).toEqual({ url: "native-test:details/2", ui: ownUi });

		// Disposal on either side stops dispatch instead of reaching a handler.
		mirror.close("test closed");
		expect(await mirror.activateStudioLink("native-test:details/3")).toBe(false);
		session.beginDispose();
		expect(await session.activateStudioLink("native-test:details/4")).toBe(false);
		expect(dispatch).toHaveLength(2);
	});
});
