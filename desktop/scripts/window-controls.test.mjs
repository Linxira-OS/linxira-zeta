/**
 * Caption-button behavior for the desktop shell.
 *
 * The renderer owns the buttons; `main.ts` owns the act. This pins the act:
 * minimize, one-button maximize/restore, close (which still goes through the
 * window's closer so minimize-to-tray policy applies), and the state push.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	WINDOW_CONTROL_CHANNELS,
	liveWindow,
	runWindowControl,
	windowState,
} from "../src/window-controls.ts";

function fakeWindow({ maximized = false, destroyed = false } = {}) {
	const calls = [];
	const win = {
		isDestroyed: () => destroyed,
		isMaximized: () => maximized,
		minimize: () => calls.push("minimize"),
		maximize: () => calls.push("maximize"),
		unmaximize: () => calls.push("unmaximize"),
		close: () => calls.push("close"),
	};
	return { win, calls };
}

test("minimize hands the action to the window", () => {
	const { win, calls } = fakeWindow();
	runWindowControl(win, "minimize");
	assert.deepEqual(calls, ["minimize"]);
});

test("maximize is a toggle: maximize when restored, unmaximize when maximized", () => {
	const restored = fakeWindow({ maximized: false });
	runWindowControl(restored.win, "maximize");
	assert.deepEqual(restored.calls, ["maximize"]);

	const maximized = fakeWindow({ maximized: true });
	runWindowControl(maximized.win, "maximize");
	assert.deepEqual(maximized.calls, ["unmaximize"]);
});

test("close goes through close() so minimize-to-tray policy still applies", () => {
	const { win, calls } = fakeWindow();
	runWindowControl(win, "close");
	assert.deepEqual(calls, ["close"]);
});

test("a destroyed or missing window is a no-op on every action", () => {
	const destroyed = fakeWindow({ destroyed: true });
	for (const action of ["minimize", "maximize", "close"]) {
		runWindowControl(destroyed.win, action);
		runWindowControl(null, action);
	}
	assert.deepEqual(destroyed.calls, []);
	assert.equal(liveWindow(null), null);
	assert.equal(liveWindow(destroyed.win), null);
});

test("window state reports the live maximize flag and false once gone", () => {
	assert.deepEqual(windowState(fakeWindow({ maximized: true }).win), { maximized: true });
	assert.deepEqual(windowState(fakeWindow({ maximized: false }).win), { maximized: false });
	assert.deepEqual(windowState(null), { maximized: false });
	assert.deepEqual(windowState(fakeWindow({ destroyed: true }).win), { maximized: false });
});

