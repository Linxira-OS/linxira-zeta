import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import * as fsp from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import {
	sharedSpinnerTickerArmed,
	stopSharedSpinnerTicker,
	ToolExecutionComponent,
} from "@linxiraos/pi-tui/chat/tool-execution";
import { TranscriptContainer } from "@linxiraos/pi-tui/chrome/transcript-container";
import {
	DEFAULT_SPINNER_INTERVAL_MS,
	setSpinnerInterval,
	SPINNER_INTERVAL_STATIC,
} from "@linxiraos/pi-tui/spinner-clock";
import { EventController } from "@linxiraos/zeta/modes/controllers/event-controller";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { UiHelpers } from "@linxiraos/zeta/modes/utils/ui-helpers";
import type { AgentSessionEvent } from "@linxiraos/zeta/session/agent-session";
import type { TUI } from "@linxiraos/pi-tui";
import { createInteractiveModeContext } from "../../helpers/interactive-mode-context";

/**
 * Starts watching the shared spinner ticker; the returned probe reports whether
 * its interval is still armed. Other intervals on the same fake clock make
 * `vi.getTimerCount()` unable to isolate the ticker. Call after
 * `vi.useFakeTimers()` and before any live block registers.
 */
function watchSpinnerTicker(): () => boolean {
	const arm = spyOn(globalThis, "setInterval");
	const clear = spyOn(globalThis, "clearInterval");
	return () =>
		arm.mock.calls.some(([, ms], index) => {
			if (ms !== DEFAULT_SPINNER_INTERVAL_MS) return false;
			const timer = arm.mock.results[index]?.value;
			return !clear.mock.calls.some(([cleared]) => cleared === timer);
		});
}

// Contract under test: live tool previews that render a pending/running status
// must keep the spinner glyph tied to the shared tool-frame ticker. This covers
// both the shared ToolExecutionComponent interval and renderer-local caches that
// would otherwise keep serving the first pending frame.
describe("ToolExecutionComponent live preview spinners", () => {
	beforeAll(async () => {
		await initTheme();
	});

	// Earlier test files may leak live blocks (components never stopAnimation'd),
	// which keeps the shared ticker armed on a REAL interval and makes these
	// fake-timer assertions observe a pre-existing timer instead of a fresh one.
	beforeEach(() => {
		stopSharedSpinnerTicker();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		resetSettingsForTest();
	});

	it("animates the eval pending cell while the call is live", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"eval",
			{ language: "py", code: "import time\ntime.sleep(10)" },
			{},
			undefined,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			const firstFrame = stripVTControlCharacters(component.render(80).join("\n"));
			vi.advanceTimersByTime(120);
			const secondFrame = stripVTControlCharacters(component.render(80).join("\n"));

			expect(requestComponentRender).toHaveBeenCalledWith(component);
			expect(requestRender).not.toHaveBeenCalled();
			expect(firstFrame).toContain("time.sleep(10)");
			expect(secondFrame).toContain("time.sleep(10)");
			expect(secondFrame).not.toBe(firstFrame);
		} finally {
			component.stopAnimation();
		}
	});

	it("does not tick headerless bash pending previews", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "sleep 600" },
			{},
			undefined,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			requestRender.mockClear();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(500);
			expect(requestRender).not.toHaveBeenCalled();
			expect(requestComponentRender).not.toHaveBeenCalled();
		} finally {
			component.stopAnimation();
		}
	});

	it("repaints a running bash call once a second so its elapsed time advances", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "sleep 600" },
			{},
			undefined,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			component.setExecutionStarted();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(3_000);
			// One repaint per second, not the 30fps spinner cadence.
			expect(requestComponentRender).toHaveBeenCalledTimes(3);
			component.seal();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(3_000);
			expect(requestComponentRender).not.toHaveBeenCalled();
		} finally {
			component.stopAnimation();
		}
	});

	it("does not tick detached async bash result snapshots", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "sleep 600", async: true },
			{},
			undefined,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			component.updateResult(
				{
					content: [{ type: "text", text: "started background job" }],
					details: {
						command: "sleep 600",
						async: { state: "running", jobId: "job-1", type: "bash" },
					},
				},
				true,
			);
			requestRender.mockClear();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(500);
			expect(requestRender).not.toHaveBeenCalled();
			expect(requestComponentRender).not.toHaveBeenCalled();
		} finally {
			component.stopAnimation();
		}
	});

	it("does not tick github pending previews whose Text is materialized per rebuild", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"github",
			{ op: "run_watch", run: "12345" },
			{},
			undefined,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			requestRender.mockClear();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(500);
			expect(requestRender).not.toHaveBeenCalled();
			expect(requestComponentRender).not.toHaveBeenCalled();
		} finally {
			component.stopAnimation();
		}
	});

	it("does not tick custom tools whose pending label is a static tool-name Text", () => {
		vi.useFakeTimers({ now: 0 });
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		// A renderResult-only custom tool renders the static tool-name label
		// while pending, so the spinner interval must not start.
		const tool = { name: "ext_tool", renderResult: () => undefined };
		const component = new ToolExecutionComponent(
			"ext_tool",
			{ input: 1 },
			{},
			tool as never,
			{ requestRender, requestComponentRender } as unknown as TUI,
			process.cwd(),
		);

		try {
			requestRender.mockClear();
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(500);
			expect(requestRender).not.toHaveBeenCalled();
			expect(requestComponentRender).not.toHaveBeenCalled();
		} finally {
			component.stopAnimation();
		}
	});

	// Regression (issue #8731): concurrent live tool blocks — e.g. parallel task
	// subagents — must share ONE spinner timer, not one per block, or active-work
	// CPU scales with block count.
	it("drives every concurrent live block from a single shared spinner timer", () => {
		vi.useFakeTimers({ now: 0 });
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const renders = [vi.fn(), vi.fn(), vi.fn()];
		const components = renders.map(
			requestComponentRender =>
				new ToolExecutionComponent(
					"eval",
					{ language: "py", code: "import time\ntime.sleep(10)" },
					{},
					undefined,
					{ requestRender: vi.fn(), requestComponentRender } as unknown as TUI,
					process.cwd(),
				),
		);

		try {
			// One shared ticker for all three live blocks, not three: a single timer armed for the
			// shared clock's next boundary (a full period from t=0).
			const spinnerTimers = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === DEFAULT_SPINNER_INTERVAL_MS).length;
			expect(spinnerTimers).toBe(1);

			// A single tick repaints every registered block in lockstep.
			vi.advanceTimersByTime(DEFAULT_SPINNER_INTERVAL_MS);
			for (const requestComponentRender of renders) {
				expect(requestComponentRender).toHaveBeenCalledTimes(1);
			}
		} finally {
			for (const component of components) component.stopAnimation();
		}
	});

	it("follows the shared spinner clock: a slower interval spaces the ticks, static stops them until animation resumes", () => {
		vi.useFakeTimers({ now: 0 });
		setSpinnerInterval(1000);
		const requestComponentRender = vi.fn();
		const component = new ToolExecutionComponent(
			"eval",
			{ language: "py", code: "import time\ntime.sleep(10)" },
			{},
			undefined,
			{ requestRender: vi.fn(), requestComponentRender } as unknown as TUI,
			process.cwd(),
		);
		try {
			requestComponentRender.mockClear();
			vi.advanceTimersByTime(999);
			expect(requestComponentRender).toHaveBeenCalledTimes(0);
			vi.advanceTimersByTime(1);
			expect(requestComponentRender).toHaveBeenCalledTimes(1);

			// Static: the armed tick paints frame 0, then no timer runs.
			setSpinnerInterval(SPINNER_INTERVAL_STATIC);
			vi.advanceTimersByTime(1000);
			expect(requestComponentRender).toHaveBeenCalledTimes(2);
			vi.advanceTimersByTime(10_000);
			expect(requestComponentRender).toHaveBeenCalledTimes(2);
			expect(sharedSpinnerTickerArmed()).toBe(false);

			// Animated again: the ticker restarts at the new period.
			setSpinnerInterval(DEFAULT_SPINNER_INTERVAL_MS);
			vi.advanceTimersByTime(DEFAULT_SPINNER_INTERVAL_MS);
			expect(requestComponentRender).toHaveBeenCalledTimes(3);
		} finally {
			setSpinnerInterval(DEFAULT_SPINNER_INTERVAL_MS);
			component.stopAnimation();
		}
	});

	it("renders generic three-, two-, one-, and zero-row presentations", () => {
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "bun test packages/tui" },
			{},
			undefined,
			{ requestRender: vi.fn(), requestComponentRender: vi.fn() } as unknown as TUI,
			process.cwd(),
		);
		try {
			component.setTranscriptAllocation(3, { tick: 0, now: 0 });
			const full = component.render(80);
			component.setTranscriptAllocation(2, { tick: 1, now: 80 });
			const folded = component.render(80);
			component.setTranscriptAllocation(1, { tick: 3, now: 240 });
			const compact = component.render(80);
			component.setTranscriptAllocation(0, { tick: 4, now: 320 });

			expect(full.length).toBeGreaterThanOrEqual(3);
			expect(folded).toHaveLength(2);
			expect(stripVTControlCharacters(folded.join("\n"))).toContain("bun test packages/tui");
			expect(compact).toHaveLength(1);
			expect(stripVTControlCharacters(compact[0]!)).toContain("bash · bun test packages/tui");
			expect(component.render(80)).toEqual([]);
		} finally {
			component.stopAnimation();
		}
	});

	it("shows elapsed time only while a compact fallback is running", () => {
		vi.spyOn(performance, "now").mockReturnValue(1_000);
		const component = new ToolExecutionComponent(
			"ext_tool",
			{},
			{},
			{ name: "ext_tool", label: "Catalog" } as never,
			{ requestRender: vi.fn(), requestComponentRender: vi.fn() } as unknown as TUI,
			process.cwd(),
		);
		try {
			component.setExecutionStarted();
			component.setTranscriptAllocation(1, { tick: 27, now: 3_200 });
			const running = stripVTControlCharacters(component.render(24)[0] ?? "");
			expect(running).toContain("Catalog · running 2s");
			expect(Bun.stringWidth(running)).toBeLessThanOrEqual(24);

			component.updateResult({ content: [{ type: "text", text: "done" }] }, false);
			const settled = stripVTControlCharacters(component.render(24)[0] ?? "");
			expect(settled).toContain("Catalog");
			expect(settled).not.toContain("running");
			expect(settled).not.toMatch(/\d+s$/);
			expect(Bun.stringWidth(settled)).toBeLessThanOrEqual(24);
		} finally {
			component.stopAnimation();
		}
	});

	it("gives extension tools a readable compact fallback", () => {
		const component = new ToolExecutionComponent(
			"ext_tool",
			{ input: "processing catalog" },
			{},
			{ name: "ext_tool", label: "Catalog" } as never,
			{ requestRender: vi.fn(), requestComponentRender: vi.fn() } as unknown as TUI,
			process.cwd(),
		);
		try {
			component.setTranscriptAllocation(1, { tick: 0, now: 0 });
			const row = stripVTControlCharacters(component.render(30)[0] ?? "");
			expect(row).toContain("Catalog · processing");
			expect(Bun.stringWidth(row)).toBeLessThanOrEqual(30);
		} finally {
			component.stopAnimation();
		}
	});
	// Regression: a live coordination call whose streamed args have not parsed
	// yet folded to a contentless `╭─ …` / `╰` frame under viewport pressure. A
	// squeezed block keeps its real render whenever it fits the allocation;
	// only genuinely overflowing blocks fold.
	it("keeps the real render on squeezed wait blocks when it fits", () => {
		const component = new ToolExecutionComponent(
			"wait",
			{},
			{},
			{ name: "wait", label: "Wait" } as never,
			{ requestRender: vi.fn(), requestComponentRender: vi.fn() } as unknown as TUI,
			process.cwd(),
		);
		try {
			component.setTranscriptAllocation(2, { tick: 0, now: 0 });
			const pending = component.render(80).map(row => stripVTControlCharacters(row));
			expect(pending).toHaveLength(1);
			expect(pending[0]).toContain("Wait");
			expect(pending[0]).not.toContain("╭");

			component.updateResult({ content: [{ type: "text", text: "done" }] }, false);
			const settled = component.render(80).map(row => stripVTControlCharacters(row));
			expect(settled.length).toBeLessThanOrEqual(2);
			expect(settled.join("\n")).toContain("done");
		} finally {
			component.stopAnimation();
		}
	});

	it("folds an overflowing squeezed wait block to a single labeled frame", () => {
		const component = new ToolExecutionComponent(
			"wait",
			{},
			{},
			{ name: "wait", label: "Wait" } as never,
			{ requestRender: vi.fn(), requestComponentRender: vi.fn() } as unknown as TUI,
			process.cwd(),
		);
		try {
			component.updateResult({ content: [{ type: "text", text: "line1\nline2\nline3\nline4" }] }, false);
			component.setTranscriptAllocation(1, { tick: 0, now: 0 });
			const folded = component.render(80).map(row => stripVTControlCharacters(row));
			expect(folded).toHaveLength(1);
			expect(folded[0]).toContain("Wait");
		} finally {
			component.stopAnimation();
		}
	});

	// Regression (PR #9377 follow-up, codex review): `#handleToolExecutionEnd`
	// settles a displaceable `wait`/`todo` result out of `pendingTools` into
	// EventController's own trackers (`#displaceablePollComponent` /
	// `#displaceableTodoComponent`) instead of leaving it there, so enumerating
	// only `pendingTools` before a resync misses that still-animated "waiting"
	// card entirely: `#finalizeSnapshot` must fold in
	// `eventController.takeDisplaceableComponents()` too, or its ticker
	// registration survives the failed resync with no remaining reference to
	// stop it.
	// A later codex pass on this test flagged that stubbing
	// `takeDisplaceableComponents()` to hand back a manually built block only
	// proves `#finalizeSnapshot` calls whatever function sits at that name --
	// not that the real tracker holds and clears the right component -- so
	// this drives an actual `wait` (still running, so it stays
	// displaceable) through a real `EventController`, the same tracker
	// `job-poll-displacement.test.ts` exercises in isolation.

	// Regression (PR #9377 follow-up, codex review): every orphaned block in
	// this rollback path -- from `pendingTools` or from
	// `eventController.takeDisplaceableComponents()` -- is still a live,
	// rendered row in the untouched visible container. Calling `dispose()` on
	// it propagates teardown to its own renderer children
	// (`Container.dispose()`), releasing resources a still-visible row's
	// children may use. Only `seal()`, which stops the shared-ticker
	// registration without touching children, is safe here.
});
