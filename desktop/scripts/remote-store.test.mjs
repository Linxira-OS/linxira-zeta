import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { RemoteProfileStore } from "../dist/remote/store.js";

function workspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-remote-store-"));
	return { root, store: new RemoteProfileStore(root) };
}

test("profiles round-trip without persisting credentials", () => {
	const { root, store } = workspace();
	const saved = store.upsert({ name: "Build box", host: "build.example", authMode: "password", networkMode: "remote-first", user: "dev", port: 2222 });
	assert.equal(saved.name, "Build box");
	assert.equal(saved.port, 2222);
	const persisted = JSON.parse(fs.readFileSync(path.join(root, "remote-connections.json"), "utf8"));
	assert.equal("password" in persisted.profiles[0], false);
	assert.equal(persisted.profiles[0].authMode, "password");
	const reloaded = new RemoteProfileStore(root).load();
	assert.equal(reloaded.profiles.length, 1);
	assert.equal(reloaded.profiles[0].host, "build.example");
	fs.rmSync(root, { recursive: true, force: true });
});

test("active selection only accepts saved profiles", () => {
	const { root, store } = workspace();
	const saved = store.upsert({ name: "A", host: "a.example", authMode: "agent", networkMode: "remote-first" });
	store.select(saved.id);
	assert.equal(store.snapshot().activeId, saved.id);
	assert.throws(() => store.select("missing"));
	store.remove(saved.id);
	assert.equal(store.snapshot().activeId, null);
	fs.rmSync(root, { recursive: true, force: true });
});
