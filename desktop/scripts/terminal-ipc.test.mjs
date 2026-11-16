import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerTerminalBridge } from "../dist/terminal/ipc.js";

function sender(id) {
  return Object.assign(new EventEmitter(), { id, mainFrame: {}, sent: [], isDestroyed: () => false, getURL: () => "http://127.0.0.1:43141/", send(channel, payload) { this.sent.push({ channel, payload }); } });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zeta-terminal-ipc-")), handlers = new Map(), requests = [], sockets = [];
  let finish;
  const host = {
    base: "http://127.0.0.1:43141", delay: false,
    async gateway(route, init) {
      requests.push({ route, init });
      if (route === "/api/terminal/ensure") {
        if (this.delay) await new Promise(resolve => { finish = resolve; });
        return { id: "terminal-owner-a", shell: "bash", ticket: "one-use", cwd: "/workspace" };
      }
      return { ok: true };
    },
    async socket() {
      const socket = { closed: false, opened: Promise.resolve(), writes: [], sendText(data) { this.writes.push(data); }, close() { this.closed = true; } };
      sockets.push(socket); return socket;
    },
  };
  const bridge = registerTerminalBridge({ ipc: { handle: (name, listener) => handlers.set(name, listener) }, pickExport: async () => undefined, userData: root, connection: () => host, isTrustedSender: value => value.trusted !== false });
  return { host, bridge, handlers, sockets, requests, finish: () => finish(), invoke: (owner, kind, ...args) => handlers.get(`pi:terminal-${kind}`)({ sender: owner, senderFrame: owner.mainFrame }, ...args), close() { bridge.shutdown(); rmSync(root, { recursive: true, force: true }); } };
}

test("terminal IPC rejects foreign frames and owners before mutation", async () => {
  const f = fixture(), first = sender(1), second = sender(2);
  try {
    await assert.rejects(f.handlers.get("pi:terminal-create")({ sender: first, senderFrame: {} }, {}), /Untrusted/);
    first.trusted = false;
    await assert.rejects(f.invoke(first, "create", {}), /Untrusted/);
    first.trusted = true;
    const info = await f.invoke(first, "create", {});
    assert.throws(() => f.invoke(second, "write", info.id, "foreign"), /owned/);
    f.invoke(first, "write", info.id, "hello");
    assert.deepEqual(f.sockets[0].writes, ["hello"]);
    await f.invoke(first, "resize", info.id, 110, 40);
    assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { cols: 110, rows: 40 });
    assert.throws(() => f.invoke(first, "write", info.id, "x".repeat(65537)), /Invalid/);
    assert.equal(f.handlers.has("pi:terminal-ack"), false);
  } finally { f.close(); }
});

for (const event of ["destroyed", "did-navigate", "render-process-gone", "did-start-navigation"]) {
  test(`${event} detaches the old socket while leaving the Host PTY owned by the Host`, async () => {
    const f = fixture(), first = sender(1);
    try {
      const info = await f.invoke(first, "create", {});
      f.sockets[0].onMessage("tail");
      first.emit(event, {}, "http://127.0.0.1:43141/", false, true);
      assert.equal(f.sockets[0].closed, true);
      assert.equal(f.requests.some(request => request.init?.method === "DELETE"), false);
      assert.equal(first.listenerCount("did-start-navigation"), 0);
      assert.throws(() => f.invoke(first, "write", info.id, "late"), /owned/);
    } finally { f.close(); }
  });
  test(`${event} prevents a pending create from assigning the new document's identity`, async () => {
    const f = fixture(), first = sender(1); f.host.delay = true;
    try {
      const pending = f.invoke(first, "create", {}), rejected = assert.rejects(pending, /window closed/);
      first.emit(event, {}, "http://127.0.0.1:43141/", false, true);
      f.host.delay = false;
      await f.invoke(first, "create", {});
      f.finish(); await rejected;
      assert.equal(f.sockets.length, 1);
    } finally { f.close(); }
  });
}

test("terminal recording tail is saved before exit and status remains readable by its document", async () => {
  const f = fixture(), first = sender(1);
  try {
    const info = await f.invoke(first, "create", {});
    f.invoke(first, "recording-start", { id: info.id });
    f.sockets[0].onMessage("last line");
    f.sockets[0].onBinary(Buffer.concat([Buffer.from([0]), Buffer.from('{"event":"exit"}')]));
    assert.equal(first.sent.at(-1).channel, "pi:terminal-exit");
    assert.equal(f.invoke(first, "recording-status", info.id).state, "saved");
    assert.equal(first.sent.find(event => event.channel === "pi:terminal-data").payload.data, "last line");
    await f.invoke(first, "dispose", info.id);
    assert.throws(() => f.invoke(first, "recording-status", info.id), /owned/);
  } finally { f.close(); }
});
