/**
 * A run stays open while a child agent can still wake it, and ends on its own
 * once that child stops without writing back: no idle run state, no `agent_end`
 * in between, and no consumer-side watch needed to notice the child going away.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import type { AgentSessionHandle } from "@linxiraos/zeta/session/agent-session-handle";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";

describe("AgentSession run held open by a child agent", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let registry: AgentRegistry;
	let session: AgentSession;
	let runEvents: string[];
	let runStates: string[];

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-run-wake-sources-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic test model");
		const mock = createMockModel({ handler: () => ({ content: ["Asked the child; waiting for its reply."] }) });
		registry = new AgentRegistry();
		session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: ["Test"], tools: [] },
				streamFn: mock.stream,
			}),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
			agentId: "Main",
			agentRegistry: registry,
		});
		runEvents = [];
		runStates = [];
		session.subscribe(event => {
			if (event.type === "agent_pause") runEvents.push(`pause:${event.yielded}`);
			if (event.type === "agent_end") runEvents.push("end");
		});
		session.subscribeRunState(state => runStates.push(state));
	});

	afterEach(async () => {
		await session.dispose();
		authStorage.close();
		tempDir.removeSync();
	});

	/** A child of Main whose own run is open (peer-woken: no job tracks it). */
	function registerRunningChild(): void {
		// Only the run-open corroboration `registry.isRunning` reads matters here.
		const childSession = { runStartedAt: Date.now() } as unknown as AgentSessionHandle;
		registry.register({ id: "Child", displayName: "Child", kind: "sub", parentId: "Main", session: childSession });
	}

	it("pauses while the child runs and ends once the child stops without replying", async () => {
		registerRunningChild();

		await session.prompt("Ask the child, then wait");
		await session.waitForIdle();
		await Promise.resolve();

		expect(runEvents).toEqual(["pause:true"]);
		expect(runStates).toEqual(["running"]);
		expect(session.isRunActive).toBe(true);
		expect(session.wakeSources?.agents).toEqual(["Child"]);

		// The child's run ends without a message to Main: nothing can wake Main's run any more.
		registry.setStatus("Child", "idle");
		await session.waitForRunEnd();

		expect(runEvents).toEqual(["pause:true", "end"]);
		expect(runStates).toEqual(["running", "idle"]);
		expect(session.isRunActive).toBe(false);
	});

	it("does not wait for a child that is itself blocked until Main acts", async () => {
		registerRunningChild();
		const release = registry.awaits.hold("Child", ["Main"], { interruptible: true });
		try {
			await session.prompt("Ask the child, then wait");
			await session.waitForRunEnd();

			expect(runEvents).toEqual(["end"]);
			expect(runStates).toEqual(["running", "idle"]);
		} finally {
			release();
		}
	});

	it("publishes terminal completion only after the host snapshot is durable", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		session.setAfterUserTurn(async () => {
			entered.resolve();
			await release.promise;
		});
		let promptSettled = false;
		const turn = session.prompt("Capture the completed turn").then(() => {
			promptSettled = true;
		});
		await entered.promise;
		let idleSettled = false;
		const idle = session.waitForIdle().then(() => {
			idleSettled = true;
		});
		try {
			// Let the idle barrier run through its already-idle core and event queues.
			await Bun.sleep(0);
			expect(promptSettled).toBe(false);
			expect(idleSettled).toBe(false);
			expect(runEvents).toEqual([]);
			expect(runStates).toEqual(["running"]);
			expect(session.isRunActive).toBe(true);
		} finally {
			release.resolve();
		}
		await Promise.all([turn, idle]);
		expect(runEvents).toEqual(["end"]);
		expect(runStates).toEqual(["running", "idle"]);
	});

	it("does not publish an abandoned run when its host snapshot finishes late", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		session.setAfterUserTurn(async () => {
			entered.resolve();
			await release.promise;
		});
		const turn = session.prompt("Capture before disposal");
		await entered.promise;
		try {
			await session.dispose();
			await session.waitForRunEnd();
			expect(runEvents).toEqual([]);
		} finally {
			release.resolve();
		}
		await turn;
		expect(runEvents).toEqual([]);
		expect(session.isRunActive).toBe(false);
	});
});
