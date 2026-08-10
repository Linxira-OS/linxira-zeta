import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { postmortem, TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { initTheme } from "@linxiraos/zeta/modes/theme/theme";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("InteractiveMode long shutdown status", () => {
	let authStorage: AuthStorage;
	let mode: InteractiveMode;
	let session: AgentSession;
	let tempDir: TempDir;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@omp-still-closing-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("expected bundled model");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
		mode.ui.requestRender = vi.fn();
		mode.ui.terminal.drainInput = async () => {};
		vi.spyOn(postmortem, "quit").mockResolvedValue(undefined);
	});

	afterEach(async () => {
		vi.useRealTimers();
		mode.stop();
		vi.restoreAllMocks();
		await session.dispose();
		authStorage.close();
		tempDir.removeSync();
		resetSettingsForTest();
	});

	it("refreshes the existing status while teardown remains pending", async () => {
		vi.useFakeTimers();
		const statuses: string[] = [];
		vi.spyOn(mode, "showStatus").mockImplementation(message => {
			statuses.push(message);
		});
		const teardown = Promise.withResolvers<void>();
		vi.spyOn(session, "dispose").mockImplementation(() => teardown.promise);

		const shutdown = mode.shutdown();
		await flushMicrotasks();
		expect(statuses).toEqual(["Closing session…"]);

		vi.advanceTimersByTime(2_999);
		await flushMicrotasks();
		expect(statuses).toEqual(["Closing session…"]);
		vi.advanceTimersByTime(1);
		await flushMicrotasks();
		expect(statuses).toEqual(["Closing session…", "Still closing… (flushing memory backend / network)"]);

		teardown.resolve();
		await shutdown;
		vi.advanceTimersByTime(10_000);
		await flushMicrotasks();
		expect(statuses).toHaveLength(2);
	});
});
