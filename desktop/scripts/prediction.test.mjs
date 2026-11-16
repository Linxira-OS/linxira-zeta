import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { DesktopPrediction, registerPredictionIpc } from "../dist/prediction.js";

async function until(predicate) {
  for (let n = 0; n < 200 && !predicate(); n++) await delay(5);
  assert.ok(predicate());
}
async function fixture() {
  const root = await mkdtemp(join(import.meta.dirname, "../../temp/prediction-ipc-")), channelId = randomUUID(), token = randomBytes(32).toString("hex");
  const endpoint = process.platform === "win32" ? "\\\\.\\pipe\\zeta-studio-predict-" + channelId : join(root, "p-" + createHash("sha256").update(channelId).digest("hex").slice(0, 16) + ".sock");
  const paths = { schema: 1, mediaDirectory: root, socketDirectory: root }, inputs = [], events = [], peers = new Set();
  let peer, visible = true, activePaths = paths;
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: {}, isDestroyed: () => false, getURL: () => "http://127.0.0.1:43141/", send: (_channel, value) => events.push(value) });
  const selected = join(root, "chosen-history.jsonl");
  await writeFile(selected, JSON.stringify({ text: "local prompt fixture" }) + "\n");
  const server = createServer(socket => {
    peer = socket; peers.add(socket); socket.on("error", () => {}); socket.on("close", () => peers.delete(socket));
    let pending = "", auth = false;
    socket.on("data", part => {
      pending += part.toString();
      for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (!auth) { assert.equal(line, token); auth = true; socket.write("OK\n"); continue; }
        const input = JSON.parse(line); inputs.push(input);
        if (input.kind === "import") void readFile(join(root, "prediction-imports", input.transferId + ".jsonl"), "utf8").then(text => {
          assert.ok(text.includes("local prompt fixture"));
          socket.write(JSON.stringify({ kind: "imported", channelId, requestId: input.requestId, count: 1, truncated: false }) + "\n");
        });
      }
    });
  });
  await mkdir(join(root, "prediction"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  const descriptor = { version: 1, channelId, sessionId: "main", token, endpoint, expiresAt: Date.now() + 15000 };
  const descriptorFile = join(root, "prediction", channelId + ".json");
  await writeFile(descriptorFile, JSON.stringify(descriptor));
  const manager = new DesktopPrediction({ paths: async () => activePaths, isActive: () => visible, chooseHistory: async () => selected });
  const handlers = new Map();
  const ipc = registerPredictionIpc({ ipcMain: { handle: (channel, listener) => handlers.set(channel, listener), removeHandler: channel => handlers.delete(channel) }, manager, isTrustedSender: () => true, isVisible: () => visible });
  return {
    root, channelId, token, endpoint, descriptor, descriptorFile, manager, sender, selected, inputs, events,
    input: { channelId, sessionId: "main", expiresAt: descriptor.expiresAt, protocolVersion: 2 },
    invoke(kind, input, frame = sender.mainFrame) { return handlers.get("zeta-studio:desktop:prediction-" + kind)({ sender, senderFrame: frame }, input); },
    send(value) { peer.write(JSON.stringify({ channelId, ...value }) + "\n"); },
    visible(value) { visible = value; },
    paths(value) { activePaths = value; },
    async close() { ipc.dispose(); manager.dispose(); for (const socket of peers) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); },
  };
}

test("v2 predictions and selected imports stay window-owned and never expose private credentials", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.manager.attach(f.sender, { ...f.input, sessionId: "foreign" }), /expired or changed/);
    await f.manager.attach(f.sender, f.input);
    await assert.rejects(f.manager.input({ ...f.sender, id: 8 }, { channelId: f.channelId, input: { kind: "ping" } }), /owned by this window/);
    await assert.rejects(f.manager.input(f.sender, { channelId: f.channelId, input: { kind: "import", requestId: randomUUID(), transferId: randomUUID() } }), /file picker/);
    f.send({ kind: "next", revision: 2, suffix: "the tests", choices: ["Run the tests", "Review"], rank: 0 });
    await until(() => f.events.some(event => event.kind === "next"));
    assert.deepEqual(f.events.find(event => event.kind === "next").choices, ["Run the tests", "Review"]);
    assert.deepEqual(await f.manager.importHistory(f.sender, { channelId: f.channelId }), { ok: true, count: 1, truncated: false });
    assert.equal(f.inputs[0].kind, "import");
    assert.ok(!JSON.stringify(f.inputs).includes(f.selected));
    assert.ok(!JSON.stringify(f.events).includes(f.token));
    assert.ok(!JSON.stringify(f.events).includes(f.endpoint));
    assert.ok(!JSON.stringify(f.events).includes("local prompt fixture"));
    assert.equal(await readFile(f.selected, "utf8"), JSON.stringify({ text: "local prompt fixture" }) + "\n");
    f.manager.disposeWindow(f.sender.id);
    await assert.rejects(f.manager.input(f.sender, { channelId: f.channelId, input: { kind: "ping" } }), /owned by this window/);
  } finally { await f.close(); }
});

test("endpoint replacement, invalid events and subframes cannot become a prediction producer", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.invoke("attach", f.input, {}), /Untrusted/);
    await writeFile(f.descriptorFile, JSON.stringify({ ...f.descriptor, endpoint: "http://127.0.0.1/public" }));
    await assert.rejects(f.manager.attach(f.sender, f.input), /expired or changed/);
    await writeFile(f.descriptorFile, JSON.stringify(f.descriptor));
    await f.manager.attach(f.sender, f.input);
    f.send({ kind: "next", revision: 1, suffix: "bad", choices: ["fine"], rank: 3 });
    await until(() => f.events.some(event => event.kind === "closed"));
    assert.equal(f.events.some(event => event.kind === "next"), false);
  } finally { await f.close(); }
});

test("navigation, renderer loss, hidden windows and Host replacement retire private prediction input", async () => {
  for (const transition of ["did-start-navigation", "render-process-gone", "hide", "host"]) {
    const f = await fixture();
    try {
      assert.equal((await f.invoke("attach", f.input)).ok, true);
      if (transition === "did-start-navigation") f.sender.emit(transition, {}, "http://127.0.0.1/", false, true);
      else if (transition === "render-process-gone") f.sender.emit(transition);
      else if (transition === "hide") f.visible(false);
      else f.paths({ schema: 1, mediaDirectory: f.root + "-replacement", socketDirectory: f.root });
      const result = await f.invoke("input", { channelId: f.channelId, input: { kind: "ping" } });
      assert.equal(result.ok, false);
      assert.deepEqual(f.inputs, []);
      if (transition === "did-start-navigation" || transition === "render-process-gone") assert.equal(f.sender.listenerCount("did-start-navigation"), 0);
    } finally { await f.close(); }
  }
});
