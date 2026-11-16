import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { FileResources, parseFileResourceTarget } from "../dist/file-resources.js";
import { registerFileViewerIpc } from "../dist/file-viewer-ipc.js";

function hostFile(bytes = Buffer.from("0123456789")) {
  const requests = [];
  let revoked = false;
  const host = {
    base: "http://127.0.0.1:43141",
    async query(request) {
      requests.push(request);
      if (revoked) return { ok: false, error: { message: "device revoked" } };
      if (request.queryName === "workspace.file.inspect") return { ok: true, result: { ...request.input, id: "file-a", name: "data.svg", mime: "image/svg+xml", version: "version-a", size: bytes.length, writable: true } };
      assert.equal(request.queryName, "workspace.file.readChunk");
      assert.equal(request.input.version, "version-a");
      const data = bytes.subarray(request.input.offset, request.input.offset + request.input.length);
      return { ok: true, result: { bytes: data.length, data: data.toString("base64") } };
    },
  };
  return { host, requests, revoke() { revoked = true; } };
}
const target = { targetId: null, workspaceId: "ws-a", path: "data.svg" };
const origin = "http://127.0.0.1:43141";

function sender(id) {
  const value = new EventEmitter();
  value.id = id;
  value.sent = [];
  value.mainFrame = { url: origin + "/", parent: null };
  value.getURL = () => origin + "/";
  value.isDestroyed = () => false;
  value.send = (channel, ...args) => value.sent.push([channel, ...args]);
  return value;
}

test("file leases stream pinned Host versions with exact range and sandbox CSP", async () => {
  const { host, requests } = hostFile();
  const resources = new FileResources(() => host);
  const lease = await resources.open(target, 17);
  assert.equal(resources.allowsRequest(lease.url, 17), true);
  assert.equal(resources.allowsRequest(lease.url, 18), false);
  const response = await resources.response(new Request(lease.url, { headers: { origin, range: "bytes=2-5" } }), origin);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(await response.text(), "2345");
  assert.deepEqual(requests[1].input, { workspaceId: "ws-a", path: "data.svg", version: "version-a", offset: 2, length: 4 });
  const head = await resources.response(new Request(lease.url, { method: "HEAD" }), origin);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const suffix = await resources.response(new Request(lease.url, { headers: { range: "bytes=-2" } }), origin);
  assert.equal(await suffix.text(), "89");
  resources.dispose();
});

test("owner release, target revocation and invalid ranges fail instead of returning stale bytes", async () => {
  const fixture = hostFile(), resources = new FileResources(() => fixture.host);
  const lease = await resources.open(target, 17);
  assert.throws(() => resources.get(lease.id, 18), /closed/);
  resources.release(lease.id, 18);
  assert.equal(resources.allowsRequest(lease.url, 17), true);
  assert.equal((await resources.response(new Request(lease.url, { headers: { origin: "https://foreign.example" } }), origin)).status, 403);
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=1-3,5-6", "bytes=99999999999999999-", "bytes=-99999999999999999", "bytes=0-99999999999999999"]) {
    const response = await resources.response(new Request(lease.url, { headers: { range } }), origin);
    assert.equal(response.status, 416, range);
  }
  fixture.revoke();
  await assert.rejects(async () => { for await (const _ of resources.bytes(lease.id)) {} }, /device revoked/);
  resources.releaseOwner(17);
  assert.equal(resources.allowsRequest(lease.url, 17), false);
  assert.equal((await resources.response(new Request(lease.url), origin)).status, 404);
  assert.throws(() => parseFileResourceTarget({ ...target, path: "../private" }), /relative/);
  assert.throws(() => parseFileResourceTarget({ ...target, path: "C:/private" }), /relative/);
});

test("file chunk transport rejects malformed sizes and preserves 512 KiB chunk boundaries", async () => {
  const body = Buffer.alloc(512 * 1024 + 7, 65), fixture = hostFile(body);
  const resources = new FileResources(() => fixture.host), lease = await resources.open(target, 1);
  const response = await resources.response(new Request(lease.url), origin);
  assert.equal((await response.arrayBuffer()).byteLength, body.length);
  assert.deepEqual(fixture.requests.slice(1).map(request => request.input.length), [512 * 1024, 7]);
  resources.dispose();
  const invalid = { ...fixture.host, async query(request) {
    return request.queryName === "workspace.file.inspect" ? fixture.host.query(request) : { ok: true, result: { bytes: 4, data: "QQ==" } };
  } };
  const broken = new FileResources(() => invalid), other = await broken.open(target, 1);
  await assert.rejects(async () => { for await (const _ of broken.bytes(other.id)) {} }, /size mismatch/);
  broken.dispose();
});

test("file IPC revokes document leases on navigation and only its owner may answer close", async () => {
  const handlers = new Map(), fixture = hostFile(), resources = new FileResources(() => fixture.host);
  const first = sender(1), second = sender(2);
  const handle = registerFileViewerIpc({
    ipc: { handle: (channel, action) => handlers.set(channel, action), removeHandler: channel => handlers.delete(channel) },
    resources, trusted: () => true, pickExport: async () => undefined, show() {},
  });
  const invoke = (owner, name, ...args) => handlers.get(`zeta-studio:files-${name}`)({ sender: owner, senderFrame: owner.mainFrame }, ...args);
  const lease = await invoke(first, "open", target);
  invoke(second, "release", lease.id);
  assert.equal(resources.allowsRequest(lease.url, 1), true);
  assert.equal(handle.allowsRequest(lease.url, first, first.mainFrame, "xhr"), true);
  assert.equal(handle.allowsRequest(lease.url, first, first.mainFrame, "mainFrame"), false);
  assert.equal(handle.allowsRequest(lease.url, first, { url: origin + "/", parent: first.mainFrame }, "xhr"), false);
  assert.equal(handle.allowsRequest(lease.url, first, { url: lease.url, parent: first.mainFrame }, "media"), true);
  assert.equal(handle.allowsRequest(lease.url, second, second.mainFrame, "xhr"), false);
  assert.throws(() => handlers.get("zeta-studio:files-open")({ sender: first, senderFrame: {} }, target), /Untrusted/);
  for (const suffix of ["?path=private", "#fragment", "/another"]) assert.equal(resources.allowsRequest(lease.url + suffix, 1), false);
  invoke(first, "dirty", 1);
  const closing = handle.requestClose();
  const decision = first.sent.find(([channel]) => channel === "zeta-studio:files-close-requested")[1];
  invoke(second, "finish-close", decision, true);
  invoke(first, "finish-close", decision, false);
  assert.equal(await closing, false);
  first.emit("did-navigate");
  assert.equal(resources.allowsRequest(lease.url, 1), false);
  assert.equal(handle.hasDirty(), false);
  handle.dispose();
  assert.equal(handlers.size, 0);
});

for (const event of ["destroyed", "did-navigate", "render-process-gone", "did-start-navigation"]) {
  test(`${event} rejects a late Host inspection without revoking the new document`, async () => {
    const fixture = hostFile(), first = sender(1), handlers = new Map();
    let finish, reads = 0;
    const resources = new FileResources(() => ({ ...fixture.host, query: request => request.queryName === "workspace.file.inspect" && ++reads === 1 ? new Promise(resolve => { finish = () => resolve(fixture.host.query(request)); }) : fixture.host.query(request) }));
    const handle = registerFileViewerIpc({ ipc: { handle: (channel, action) => handlers.set(channel, action), removeHandler: channel => handlers.delete(channel) }, resources, trusted: () => true, pickExport: async () => undefined, show() {} });
    const invoke = (name, ...args) => handlers.get(`zeta-studio:files-${name}`)({ sender: first, senderFrame: first.mainFrame }, ...args);
    try {
      const opening = invoke("open", target), rejected = assert.rejects(opening, /closed/);
      first.emit(event, {}, origin + "/", false, true);
      const fresh = await invoke("open", target);
      finish(); await rejected;
      assert.equal(resources.allowsRequest(fresh.url, 1), true);
      invoke("dirty", 1);
      const closing = handle.requestClose();
      first.emit(event, {}, origin + "/", false, true);
      assert.equal(await closing, false);
      assert.equal(handle.hasDirty(), false);
      assert.equal(resources.allowsRequest(fresh.url, 1), false);
    } finally { handle.dispose(); }
  });
}

test("releasing a file view aborts a stream whose next Host chunk is in flight", async () => {
  const fixture = hostFile(Buffer.alloc(512 * 1024 + 7, 65));
  let finish;
  const resources = new FileResources(() => ({ ...fixture.host, query: request => request.queryName === "workspace.file.readChunk" && request.input.offset > 0 ? new Promise(resolve => { finish = () => resolve(fixture.host.query(request)); }) : fixture.host.query(request) }));
  const lease = await resources.open(target, 7), iterator = resources.bytes(lease.id);
  assert.equal((await iterator.next()).value.byteLength, 512 * 1024);
  const next = iterator.next(), rejected = assert.rejects(next, /abort/i);
  resources.release(lease.id, 7); finish(); await rejected;
  assert.equal(resources.allowsRequest(lease.url, 7), false);
});
