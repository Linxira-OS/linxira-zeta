import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ManagedBrowserRelay } from "../dist/managed-browser-relay.js";

class ProducerSocket extends EventTarget {
  static OPEN = 1; static CLOSING = 2; static CLOSED = 3; static sockets = [];
  readyState = 0; sent = [];
  constructor(url) { super(); this.url = url; ProducerSocket.sockets.push(this); queueMicrotask(() => { this.readyState = ProducerSocket.OPEN; this.dispatchEvent(new Event("open")); }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  response(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  close() { if (this.readyState >= ProducerSocket.CLOSING) return; this.readyState = ProducerSocket.CLOSED; this.dispatchEvent(new Event("close")); }
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zeta-managed-")), sessionId = "session-a", generation = randomUUID();
  const descriptorId = `${createHash("sha256").update(sessionId).digest("hex")}-${generation}.json`, filename = join(directory, "managed-browser", descriptorId);
  const descriptor = { version: 1, sessionId, generation, endpoint: "http://127.0.0.1:43998/managed/" + "a".repeat(64), pid: process.pid };
  await mkdir(join(directory, "managed-browser")); await writeFile(filename, JSON.stringify(descriptor));
  const connections = [], detached = [], commands = [], created = [];
  const contents = { debugger: Object.assign(new EventEmitter(), { attached: false, isAttached() { return this.attached; }, attach() { this.attached = true; }, detach() { this.attached = false; this.emit("detach", {}, "test"); } }), isDevToolsOpened: () => false, isDestroyed: () => false };
  const manager = {
    ready: Promise.resolve(), store: { connection: (id, state) => connections.push({ id, state }), state: () => ({ activePageId: null, control: "agent" }), initialControl: () => "agent", page: id => id === "page-a" ? page : undefined },
    setRuntime(value) { this.runtime = value; }, pages: () => [page], isReleased: () => false, detachSession: id => detached.push(id), ensure: async () => contents, holdActivity: () => () => {},
    async create(id, url) { created.push({ id, url }); return page; }, async agentCommand(id, method, params) { commands.push({ id, method, params }); return { title: "real managed page" }; },
  };
  const page = { id: "page-a", sessionId, url: "https://example.com", title: "Page", status: "ready", devtools: false, documentId: "doc-a" };
  const authority = { schema: 1, mediaDirectory: directory, socketDirectory: directory, pid: process.pid };
  let currentAuthority = authority;
  const relay = new ManagedBrowserRelay({ manager, authority: async () => currentAuthority });
  return { directory, relay, descriptor, descriptorId, filename, sessionId, connections, detached, commands, created, manager, authority, page, input: { sessionId, descriptorId }, setAuthority: value => { currentAuthority = value; }, async close() { await relay.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test("managed relay reads only the prepared basename, waits for control handshake and retains upstream CDP behavior", async () => {
  const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
  globalThis.WebSocket = ProducerSocket; ProducerSocket.sockets = [];
  const fetches = []; globalThis.fetch = async (url, init) => { fetches.push({ url, init }); return Response.json([]); };
  const f = await fixture();
  try {
    assert.equal(ProducerSocket.sockets.length, 0, "no directory-wide discovery");
    let attached = false;
    const pending = f.relay.attach(1, f.input).then(() => { attached = true; });
    for (let n = 0; n < 100 && !ProducerSocket.sockets.length; n++) await turn();
    const socket = ProducerSocket.sockets[0]; assert.ok(socket);
    const hello = socket.sent.find(value => value.t === "hello"), control = socket.sent.find(value => value.t === "studioControl");
    assert.equal(hello.tabs[0].studioPageId, "page-a"); assert.equal(control.control, "agent"); assert.equal(attached, false);
    socket.response({ t: "studioControlResult", id: control.id, ok: true }); await pending;
    assert.equal(attached, true); assert.equal(f.connections.at(-1).state, "connected");
    assert.equal(fetches[0].init.redirect, "error"); assert.equal(fetches[0].url, f.descriptor.endpoint + "/json/list");
    await assert.rejects(f.relay.attach(2, f.input), /another window/);
    socket.response({ t: "rpc", id: 7, op: "send", tabId: hello.tabs[0].tabId, method: "Runtime.evaluate", params: { expression: "document.title" } });
    await turn(); await turn();
    assert.equal(f.commands[0].method, "Runtime.evaluate"); assert.equal(socket.sent.find(value => value.t === "rpcResult" && value.id === 7).ok, true);
    const handoff = f.relay.control("session-a", "human"), request = socket.sent.at(-1);
    socket.response({ t: "studioControlResult", id: request.id, ok: true }); await handoff;
    f.relay.release(2, "session-a"); assert.equal(socket.readyState, ProducerSocket.OPEN);
    f.relay.release(1, "session-a"); assert.equal(socket.readyState, ProducerSocket.CLOSED); assert.equal(f.relay.owns(1, "session-a"), false);
    assert.equal(f.detached.at(-1), "session-a");
    assert.ok(!JSON.stringify(f.connections).includes("a".repeat(64)));
  } finally { await f.close(); globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch; }
});

test("managed relay carries the page document identity across hello and tab updates", async () => {
  const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
  globalThis.WebSocket = ProducerSocket; ProducerSocket.sockets = [];
  globalThis.fetch = async () => Response.json([]);
  const chrome = Object.getOwnPropertyDescriptor(process.versions, "chrome");
  Object.defineProperty(process.versions, "chrome", { value: "156.0.8078.96", configurable: true });
  const f = await fixture();
  try {
    const pending = f.relay.attach(1, f.input);
    for (let n = 0; n < 100 && !ProducerSocket.sockets.length; n++) await turn();
    const socket = ProducerSocket.sockets[0]; assert.ok(socket);
    const hello = socket.sent.find(value => value.t === "hello");
    assert.equal(hello.browserVersion, "Chrome/156.0.8078.96");
    assert.equal(hello.tabs[0].studioDocumentId, "doc-a");
    const control = socket.sent.find(value => value.t === "studioControl");
    socket.response({ t: "studioControlResult", id: control.id, ok: true }); await pending;
    f.page.documentId = "doc-b"; f.relay.changed(f.sessionId); await turn();
    const updated = socket.sent.find(value => value.t === "tabUpdated" && value.tab.studioDocumentId === "doc-b");
    assert.ok(updated, "document identity was not forwarded");
    f.page.documentId = undefined; f.relay.changed(f.sessionId); await turn();
    const cleared = socket.sent.find(value => value.t === "tabUpdated" && value.tab.studioDocumentId === undefined);
    assert.ok(cleared, "cleared document identity was not forwarded");
  } finally {
    await f.close(); globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch;
    if (chrome) Object.defineProperty(process.versions, "chrome", chrome); else delete process.versions.chrome;
  }
});

test("managed descriptors reject unrelated live PIDs, path injection, credentials, queries and hashes before fetching", async () => {
  const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
  globalThis.WebSocket = ProducerSocket; ProducerSocket.sockets = [];
  let fetches = 0; globalThis.fetch = async () => { fetches++; return Response.json([]); };
  const f = await fixture();
  try {
    await assert.rejects(f.relay.attach(1, { ...f.input, descriptorId: "../private.json" }), /Invalid/);
    for (const descriptor of [{ ...f.descriptor, pid: process.pid + 1 }, { ...f.descriptor, endpoint: f.descriptor.endpoint + "?token=foreign" }, { ...f.descriptor, endpoint: f.descriptor.endpoint + "#foreign" }, { ...f.descriptor, endpoint: f.descriptor.endpoint.replace("127.0.0.1", "user:password@127.0.0.1") }, { ...f.descriptor, sessionId: "foreign" }]) {
      await writeFile(f.filename, JSON.stringify(descriptor));
      await assert.rejects(f.relay.attach(1, f.input));
    }
    assert.equal(fetches, 0); assert.equal(ProducerSocket.sockets.length, 0);
  } finally { await f.close(); globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch; }
});

test("owner release during discovery prevents a late managed connection", async () => {
  const originalFetch = globalThis.fetch, f = await fixture();
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = () => resolve(Response.json([])); });
  try {
    const pending = f.relay.attach(1, f.input), rejected = assert.rejects(pending, /owner changed/);
    for (let n = 0; n < 1000 && !finish; n++) await turn();
    assert.ok(finish); f.relay.release(1, f.sessionId); finish(); await rejected;
    assert.equal(f.relay.owns(1, f.sessionId), false);
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("a live registration PID change closes the old managed producer and native presentation", async () => {
  const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
  globalThis.WebSocket = ProducerSocket; ProducerSocket.sockets = [];
  globalThis.fetch = async () => Response.json([]);
  const f = await fixture();
  try {
    const pending = f.relay.attach(1, f.input);
    for (let n = 0; n < 100 && !ProducerSocket.sockets.length; n++) await turn();
    const socket = ProducerSocket.sockets[0]; assert.ok(socket);
    const request = socket.sent.find(value => value.t === "studioControl");
    socket.response({ t: "studioControlResult", id: request.id, ok: true }); await pending;
    f.setAuthority({ ...f.authority, pid: process.pid + 1 });
    for (let n = 0; n < 30 && socket.readyState === ProducerSocket.OPEN; n++) await delay(50);
    assert.equal(socket.readyState, ProducerSocket.CLOSED);
    assert.equal(f.relay.owns(1, f.sessionId), false);
    assert.equal(f.detached.at(-1), f.sessionId);
  } finally { await f.close(); globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch; }
});
