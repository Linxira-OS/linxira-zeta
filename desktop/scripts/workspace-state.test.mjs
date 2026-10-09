import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	DEFAULT_WORKSPACE_STATE,
	isBoundsValid,
	isToolId,
	lastZetacodeLaunch,
	newestSessionFile,
	parseWorkspaceState,
	readWorkspaceState,
	withLaunch,
	writeWorkspaceStateAtomic,
	MAX_LAUNCH_RECORDS,
} from "../src/workspace-state.ts";

test("parseWorkspaceState defaults on missing/corrupt payloads", () => {
	assert.deepEqual(parseWorkspaceState("not json"), { ...DEFAULT_WORKSPACE_STATE, launches: [] });
	assert.deepEqual(parseWorkspaceState("null"), { ...DEFAULT_WORKSPACE_STATE, launches: [] });
	assert.deepEqual(parseWorkspaceState("[1,2]"), { ...DEFAULT_WORKSPACE_STATE, launches: [] });
	assert.deepEqual(parseWorkspaceState("{}"), { version: 1, bounds: null, maximized: false, launches: [] });
});

test("parseWorkspaceState keeps valid bounds and maximized, drops junk launches", () => {
	const parsed = parseWorkspaceState(
		JSON.stringify({
			bounds: { x: 10, y: 20, width: 1440, height: 900 },
			maximized: true,
			launches: [
				{ tool: "zetacode", cwd: "/repo", pid: 1, ts: "2026-01-01", sessionDir: "/tmp/s" },
				{ tool: "emacs", cwd: "/repo", pid: 2, ts: "2026-01-01" },
				{ tool: "zetaide", cwd: "", pid: 3, ts: "2026-01-01" },
			],
		}),
	);
	assert.deepEqual(parsed.bounds, { x: 10, y: 20, width: 1440, height: 900 });
	assert.equal(parsed.maximized, true);
	assert.equal(parsed.launches.length, 1);
	assert.equal(parsed.launches[0].sessionDir, "/tmp/s");
});

test("isToolId whitelists the three products only", () => {
	assert.equal(isToolId("zetacode"), true);
	assert.equal(isToolId("zetaide"), true);
	assert.equal(isToolId("zetaeditor"), true);
	assert.equal(isToolId("zeta"), false);
	assert.equal(isToolId("rm -rf /"), false);
	assert.equal(isToolId(42), false);
});

test("withLaunch truncates to the newest MAX_LAUNCH_RECORDS", () => {
	let state = { ...DEFAULT_WORKSPACE_STATE, launches: [] };
	for (let i = 0; i < MAX_LAUNCH_RECORDS + 5; i++) {
		state = withLaunch(state, { tool: "zetaeditor", cwd: "/repo", pid: i, ts: `t${i}` });
	}
	assert.equal(state.launches.length, MAX_LAUNCH_RECORDS);
	assert.equal(state.launches[0].pid, 5);
	assert.equal(state.launches.at(-1).pid, MAX_LAUNCH_RECORDS + 4);
});

test("lastZetacodeLaunch only matches same cwd with a sessionDir", () => {
	let state = { ...DEFAULT_WORKSPACE_STATE, launches: [] };
	state = withLaunch(state, { tool: "zetacode", cwd: "/a", pid: 1, ts: "t1", sessionDir: "/s/1" });
	state = withLaunch(state, { tool: "zetacode", cwd: "/b", pid: 2, ts: "t2", sessionDir: "/s/2" });
	state = withLaunch(state, { tool: "zetaide", cwd: "/a", pid: 3, ts: "t3" });
	assert.equal(lastZetacodeLaunch(state, "/a").sessionDir, "/s/1");
	assert.equal(lastZetacodeLaunch(state, "/b").sessionDir, "/s/2");
	assert.equal(lastZetacodeLaunch(state, "/c"), null);
});

test("isBoundsValid requires visible overlap with at least one work area", () => {
	const workAreas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
	assert.equal(isBoundsValid({ x: 100, y: 100, width: 800, height: 600 }, workAreas), true);
	// Fully off-screen (e.g. unplugged second monitor) → invalid.
	assert.equal(isBoundsValid({ x: 3000, y: 100, width: 800, height: 600 }, workAreas), false);
	// Barely touching the edge (< minVisiblePx) → invalid.
	assert.equal(isBoundsValid({ x: -760, y: 100, width: 800, height: 600 }, workAreas), false);
	assert.equal(isBoundsValid(null, workAreas), false);
});

test("atomic write round-trips and leaves no temp files", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-workspace-state-"));
	try {
		assert.deepEqual(readWorkspaceState(dir), { ...DEFAULT_WORKSPACE_STATE, launches: [] });
		const state = withLaunch(
			{ version: 1, bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: false, launches: [] },
			{ tool: "zetacode", cwd: "/repo", pid: 7, ts: "t", sessionDir: "/s" },
		);
		writeWorkspaceStateAtomic(dir, state);
		assert.deepEqual(readWorkspaceState(dir), state);
		assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith(".tmp")), []);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("newestSessionFile picks the most recently modified .jsonl", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-sessions-"));
	try {
		assert.equal(newestSessionFile(dir), null);
		const older = path.join(dir, "a.jsonl");
		const newer = path.join(dir, "b.jsonl");
		fs.writeFileSync(older, "{}\n");
		fs.writeFileSync(newer, "{}\n");
		fs.writeFileSync(path.join(dir, "ignore.txt"), "x");
		const past = new Date(Date.now() - 60_000);
		fs.utimesSync(older, past, past);
		assert.equal(newestSessionFile(dir), newer);
		assert.equal(newestSessionFile(path.join(dir, "missing")), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
