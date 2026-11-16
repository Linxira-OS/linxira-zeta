import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { DesktopBrowserObservation, registerBrowserObservationIpc } from "../dist/browser-observation.js";

// Adapted from official apps/desktop/test/browser-observation.test.ts: the
// authenticated producer is a real private socket, with no CDP substitute.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zeta-bo-")), id = randomUUID(), tabId = randomUUID(), token = randomBytes(32).toString("hex");
  const endpoint = process.platform === "win32" ? "\\\\.\\pipe\\zeta-studio-browser-" + id : join(directory, "b-" + createHash("sha256").update(id).digest("hex").slice(0, 16) + ".sock");
  const events = [], inputs = [], peers = new Set();
  let peer;
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: {}, isDestroyed: () => false, getURL: () => "http://127.0.0.1:43141/", send: (_channel, payload) => events.push(payload) });
  const server = createServer(socket => {
    peer = socket; peers.add(socket); socket.on("error", () => {}); socket.on("close", () => peers.delete(socket));
    let pending = "", auth = false;
    socket.on("data", chunk => {
      pending += chunk.toString();
      for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (!auth) { assert.equal(line, token); auth = true; socket.write("OK\n"); }
        else inputs.push(JSON.parse(line));
      }
    });
  });
  await mkdir(join(directory, "browser"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  const descriptor = { version: 1, observationId: id, tabId, sessionId: "session-a", endpoint, token, expiresAt: Date.now() + 15000 };
  const descriptorFile = join(directory, "browser", id + ".json");
  await writeFile(descriptorFile, JSON.stringify(descriptor));
  const paths = { schema: 1, mediaDirectory: directory, socketDirectory: directory };
  return {
    id, tabId, token, endpoint, sender, events, inputs, paths, descriptor, descriptorFile,
    input: { observationId: id, tabId, sessionId: "session-a" },
    send(event) { assert.ok(peer); peer.write(JSON.stringify({ observationId: id, tabId, ...event }) + "\n"); },
    async close() { for (const socket of peers) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); },
  };
}
async function until(predicate) {
  for (let n = 0; n < 100 && !predicate(); n++) await delay(5);
  assert.ok(predicate());
}

test("browser frames retain window ownership, explicit control, ACK bounds and private credentials", async () => {
  const f = await fixture(), manager = new DesktopBrowserObservation({ paths: async () => f.paths });
  try {
    await assert.rejects(manager.attach(f.sender, { ...f.input, sessionId: "foreign" }), /expired/);
    await manager.attach(f.sender, f.input);
    assert.throws(() => manager.input({ ...f.sender, id: 8 }, { observationId: f.id, input: { kind: "take" } }), /owned by this window/);
    assert.throws(() => manager.input(f.sender, { observationId: f.id, input: { kind: "navigate", url: "https://example.com" } }), /human control/);
    f.send({ kind: "state", title: "test", url: "http://localhost", frozen: false, busy: false, control: "human" });
    await until(() => f.events.some(event => event.kind === "state"));
    assert.throws(() => manager.input(f.sender, { observationId: f.id, input: { kind: "navigate", url: "file:///private" } }), /HTTP/);
    manager.input(f.sender, { observationId: f.id, input: { kind: "navigate", url: "https://example.com" } });
    await until(() => f.inputs.length === 1);
    const frame = { kind: "frame", sequence: 1, data: "YWJj", width: 1000, height: 600, timestamp: Date.now() };
    f.send(frame); await until(() => f.events.some(event => event.kind === "frame"));
    assert.throws(() => manager.input(f.sender, { observationId: f.id, input: { kind: "ack", sequence: 2 } }), /stale/);
    f.send({ ...frame, sequence: 2 }); await until(() => f.events.some(event => event.kind === "closed"));
    assert.equal(f.events.filter(event => event.kind === "frame").length, 1);
    assert.ok(!JSON.stringify(f.events).includes(f.token));
    assert.ok(!JSON.stringify(f.events).includes(f.endpoint));
  } finally { manager.dispose(); await f.close(); }
});

test("descriptor endpoint substitution never reaches a second producer", async () => {
  const f = await fixture(), manager = new DesktopBrowserObservation({ paths: async () => f.paths });
  try {
    await writeFile(f.descriptorFile, JSON.stringify({ ...f.descriptor, endpoint: "http://127.0.0.1:43141/public" }));
    await assert.rejects(manager.attach(f.sender, f.input), /target changed/);
    assert.deepEqual(f.events, []);
  } finally { manager.dispose(); await f.close(); }
});

test("navigation during private path discovery cancels the old document before connection", async () => {
  const f = await fixture(), handlers = new Map();
  let finish;
  const manager = new DesktopBrowserObservation({ paths: () => new Promise(resolve => { finish = resolve; }) });
  const ipc = registerBrowserObservationIpc({ ipcMain: { handle: (channel, listener) => handlers.set(channel, listener), removeHandler: channel => handlers.delete(channel) }, manager, isTrustedSender: () => true, isVisible: () => true });
  try {
    const attach = handlers.get("zeta-studio:desktop:browser-attach");
    await assert.rejects(attach({ sender: f.sender, senderFrame: {} }, f.input), /Untrusted/);
    const pending = attach({ sender: f.sender, senderFrame: f.sender.mainFrame }, f.input);
    f.sender.emit("did-start-navigation", {}, "http://127.0.0.1:43141/", false, true);
    finish(f.paths);
    assert.equal((await pending).ok, false);
    assert.equal(f.sender.listenerCount("did-start-navigation"), 0);
    assert.deepEqual(f.events, []);
  } finally { ipc.dispose(); manager.dispose(); await f.close(); }
});

test("renderer crash and window hide detach an authenticated observation", async () => {
  const f = await fixture(), handlers = new Map();
  let visible = true;
  const manager = new DesktopBrowserObservation({ paths: async () => f.paths, isActive: () => visible });
  const ipc = registerBrowserObservationIpc({ ipcMain: { handle: (channel, listener) => handlers.set(channel, listener), removeHandler: channel => handlers.delete(channel) }, manager, isTrustedSender: () => true, isVisible: () => visible });
  const invoke = (kind, input) => handlers.get(`zeta-studio:desktop:browser-${kind}`)({ sender: f.sender, senderFrame: f.sender.mainFrame }, input);
  try {
    assert.equal((await invoke("attach", f.input)).ok, true);
    f.sender.emit("render-process-gone");
    assert.throws(() => manager.input(f.sender, { observationId: f.id, input: { kind: "take" } }), /owned/);
    assert.equal(f.sender.listenerCount("did-navigate"), 0);
    visible = false;
    assert.equal((await invoke("attach", f.input)).ok, false);
  } finally { ipc.dispose(); manager.dispose(); await f.close(); }
});
