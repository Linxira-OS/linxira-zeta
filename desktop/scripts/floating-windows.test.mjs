import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { registerFloatingWindows, visibleWindowBounds } from "../dist/floating-windows.js";
import { FLOAT_WINDOW_CHANNELS as channels } from "../dist/floating-windows-shared.js";

// Behavioral cases adapted from official apps/desktop/test/floating-windows.test.ts.
class Contents extends EventEmitter {
  url = "http://127.0.0.1:43141/"; mainFrame = {}; events = []; throttled = true;
  getURL() { return this.url; }
  getZoomFactor() { return 1.25; }
  isDestroyed() { return false; }
  send(_channel, event) { this.events.push(event); }
  setBackgroundThrottling(value) { this.throttled = value; }
  setWindowOpenHandler(handler) { this.handler = handler; }
}
class Window extends EventEmitter {
  webContents = new Contents(); shown = false; minimized = false; maximized = false; destroyed = false; topmost = false; focused = false;
  getContentBounds() { return { x: 20, y: 20, width: 1200, height: 800 }; }
  getNormalBounds() { return { x: 100, y: 100, width: 600, height: 400 }; }
  isVisible() { return this.shown; }
  isMinimized() { return this.minimized; }
  isMaximized() { return this.maximized; }
  isDestroyed() { return this.destroyed; }
  show() { this.shown = true; this.emit("show"); }
  hide() { this.shown = false; this.emit("hide"); }
  focus() { this.focused = true; }
  restore() { this.minimized = false; this.emit("restore"); }
  minimize() { this.minimized = true; this.emit("minimize"); }
  maximize() { this.maximized = true; this.emit("maximize"); }
  unmaximize() { this.maximized = false; this.emit("unmaximize"); }
  setAlwaysOnTop(value) { this.topmost = value; }
  destroy() { this.destroyed = true; this.webContents.emit("destroyed"); this.emit("closed"); }
}
function fixture() {
  const parent = new Window(), handlers = new Map(), external = [];
  let quitting = false;
  const manager = registerFloatingWindows({ parent, ipcMain: { handle: (key, listener) => handlers.set(key, listener), removeHandler: key => handlers.delete(key) }, allowedOrigin: "http://127.0.0.1:43141", preloadPath: "preload.js", areas: () => [{ x: 0, y: 0, width: 1920, height: 1040 }], isQuitting: () => quitting, openExternal: url => external.push(url) });
  const call = (kind, input) => handlers.get(channels[kind])({ sender: parent.webContents, senderFrame: parent.webContents.mainFrame }, input);
  const input = { id: "real:group", title: "Terminal", topmost: false, minimized: false, maximized: false, sourceRect: { x: 80, y: 60, width: 640, height: 480 } };
  const ticket = call("prepare", input), creation = parent.webContents.handler({ url: ticket.url, frameName: ticket.key });
  const child = new Window(); child.webContents.url = ticket.url;
  parent.webContents.emit("did-create-window", child, { frameName: ticket.key });
  return { parent, child, handlers, manager, creation, external, call, input, ticket, control: (action, extra = {}) => call("control", { key: ticket.key, action, ...extra }), quit() { quitting = true; } };
}

test("independent floating panels remain interactive with hidden main and preserve sandbox preferences", () => {
  const f = fixture();
  try {
    assert.equal(f.creation.action, "allow");
    const options = f.creation.overrideBrowserWindowOptions;
    assert.equal(options.parent, undefined);
    assert.equal(options.width, 800); assert.equal(options.x, 120);
    assert.equal(options.webPreferences.sandbox, true);
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(options.webPreferences.nodeIntegration, false);
    f.control("ready"); f.parent.hide();
    assert.equal(f.child.isVisible(), true); assert.equal(f.parent.webContents.throttled, false);
    f.control("topmost", { topmost: true }); assert.equal(f.child.topmost, true);
    f.control("topmost", { topmost: false }); assert.equal(f.child.destroyed, false);
    f.control("minimize"); assert.equal(f.parent.webContents.throttled, true);
    f.control("focus"); assert.equal(f.child.minimized, false); assert.equal(f.child.focused, true);
    f.control("showMain"); assert.equal(f.parent.shown, true);
  } finally { f.manager.dispose(); }
});

test("native close requests panel handback, while quit keeps saved pins", () => {
  const f = fixture();
  try {
    f.control("ready"); let prevented = false;
    f.child.emit("close", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.child.destroyed, false);
    assert.equal(f.parent.webContents.events.at(-1).kind, "close-request");
    f.control("close"); assert.equal(f.child.destroyed, true); assert.equal(f.manager.hasWindows(), false);
  } finally { f.manager.dispose(); }
  const q = fixture();
  try {
    q.quit(); let prevented = false;
    q.child.emit("close", { preventDefault() { prevented = true; } });
    assert.equal(prevented, false); assert.equal(q.parent.webContents.events.some(event => event.kind === "close-request"), false);
  } finally { q.manager.dispose(); }
});

test("floating tickets reject foreign frames, URL substitution and stale opener documents", () => {
  const f = fixture();
  try {
    assert.throws(() => f.handlers.get(channels.prepare)({ sender: f.parent.webContents, senderFrame: {} }, f.input), /Untrusted/);
    assert.equal(f.parent.webContents.handler({ url: f.ticket.url + "&foreign=1", frameName: f.ticket.key }).action, "deny");
    assert.equal(f.parent.webContents.handler({ url: "file:///private", frameName: "private" }).action, "deny");
    assert.equal(f.external.length, 0);
    const duplicate = new Window(); f.parent.webContents.emit("did-create-window", duplicate, { frameName: f.ticket.key });
    assert.equal(duplicate.destroyed, true); assert.equal(f.child.destroyed, false);
    f.parent.webContents.emit("did-start-navigation", {}, "http://127.0.0.1:43141/", false, true);
    assert.equal(f.child.destroyed, true); assert.equal(f.manager.hasWindows(), false);
    assert.throws(() => f.control("focus"), /unavailable/);
  } finally { f.manager.dispose(); }
  assert.equal(f.handlers.size, 0); assert.equal(f.parent.webContents.listenerCount("did-start-navigation"), 0);
});

test("saved geometry survives negative-coordinate monitors and monitor removal", () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1600, y: 0, width: 1600, height: 860 }], rect = { x: -1500, y: 80, width: 900, height: 600 };
  assert.deepEqual(visibleWindowBounds(rect, areas), rect);
  assert.deepEqual(visibleWindowBounds(rect, areas.slice(0, 1)), { ...rect, x: 0 });
});
