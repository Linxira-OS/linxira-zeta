/**
 * Caption-button behavior for the desktop shell.
 *
 * The renderer owns the buttons; `main.ts` owns the act. This pins the act:
 * minimize, one-button maximize/restore, close (which still goes through the
 * window's closer so minimize-to-tray policy applies), and the state push.
 * It also pins the IPC channel names on BOTH sides, because the sandboxed
 * preload cannot import `src/window-controls.ts` and a rename in only one file
 * would leave the titlebar silently dead.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
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

test("the channel map is unique and namespaced to the shell", () => {
	const channels = Object.values(WINDOW_CONTROL_CHANNELS);
	assert.equal(new Set(channels).size, channels.length);
	for (const channel of channels) assert.match(channel, /^pi:window-(minimize|maximize|close|state)$/);
});

test("main and preload use the pinned window-control channels", () => {
	const desktop = path.join(import.meta.dirname, "..", "src");
	const main = fs.readFileSync(path.join(desktop, "main.ts"), "utf8");
	const preload = fs.readFileSync(path.join(desktop, "preload.ts"), "utf8");

	// No channel is left as a literal in main.ts: every handler reads the map.
	for (const [action, channel] of Object.entries(WINDOW_CONTROL_CHANNELS)) {
		assert.ok(main.includes(`WINDOW_CONTROL_CHANNELS.${action}`), `main.ts does not register ${action} through the channel map`);
		assert.ok(!main.includes(`"${channel}"`), `main.ts still hardcodes ${channel}`);
		assert.ok(preload.includes(`"${channel}"`), `preload.ts does not invoke ${channel}`);
	}
});

test("preload exposes the three caption actions plus state helpers", () => {
	const preload = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "preload.ts"), "utf8");
	for (const entry of ["minimize:", "maximize:", "close:", "isMaximized:", "onWindowState:"]) {
		assert.ok(preload.includes(entry), `preload bridge is missing ${entry}`);
	}
});
