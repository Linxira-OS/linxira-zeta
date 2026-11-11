/**
 * Contracts for input priority and IME cursor anchoring:
 * 1. A frame a keystroke is waiting on skips the adaptive render floor, so a
 *    slow animation frame cannot turn into 200 ms of typing latency.
 * 2. Cursor positioning/visibility stays inside the synchronized-output block,
 *    so a repaint never exposes a hidden hardware cursor (the IME anchor).
 * 3. Focus reports re-assert terminal input modes and never reach the focused
 *    component as typed text.
 */
import { describe, expect, it } from "bun:test";
import { type Component, Input, type RenderTimer, TUI } from "@linxiraos/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";
import { initTheme } from "@linxiraos/pi-tui/theme";

class CostProbe implements Component {
	#costMs = 0;
	scheduler!: { nowMs: number };
	scheduleCost(costMs: number): void {
		this.#costMs = costMs;
	}
	invalidate(): void {}
	render(): readonly string[] {
		if (this.#costMs > 0) {
			this.scheduler.nowMs += this.#costMs;
			this.#costMs = 0;
		}
		return ["probe"];
	}
}

class DeferredScheduler {
	nowMs = 0;
	readonly immediates: Array<() => void> = [];
	readonly timers: Array<{ callback: () => void; canceled: boolean; delayMs: number }> = [];
	now(): number {
		return this.nowMs;
	}
	scheduleImmediate(callback: () => void): void {
		this.immediates.push(callback);
	}
	scheduleRender(callback: () => void, delayMs: number): RenderTimer {
		const timer = { callback, canceled: false, delayMs };
		this.timers.push(timer);
		return { cancel: () => (timer.canceled = true) };
	}
}

function step(scheduler: DeferredScheduler): number | null {
	while (scheduler.immediates.length > 0) scheduler.immediates.shift()!();
	const timer = scheduler.timers.shift();
	if (!timer || timer.canceled) return null;
	scheduler.nowMs += timer.delayMs;
	timer.callback();
	return timer.delayMs;
}

class Recorder implements Component {
	readonly received: string[] = [];
	focused = false;
	invalidate(): void {}
	render(): readonly string[] {
		return [""];
	}
	handleInput(data: string): void {
		this.received.push(data);
	}
}

describe("TUI input priority", () => {
	it("skips the adaptive render floor for a keystroke-waiting frame", () => {
		const term = new VirtualTerminal(20, 4);
		const scheduler = new DeferredScheduler();
		const probe = new CostProbe();
		probe.scheduler = scheduler;
		const tui = new TUI(term, true, { renderScheduler: scheduler });
		tui.addChild(probe);
		try {
			tui.start();
			step(scheduler);
			scheduler.timers.length = 0;

			// One 150 ms frame arms the 200 ms adaptive floor.
			probe.scheduleCost(150);
			tui.requestRender();
			step(scheduler);
			scheduler.timers.length = 0;

			// Input arrives: the next frame must keep the 30 fps cadence, not
			// inherit the adaptive floor.
			tui.injectDebugInput("a");
			tui.requestRender();
			const delay = step(scheduler);
			expect(delay).not.toBeNull();
			expect(delay!).toBeLessThan(100);
		} finally {
			tui.stop();
		}
	});

	it("keeps cursor position and visibility inside the synchronized-output block", async () => {
		await initTheme();
		const term = new VirtualTerminal(40, 10);
		const tui = new TUI(term, true);
		const input = new Input();
		tui.addChild(input);
		tui.setFocus(input);
		const frames: string[] = [];
		const unsubscribe = tui.addFrameWriteListener(frame => frames.push(frame));
		try {
			tui.start();
			input.handleInput("a");
			tui.requestRender();
			await Bun.sleep(90);
			const frame = frames.at(-1);
			expect(frame).toBeDefined();
			const begin = frame!.indexOf("\x1b[?2026h");
			const hide = frame!.indexOf("\x1b[?25l");
			const show = frame!.indexOf("\x1b[?25h");
			const end = frame!.indexOf("\x1b[?2026l");
			if (begin !== -1) {
				expect(hide).toBeGreaterThan(begin);
				expect(show).toBeGreaterThan(hide);
				expect(end).toBeGreaterThan(show);
			}
		} finally {
			unsubscribe();
			tui.stop();
		}
	});

	it("re-asserts input modes on focus-in without forwarding the report", () => {
		const term = new VirtualTerminal(20, 4);
		let reasserts = 0;
		(term as unknown as { reassertInputModes?: () => void }).reassertInputModes = () => {
			reasserts += 1;
		};
		const tui = new TUI(term, true);
		const recorder = new Recorder();
		tui.addChild(recorder);
		tui.setFocus(recorder);
		try {
			tui.start();
			tui.injectDebugInput("\x1b[I");
			expect(reasserts).toBe(1);
			expect(recorder.received).toEqual([]);
			tui.injectDebugInput("\x1b[O");
			expect(reasserts).toBe(1);
			expect(recorder.received).toEqual([]);
		} finally {
			tui.stop();
		}
	});
});
