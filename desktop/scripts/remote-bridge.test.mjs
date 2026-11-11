import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { RemoteBridge } from "../dist/remote/bridge.js";

function bridgeAt(root) {
	return new RemoteBridge({ userData: root, changed() {}, event() {}, log() {} });
}

test("an unconnected target rejects queries instead of falling back locally", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-remote-bridge-"));
	const bridge = bridgeAt(root);
	const profile = bridge.save({ name: "Box", host: "box.example", authMode: "agent", networkMode: "remote-first" });
	const inventory = bridge.inventory();
	assert.equal(inventory.profiles.length, 1);
	assert.equal(inventory.statuses[0].state, "disconnected");
	await assert.rejects(bridge.query(profile.id, { queryName: "workspaces.list" }), /RESYNC_REQUIRED/);
	await assert.rejects(bridge.command(profile.id, { commandName: "workspace.open" }), /RESYNC_REQUIRED/);
	assert.equal(bridge.baseUrl(profile.id), undefined);
	fs.rmSync(root, { recursive: true, force: true });
});

test("selection and removal stay keyed by connection id", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-remote-bridge-"));
	const bridge = bridgeAt(root);
	const first = bridge.save({ name: "A", host: "a.example", authMode: "agent", networkMode: "remote-first" });
	const second = bridge.save({ name: "B", host: "b.example", authMode: "agent", networkMode: "remote-only" });
	await bridge.select(first.id);
	assert.equal(bridge.inventory().activeId, first.id);
	await bridge.remove(first.id);
	assert.equal(bridge.inventory().activeId, null);
	assert.deepEqual(bridge.inventory().profiles.map(profile => profile.id), [second.id]);
	fs.rmSync(root, { recursive: true, force: true });
});
