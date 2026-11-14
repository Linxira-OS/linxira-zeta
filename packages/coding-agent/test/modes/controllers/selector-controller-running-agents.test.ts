import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { SessionSelectorComponent } from "@linxiraos/pi-tui/overlays/session-selector";
import { Settings } from "@linxiraos/zeta/config/settings";
import { SelectorController } from "@linxiraos/zeta/modes/controllers/selector-controller";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import type { SessionInfo } from "@linxiraos/zeta/session/session-listing";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

beforeAll(async () => {
	await initTheme();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const session: SessionInfo = {
	path: "/tmp/alpha.jsonl",
	id: "alpha",
	cwd: "/tmp",
	title: "Alpha",
	created: new Date("2026-01-01T00:00:00Z"),
	modified: new Date("2026-01-02T00:00:00Z"),
	messageCount: 1,
	size: 1,
	firstMessage: "alpha prompt",
	allMessagesText: "alpha prompt",
};

function createHarness() {
	const registry = new AgentRegistry();
	registry.register({
		id: "worker",
		displayName: "Worker",
		kind: "sub",
		parentId: "main",
		session: null,
		sessionFile: "/tmp/worker-agent.jsonl",
		status: "running",
		createdAt: Date.parse("2026-01-01T00:00:00Z"),
		activity: "reviewing the diff",
	});
	let focusedAgentId: string | undefined;
	let selector: SessionSelectorComponent | undefined;
	let hidden = false;
	const setHidden = vi.fn((value: boolean) => {
		hidden = value;
	});
	const hide = vi.fn();
	const switchSession = vi.fn(async () => true);
	const focusStarted = Promise.withResolvers<string>();
	const focusAgentSession = vi.fn(async (id: string) => {
		focusedAgentId = id;
		focusStarted.resolve(id);
	});
	const settings = Settings.isolated();
	const ctx = {
		agentRegistry: registry,
		settings,
		session: { switchSession },
		// The controller reads this getter to know when the observer has returned.
		get focusedAgentId() {
			return focusedAgentId;
		},
		focusAgentSession,
		sessionManager: {
			getCwd: () => "/tmp",
			getSessionDir: () => "/tmp",
			getSessionFile: () => null,
		},
		prepareSessionSwitch: vi.fn(async () => {}),
		resetObserverRegistry: vi.fn(),
		clearTransientSessionUi: vi.fn(),
		applyCwdChange: vi.fn(async () => true),
		updateEditorBorderColor: vi.fn(),
		renderInitialMessages: vi.fn(),
		reloadTodos: vi.fn(async () => {}),
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		statusLine: { invalidate: vi.fn(), resetActiveTime: vi.fn() },
		keybindings: { getKeys: () => [] },
		ui: {
			requestRender: vi.fn(),
			setFocus: vi.fn(),
			terminal: { rows: 40 },
			showOverlay: vi.fn((component: unknown) => {
				selector = component as SessionSelectorComponent;
				return { hide, setHidden, isHidden: () => hidden };
			}),
		},
		editor: {},
		editorContainer: { children: [{}], clear: vi.fn(), addChild: vi.fn() },
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		selector: () => selector,
		setHidden,
		hide,
		focusAgentSession,
		focusStarted: focusStarted.promise,
		switchSession,
		setFocusedAgent: (id: string | undefined) => {
			focusedAgentId = id;
		},
		registry,
	};
}

describe("SelectorController running-agent rows", () => {
	it("refreshes activity without registry events and stops refreshing after close", async () => {
		vi.useFakeTimers();
		vi.spyOn(SessionManager, "listForPicker").mockResolvedValue({
			sessions: [session],
			complete: Promise.resolve([session]),
		});
		const harness = createHarness();
		await new SelectorController(harness.ctx).showSessionSelector();
		const render = vi.spyOn(harness.ctx.ui, "requestRender");
		const selector = harness.selector()!;
		harness.registry.setActivity("worker", "verifying source ownership");
		vi.advanceTimersByTime(1000);
		expect(selector.render(120).join("\n")).toContain("verifying source ownership");
		selector.handleInput("\x1b");
		const before = render.mock.calls.length;
		harness.registry.setActivity("worker", "must not refresh a closed picker");
		vi.advanceTimersByTime(2000);
		expect(render.mock.calls.length).toBe(before);
	});

	it("focuses the existing observer and returns to the same picker state without resuming the worker", async () => {
		vi.spyOn(SessionManager, "listForPicker").mockResolvedValue({
			sessions: [session],
			complete: Promise.resolve([session]),
		});
		const harness = createHarness();
		const controller = new SelectorController(harness.ctx);

		await controller.showSessionSelector();
		const selector = harness.selector();
		expect(selector).toBeDefined();

		// Search selects the separate live-agent row, not a saved session.
		selector!.handleInput("worker");
		expect(selector!.getSessionList().selectedRunningAgent?.id).toBe("worker");
		expect(selector!.getSessionList().selectedSession).toBeUndefined();

		vi.useFakeTimers();
		selector!.handleInput("\r");
		await harness.focusStarted;
		await Promise.resolve();
		expect(harness.focusAgentSession).toHaveBeenCalledWith("worker");
		expect(harness.switchSession).not.toHaveBeenCalled();
		expect(harness.setHidden).toHaveBeenLastCalledWith(true);
		expect(harness.hide).not.toHaveBeenCalled();

		// Leaving the observer returns to the same picker: same query, same row.
		harness.setFocusedAgent(undefined);
		vi.advanceTimersByTime(250);
		expect(harness.setHidden).toHaveBeenLastCalledWith(false);
		expect(selector!.getSessionList().searchInput.getValue()).toBe("worker");
		expect(selector!.getSessionList().selectedRunningAgent?.id).toBe("worker");

		// Closing the restored picker releases its registry refresh hook.
		selector!.handleInput("\x1b");
		expect(harness.hide).toHaveBeenCalledTimes(1);
		const refresh = vi.spyOn(selector!, "refreshRunningAgents");
		harness.registry.register({
			id: "other-worker",
			displayName: "Other worker",
			kind: "sub",
			parentId: "main",
			session: null,
			status: "running",
		});
		expect(refresh).not.toHaveBeenCalled();
	});

	it("keeps the picker visible when focus resolves without taking the view", async () => {
		vi.spyOn(SessionManager, "listForPicker").mockResolvedValue({
			sessions: [session],
			complete: Promise.resolve([session]),
		});
		const harness = createHarness();
		// A focus request can resolve without setting the view; hiding the
		// picker here would bounce back on the watcher's first tick.
		harness.focusAgentSession.mockImplementation(async () => {});
		const controller = new SelectorController(harness.ctx);

		await controller.showSessionSelector();
		const selector = harness.selector()!;
		selector.handleInput("worker");
		selector.handleInput("\r");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.setHidden).not.toHaveBeenCalledWith(true);
		expect(harness.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("did not take over"));
		expect(harness.switchSession).not.toHaveBeenCalled();
		selector.handleInput("\x1b");
		expect(harness.hide).toHaveBeenCalledTimes(1);
	});

	it("stops the stale row before focus when its registry generation was replaced", async () => {
		vi.spyOn(SessionManager, "listForPicker").mockResolvedValue({
			sessions: [session],
			complete: Promise.resolve([session]),
		});
		const harness = createHarness();
		const controller = new SelectorController(harness.ctx);

		await controller.showSessionSelector();
		const selector = harness.selector()!;
		selector.handleInput("worker");
		const staleRow = selector.getSessionList().selectedRunningAgent;
		expect(staleRow).toBeDefined();
		if (!staleRow) throw new Error("expected a selected running-agent row");

		// Reuse the id with a newer registry generation while the picker still
		// holds the old row object. Suppress the automatic row replacement so
		// the old row survives for this delayed activation path.
		vi.spyOn(selector, "setRunningAgents").mockImplementation(() => {});
		harness.registry.unregister("worker");
		harness.registry.register({
			id: "worker",
			displayName: "Worker",
			kind: "sub",
			parentId: "main",
			session: null,
			sessionFile: "/tmp/worker-agent.jsonl",
			status: "running",
			createdAt: Date.parse("2026-01-01T00:00:00Z"),
			activity: "new run",
		});
		selector.handleInput("\r");
		await Promise.resolve();

		expect(harness.focusAgentSession).not.toHaveBeenCalled();
		expect(harness.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("no longer running"));
		expect(harness.switchSession).not.toHaveBeenCalled();
		selector.dispose();
	});
});
