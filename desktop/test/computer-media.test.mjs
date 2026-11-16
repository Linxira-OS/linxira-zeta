import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { DesktopComputerViews } from "../dist/computer-views.js";
import { ComputerFrameStore, registerComputerFrameIpc } from "../dist/computer-frames.js";
import { registerComputerCaptureIpc } from "../dist/computer-observation.js";
import { COMPUTER_FRAME_CHANNELS } from "../dist/computer-frames-shared.js";
import { COMPUTER_CAPTURE_CHANNEL } from "../dist/computer-observation-shared.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aWxQAAAAASUVORK5CYII=", "base64");
const hash = value => createHash("sha256").update(value).digest("hex");
class Sender extends EventEmitter {
	constructor(id) { super(); this.id = id; this.mainFrame = {}; this.visible = true; }
	isDestroyed() { return false; }
	getURL() { return "http://127.0.0.1:43141/"; }
	send() {}
}
async function fixture() {
	const directory = await mkdtemp(fileURLToPath(new URL("../../temp/zeta-computer-media-", import.meta.url)));
	const paths = { schema: 1, mediaDirectory: directory, socketDirectory: directory };
	const views = new DesktopComputerViews({ paths: async () => paths, isActive: sender => sender.visible });
	const store = new ComputerFrameStore(views), sender = new Sender(1);
	const scopeSessionId = "root", leaseId = randomUUID(), frameId = randomUUID(), owner = hash("private-owner");
	const frame = { frameId, sessionId: "child", source: "observation", width: 1, height: 1, coordinateWidth: 1, coordinateHeight: 1, capturedAt: Date.now(), expiresAt: Date.now() + 120000, availability: "available", targetId: "window:1", screenLocked: false, delivered: false };
	await mkdir(join(directory, "computer-views"), { recursive: true });
	await mkdir(join(directory, "computer-workspace", hash(scopeSessionId)), { recursive: true });
	await mkdir(join(directory, "outputs", hash(frame.sessionId)), { recursive: true });
	await writeFile(join(directory, "computer-views", leaseId + ".json"), JSON.stringify({ version: 1, leaseId, owner, scopeSessionId, expiresAt: Date.now() + 120000 }));
	const descriptor = join(directory, "computer-workspace", hash(scopeSessionId), frameId + ".json");
	const metadata = { version: 1, scopeSessionId, frame, bytes: png.length, sha256: hash(png), leaseId };
	await writeFile(descriptor, JSON.stringify(metadata));
	await writeFile(join(directory, "outputs", hash(frame.sessionId), frameId + ".bin"), png);
	return { directory, paths, views, store, sender, scopeSessionId, leaseId, frameId, owner, frame, descriptor, metadata,
		async dispose() { views.dispose(); store.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test("frames require exact local adoption; another window, lease, or remote origin cannot read", async () => {
	const f = await fixture();
	try {
		const request = { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" };
		await assert.rejects(f.store.read(f.sender, request));
		await f.views.adopt(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" });
		const result = await f.store.read(f.sender, request);
		assert.equal(result.ok, true); assert.deepEqual(Buffer.from(result.data), png);
		await assert.rejects(f.views.adopt(new Sender(2), { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" }));
		await assert.rejects(f.store.read(f.sender, { ...request, origin: "remote" }));
		await writeFile(f.descriptor, JSON.stringify({ ...f.metadata, leaseId: randomUUID() }));
		await assert.rejects(f.store.read(f.sender, request));
	} finally { await f.dispose(); }
});

test("released, expired, oversize, and malformed payloads fail closed without paths in results", async () => {
	const f = await fixture();
	try {
		await f.views.adopt(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" });
		const guard = await f.views.guard(f.sender, f.scopeSessionId, f.leaseId);
		f.views.releaseWindow(f.sender.id);
		await assert.rejects(f.store.readFrame(guard, f.frameId));
		await f.views.adopt(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" });
		await writeFile(f.descriptor, JSON.stringify({ ...f.metadata, bytes: 64 * 1024 * 1024 }));
		await assert.rejects(f.store.read(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" }));
		await writeFile(f.descriptor, JSON.stringify({ ...f.metadata, frame: { ...f.frame, expiresAt: Date.now() - 1 } }));
		await assert.rejects(f.store.read(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" }));
		await unlink(join(f.directory, "computer-views", f.leaseId + ".json"));
		await assert.rejects(f.views.guard(f.sender, f.scopeSessionId, f.leaseId));
	} finally { await f.dispose(); }
});

test("IPC rejects subframes and navigation invalidates pending ownership; save is never registered", async () => {
	const f = await fixture(), handlers = new Map();
	const ipcMain = { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
	const ipc = registerComputerFrameIpc({ ipcMain, store: f.store, views: f.views, isTrustedSender: () => true, isVisible: sender => sender.visible });
	try {
		assert.equal([...handlers.keys()].some(key => key.includes("save")), false);
		const adoption = { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" };
		assert.equal((await handlers.get(COMPUTER_FRAME_CHANNELS.adopt)({ sender: f.sender, senderFrame: {} }, adoption)).ok, false);
		assert.equal((await handlers.get(COMPUTER_FRAME_CHANNELS.adopt)({ sender: f.sender, senderFrame: f.sender.mainFrame }, adoption)).ok, true);
		f.sender.emit("did-start-navigation", {}, "http://127.0.0.1:43141/", false, true);
		const result = await handlers.get(COMPUTER_FRAME_CHANNELS.read)({ sender: f.sender, senderFrame: f.sender.mainFrame }, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" });
		assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(f.directory), false);
	} finally { ipc.dispose(); await f.dispose(); }
});

test("legacy receipts are atomically consumed once and never remove native source screenshots", async () => {
	const f = await fixture(), handlers = new Map(), captureId = randomUUID();
	const ipcMain = { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
	const ipc = registerComputerCaptureIpc({ ipcMain, paths: async () => f.paths, views: f.views, store: f.store, isTrustedSender: () => true, isVisible: sender => sender.visible });
	try {
		await mkdir(join(f.directory, "computer"));
		await writeFile(join(f.directory, "computer", captureId + ".json"), JSON.stringify({ version: 1, captureId, sessionId: f.scopeSessionId, targetId: "window:1", width: 1, height: 1, expiresAt: Date.now() + 30000, scopeSessionId: f.scopeSessionId, frameId: f.frameId, leaseId: f.leaseId, owner: f.owner }));
		const read = handlers.get(COMPUTER_CAPTURE_CHANNEL), request = { captureId, sessionId: f.scopeSessionId, targetId: "window:1" }, event = { sender: f.sender, senderFrame: f.sender.mainFrame };
		assert.equal((await read(event, request)).ok, true);
		assert.equal((await read(event, request)).ok, false);
	} finally { ipc.dispose(); await f.dispose(); }
});

test("two contexts of one conversation keep independent window bindings", async () => {
	const f = await fixture(), otherLease = randomUUID(), otherScope = f.scopeSessionId;
	try {
		await writeFile(join(f.directory, "computer-views", otherLease + ".json"), JSON.stringify({ version: 1, leaseId: otherLease, owner: f.owner, scopeSessionId: otherScope, expiresAt: Date.now() + 120000 }));
		await f.views.adopt(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" });
		await f.views.adopt(f.sender, { scopeSessionId: otherScope, leaseId: otherLease, origin: "local" });
		const original = await f.views.guard(f.sender, f.scopeSessionId, f.leaseId);
		f.views.release(f.sender, { scopeSessionId: otherScope, leaseId: otherLease, origin: "local" });
		assert.equal(original.valid(), true);
		assert.equal((await f.store.read(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" })).ok, true);
		await assert.rejects(f.views.guard(f.sender, otherScope, otherLease));
	} finally { await f.dispose(); }
});

test("an adopted view still refuses corrupt PNG bytes and a symlinked output", async () => {
	const f = await fixture(), output = join(f.directory, "outputs", hash(f.frame.sessionId), f.frameId + ".bin");
	try {
		await f.views.adopt(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, origin: "local" });
		await writeFile(output, Buffer.alloc(png.length));
		await assert.rejects(f.store.read(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" }));
		await unlink(output);
		const outside = join(f.directory, "native-source.png"); await writeFile(outside, png);
		try { await symlink(outside, output); }
		catch (error) { if (error.code === "EPERM" && process.platform === "win32") return; throw error; }
		await assert.rejects(f.store.read(f.sender, { scopeSessionId: f.scopeSessionId, leaseId: f.leaseId, frameId: f.frameId, origin: "local" }));
		assert.deepEqual(await readFile(outside), png);
	} finally { await f.dispose(); }
});
