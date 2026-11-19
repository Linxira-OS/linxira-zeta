import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { MemoryCredentialStore } from "../dist/memory-credentials.js";
import { registerMemoryCredentialIpc } from "../dist/memory-credentials-ipc.js";

async function fixture() {
  const scratch = resolve(import.meta.dirname, "../../temp");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "memory-credentials-"));
  const key = randomBytes(32);
  let available = true;
  const store = new MemoryCredentialStore(join(directory, "credentials.enc"), {
    available: async () => available,
    async encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    async decrypt(bytes) { const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"); },
  });
  return { store, unavailable() { available = false; }, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
}

test("encrypted credentials are target and exact-URL scoped, serialized and fail closed", async () => {
  const f = await fixture();
  try {
    await Promise.all([f.store.set("local", "https://memory.example/", "local-secret"), f.store.set("ssh:a", "https://memory.example", "remote-secret")]);
    assert.equal(await f.store.has("local", "https://memory.example"), true);
    assert.equal(await f.store.has("local", "https://memory.example/other"), false);
    assert.equal((await f.store.list("ssh:a"))[0].token, "remote-secret");
    assert.equal((await readFile(f.store.file)).includes(Buffer.from("local-secret")), false);
    await f.store.set("local", "https://memory.example", undefined);
    assert.equal(await f.store.has("local", "https://memory.example"), false);
    assert.equal(await f.store.has("ssh:a", "https://memory.example"), true);
    for (const url of ["https://user:pass@memory.example", "https://memory.example/?token=x", "file:///private"]) assert.throws(() => f.store.set("local", url, "x"), /URL/);
    f.unavailable();
    await assert.rejects(f.store.list("ssh:a"), /unavailable/);
  } finally { await f.cleanup(); }
});

test("credential IPC refuses foreign frames and stale targets while only private delivery sees tokens", async () => {
  const f = await fixture(), handlers = new Map(), sent = [];
  let active = "a";
  const sender = { mainFrame: {}, isDestroyed: () => false };
  const controller = registerMemoryCredentialIpc({ ipc: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) }, trusted: value => value === sender, store: f.store, activeTarget: () => active, connectedTargets: () => [], connection: target => ({ gateway: async (_route, init) => { if (init?.body) sent.push({ target, entries: JSON.parse(init.body) }); return { supported: true }; } }) });
  const invoke = (action, input, frame = sender.mainFrame) => handlers.get(`zeta-studio:memory-credential-${action}`)({ sender, senderFrame: frame }, input);
  try {
    await assert.rejects(invoke("set", { targetId: "a", url: "https://memory.example", token: "secret" }, {}), /Untrusted/);
    assert.equal((await invoke("set", { targetId: "b", url: "https://memory.example", token: "secret" })).ok, false);
    const result = await invoke("set", { targetId: "a", url: "https://memory.example", token: "secret" });
    assert.deepEqual(result, { ok: true, configured: true, syncSupported: true });
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.deepEqual(sent, [{ target: "a", entries: [{ url: "https://memory.example", token: "secret" }] }]);
    active = "b";
    assert.equal((await invoke("remove", { targetId: "a", url: "https://memory.example" })).ok, false);
    assert.equal(await f.store.has("ssh:a", "https://memory.example"), true);
  } finally { controller.dispose(); await f.cleanup(); }
});

test("a credential save cannot adopt a replacement SSH generation after storage completes", async () => {
  const handlers = new Map(), delivered = [], stored = new Map();
  const started = Promise.withResolvers(), ready = Promise.withResolvers();
  let generation = 1;
  const sender = { mainFrame: {}, isDestroyed: () => false };
  const controller = registerMemoryCredentialIpc({
    ipc: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    trusted: value => value === sender, activeTarget: () => "server-a", connectedTargets: () => [],
    store: { async set(target, url, token) { started.resolve(); await ready.promise; stored.set(target, [{ url, token }]); }, async has(target) { return stored.has(target); }, async list(target) { return stored.get(target) ?? []; } },
    connection() { const captured = generation; return { async gateway(_route, init) { if (captured !== generation) throw new Error("stale generation"); if (init?.body) delivered.push(captured); return { supported: true }; } }; },
  });
  try {
    const pending = handlers.get("zeta-studio:memory-credential-set")({ sender, senderFrame: sender.mainFrame }, { targetId: "server-a", url: "https://memory.example", token: "private" });
    await started.promise; generation = 2; ready.resolve();
    assert.deepEqual(await pending, { ok: true, configured: true, syncSupported: false });
    assert.deepEqual(delivered, []);
  } finally { controller.dispose(); }
});
