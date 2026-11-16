import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { registerManagedBrowserIpc } from "../dist/managed-browser-ipc.js";

function sender(id, root = id) { return Object.assign(new EventEmitter(), { id, root, mainFrame: {}, sent: [], isDestroyed: () => false, send(channel, payload) { this.sent.push({ channel, payload }); } }); }
function fixture() {
  const handlers = new Map(), leases = new Map(), detached = [], executed = [], presented = [];
  let listener, complete;
  const relay = {
    delayed: false,
    async attach(owner, input) { if (leases.has(input.sessionId) && leases.get(input.sessionId) !== owner) throw new Error("owned"); leases.set(input.sessionId, owner); if (this.delayed) await new Promise(resolve => { complete = resolve; }); },
    release(owner, id) { for (const [key, value] of leases) if (value === owner && (id === undefined || key === id)) leases.delete(key); },
    owns: (owner, id) => leases.get(id) === owner,
  };
  const manager = { read: async id => ({ sessionId: id }), execute: async (command, active) => { assert.equal(active(), true); executed.push(command); return { sessionId: command.sessionId }; }, present: async (value, active) => { assert.equal(active(), true); presented.push(value); }, subscribe(value) { listener = value; return () => { listener = undefined; }; } };
  const controller = registerManagedBrowserIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) }, manager, relay, isTrustedSender: value => value.trusted !== false, ownerId: value => value.root, ownsWindow: (value, key) => value.id === 1 ? key === undefined : key === "float-a", detachWindow: value => detached.push(value.id) });
  return { leases, relay, executed, presented, handlers, detached, controller, finish: () => complete(), emit: value => listener?.(value), invoke: (owner, kind, input) => handlers.get(`zeta-studio:managed-browser:${kind}`)({ sender: owner, senderFrame: owner.mainFrame }, input) };
}
const attachment = { sessionId: "session-a", descriptorId: "basename-from-host.json" };

test("managed root owns prepared descriptors, child panels share only that root and private data never leaves", async () => {
  const f = fixture(), root = sender(1), child = sender(2, 1), foreign = sender(3);
  try {
    assert.equal((await f.invoke(root, "attach", attachment)).ok, true);
    assert.equal((await f.invoke(foreign, "attach", attachment)).ok, false);
    assert.equal((await f.invoke(child, "attach", attachment)).ok, false);
    assert.equal((await f.invoke(child, "read", "session-a")).sessionId, "session-a");
    assert.throws(() => f.invoke(foreign, "read", "session-a"), /attached/);
    f.emit({ kind: "state", state: { sessionId: "session-a" } });
    assert.equal(root.sent.length, 1); assert.equal(child.sent.length, 1); assert.equal(foreign.sent.length, 0);
    f.invoke(foreign, "release", { sessionId: "session-a" });
    assert.equal(f.leases.get("session-a"), 1);
    assert.equal(f.invoke(root, "release", { sessionId: "session-a" }).ok, true);
    assert.equal(f.invoke(root, "release", { sessionId: "session-a" }).ok, true);
    assert.equal(f.leases.size, 0);
  } finally { f.controller.dispose(); }
});

test("managed IPC validates actions, frame identity and exact native target window", async () => {
  const f = fixture(), root = sender(1), child = sender(2, 1);
  try {
    await f.invoke(root, "attach", attachment);
    await assert.rejects(f.handlers.get("zeta-studio:managed-browser:attach")({ sender: root, senderFrame: {} }, attachment), /trusted/);
    for (const command of [{ action: "exec", sessionId: "session-a" }, { action: "zoom", sessionId: "session-a", pageId: "page-a", factor: NaN }, { action: "settings", sessionId: "session-a", settings: { maxTabs: -1 } }, { action: "create", sessionId: "session-a", url: "https://example.com", program: "cmd" }]) assert.throws(() => f.invoke(root, "execute", command), /Invalid/);
    const rect = { x: 0, y: 0, width: 600, height: 400 }, presentation = { sessionId: "session-a", surfaceId: "panel-a", pageId: "page-a", visible: true, bounds: rect, clip: rect };
    assert.throws(() => f.invoke(child, "present", presentation), /another window/);
    await f.invoke(child, "present", { ...presentation, windowKey: "float-a" });
    assert.equal(f.presented[0].surfaceId, "2:panel-a");
    await f.invoke(root, "execute", { action: "find", sessionId: "session-a", pageId: "page-a", text: "needle" });
    assert.equal(f.executed.length, 1);
  } finally { f.controller.dispose(); }
});

for (const event of ["destroyed", "did-navigate", "render-process-gone", "did-start-navigation"]) {
  test(`managed ${event} releases root leases and cannot tear down a replacement document`, async () => {
    const f = fixture(), root = sender(1); f.relay.delayed = true;
    try {
      const pending = f.invoke(root, "attach", attachment);
      root.emit(event, {}, "http://127.0.0.1:43141/", false, true);
      f.relay.delayed = false;
      assert.equal((await f.invoke(root, "attach", attachment)).ok, true);
      f.finish(); assert.equal((await pending).ok, false);
      assert.equal(f.leases.get("session-a"), 1);
      root.emit(event, {}, "http://127.0.0.1:43141/", false, true);
      assert.equal(f.leases.size, 0);
      assert.equal(root.listenerCount("did-start-navigation"), 0);
    } finally { f.controller.dispose(); }
    assert.equal(f.handlers.size, 0);
  });
}
