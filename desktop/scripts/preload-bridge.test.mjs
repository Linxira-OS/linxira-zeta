import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Execute the emitted sandbox preload. Electron permits only its own require
// here: a local runtime dependency must fail, just as it does in production.
function loadPreload(privateCapabilities = null) {
  const globals = new Map();
  const ipcRenderer = new EventEmitter();
  const pending = [];
  ipcRenderer.invoke = (...args) => new Promise(resolve => pending.push({ args, resolve }));
  ipcRenderer.sendSync = channel => channel === "zeta-studio:desktop:private-capabilities" ? privateCapabilities : null;
  const electron = { contextBridge: { exposeInMainWorld: (name, value) => globals.set(name, value) }, ipcRenderer, webUtils: { getPathForFile: file => file.path } };
  function load(file) {
    const module = { exports: {} };
    const require = name => { if (name !== "electron") throw new Error(`Sandbox preload cannot require ${name}`); return electron; };
    runInNewContext(readFileSync(file, "utf8"), { module, exports: module.exports, require, process: { platform: process.platform } }, { filename: file });
    return module.exports;
  }
  load(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/preload.js"));
  return { globals, ipcRenderer, pending };
}

test("window state subscriptions unsubscribe independently", async () => {
  const { globals, ipcRenderer, pending } = loadPreload();
  const chrome = globals.get("zetaStudioChrome");
  const first = [], second = [];
  const off = chrome.onWindowState(state => first.push(state.maximized));
  const offSecond = chrome.onWindowState(state => second.push(state.maximized));
  ipcRenderer.emit("pi:window-state", {}, { maximized: true });
  off();
  ipcRenderer.emit("pi:window-state", {}, { maximized: false });
  assert.deepEqual(first, [true]);
  assert.deepEqual(second, [true, false]);
  offSecond();
  assert.equal(ipcRenderer.listenerCount("pi:window-state"), 0);
  const maximized = chrome.isMaximized();
  pending[0].resolve({ maximized: true });
  assert.equal(await maximized, true);
});

test("workspace and file capabilities retain their owner and cancellation result", async () => {
  const { globals, pending } = loadPreload();
  const chrome = globals.get("zetaStudioChrome");
  const input = { workspaceId: "workspace-a", path: "report.txt", targetId: "ssh-a" };
  const opened = chrome.openFile(input);
  const editor = chrome.openProjectInEditor("workspace-b");
  assert.equal(pending[0].args[1], input);
  assert.equal(pending[1].args[1], "workspace-b");
  pending[0].resolve({ status: "cancelled" });
  pending[1].resolve({ status: "opened", editorName: "Code" });
  assert.equal((await opened).status, "cancelled");
  assert.equal((await editor).editorName, "Code");
  assert.equal(chrome.getPathForFile({ path: "/drop/file.txt" }), "/drop/file.txt");
  assert.equal(chrome.getPathForFile({ path: "" }), null);
});

test("menu and terminal events do not survive their unsubscribe", () => {
  const { globals, ipcRenderer } = loadPreload();
  const commands = [], data = [];
  const offMenu = globals.get("zetaStudioChrome").onMenuCommand(command => commands.push(command));
  const offData = globals.get("zetaStudioTerminal").onData(event => data.push(event.id));
  ipcRenderer.emit("pi:menu-command", {}, "settings");
  ipcRenderer.emit("pi:terminal-data", {}, { id: "terminal-a", data: "output" });
  offMenu(); offData();
  ipcRenderer.emit("pi:menu-command", {}, "close");
  ipcRenderer.emit("pi:terminal-data", {}, { id: "terminal-b", data: "late" });
  assert.deepEqual(commands, ["settings"]);
  assert.deepEqual(data, ["terminal-a"]);
});

test("sandbox preload loads every shipped capability without local require and does not advertise ACK", async () => {
  const { globals, pending, ipcRenderer } = loadPreload();
  const terminal = globals.get("zetaStudioTerminal"), chrome = globals.get("zetaStudioChrome");
  assert.equal(terminal.ack, undefined);
  assert.equal(chrome.files.officeInstall, undefined);
  assert.equal(chrome.saveComputerFrame, undefined);
  assert.equal(chrome.readComputerFrame, undefined);
  assert.equal(chrome.readComputerCapture, undefined);
  assert.equal(chrome.managedBrowser, undefined);
  assert.equal(chrome.attachBrowserObservation, undefined);
  assert.equal(chrome.attachPrediction, undefined);
  assert.equal(chrome.predictionInput, undefined);
  const command = { targetId: "ssh-a", workspaceId: "ws-a", instanceId: "script-a", command: { shell: "bash", text: "printf '%s\\n' hello" } };
  const created = terminal.create(command);
  assert.equal(pending[0].args[1], command);
  pending[0].resolve({ id: "shell-script-a" });
  assert.equal((await created).id, "shell-script-a");
  const frames = [];
  const off = globals.get("zetaStudioPerf").onChanged(snapshot => frames.push(snapshot.tier));
  ipcRenderer.emit("zeta-studio:desktop:perf-profile-changed", {}, { tier: "L2" });
  off();
  ipcRenderer.emit("zeta-studio:desktop:perf-profile-changed", {}, { tier: "L0" });
  assert.deepEqual(frames, ["L2"]);
});

test("file leases, close prompts and floating events retain exact payloads and unsubscribe", async () => {
  const { globals, pending, ipcRenderer } = loadPreload();
  const chrome = globals.get("zetaStudioChrome"), target = { targetId: "ssh-a", workspaceId: "ws-a", path: "video.mp4" };
  const opened = chrome.files.open(target);
  assert.equal(pending[0].args[1], target);
  pending[0].resolve({ id: "lease-a", url: "zeta-file://viewer/lease-a", file: {} });
  assert.equal((await opened).id, "lease-a");
  const close = [], floats = [];
  const offClose = chrome.files.onCloseRequested(id => close.push(id));
  const offFloat = chrome.onFloatWindow(event => floats.push(event.id));
  ipcRenderer.emit("zeta-studio:files-close-requested", {}, "decision-a");
  ipcRenderer.emit("zeta-studio:float:changed", {}, { id: "panel-a" });
  offClose(); offFloat();
  ipcRenderer.emit("zeta-studio:files-close-requested", {}, "decision-b");
  ipcRenderer.emit("zeta-studio:float:changed", {}, { id: "panel-b" });
  assert.deepEqual(close, ["decision-a"]);
  assert.deepEqual(floats, ["panel-a"]);
});

test("browser observation is exposed only after matching producer discovery and unsubscribes", async () => {
  const { globals, pending, ipcRenderer } = loadPreload({ browserObservation: true });
  const chrome = globals.get("zetaStudioChrome"), input = { observationId: "observation-a", tabId: "tab-a", sessionId: "session-a" };
  const attached = chrome.attachBrowserObservation(input);
  assert.equal(pending[0].args[0], "zeta-studio:desktop:browser-attach");
  assert.equal(pending[0].args[1], input);
  pending[0].resolve({ ok: true });
  assert.equal((await attached).ok, true);
  const frames = [], off = chrome.onBrowserObservation(event => frames.push(event.sequence));
  ipcRenderer.emit("zeta-studio:desktop:browser-event", {}, { kind: "frame", sequence: 1 });
  off();
  ipcRenderer.emit("zeta-studio:desktop:browser-event", {}, { kind: "frame", sequence: 2 });
  assert.deepEqual(frames, [1]);
});


test("managed browser exposes exact owner attach/release without private endpoints or a computer save API", async () => {
  const { globals, pending, ipcRenderer } = loadPreload({ managedBrowser: true, browserObservation: true });
  const chrome = globals.get("zetaStudioChrome"), api = chrome.managedBrowser;
  const input = { sessionId: "session-a", descriptorId: "host-issued-basename.json" };
  const attached = api.attach(input);
  assert.equal(pending[0].args[0], "zeta-studio:managed-browser:attach");
  assert.equal(pending[0].args[1], input);
  pending[0].resolve({ ok: true }); assert.equal((await attached).ok, true);
  const released = api.release({ sessionId: input.sessionId });
  assert.equal(pending[1].args[0], "zeta-studio:managed-browser:release");
  pending[1].resolve({ ok: true }); await released;
  const states = [], off = api.subscribe(event => states.push(event.state.sessionId));
  ipcRenderer.emit("zeta-studio:managed-browser:event", {}, { kind: "state", state: { sessionId: "session-a" } });
  off(); ipcRenderer.emit("zeta-studio:managed-browser:event", {}, { kind: "state", state: { sessionId: "late" } });
  assert.deepEqual(states, ["session-a"]);
  assert.equal(chrome.saveComputerFrame, undefined);
  assert.equal("endpoint" in api, false); assert.equal("token" in api, false);
});
