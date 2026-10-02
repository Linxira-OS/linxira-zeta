import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("only Shift+click bypasses session deletion confirmation (SessionNodeItem)", async () => {
	const itemSource = await readFile(new URL("./sidebar/SessionNodeItem.tsx", import.meta.url), "utf8");
	assert.match(
		itemSource,
		/const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
	);
});

test("polls running sessions only while the tab is visible", () => {
	assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
	assert.match(source, /fetch\("\/api\/agent\/running"/);
	assert.match(source, /document\.visibilityState !== "visible"/);
	assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("no hero action row or permanent new-session buttons remain", () => {
	assert.doesNotMatch(source, /ze-btn-hero/);
	assert.doesNotMatch(source, /Action row/);
	assert.doesNotMatch(source, /NewSessionDialog/);
	assert.doesNotMatch(source, /onNewWorkspace/);
});

test("new-session entry falls back to the default workspace before null cwd", () => {
	assert.match(source, /defaultWorkspacePath/);
	assert.match(source, /startNewSession/);
	// The shell callback accepts a nullable cwd.
	const shell = source.match(/onNewSession\?: \(sessionId: string, cwd: string \| null\) => void;/);
	assert.ok(shell, "sidebar onNewSession prop must accept string | null cwd");
});

test("project group actions live in the hover cluster, not a permanent row", async () => {
	const listSource = await readFile(new URL("./sidebar/SidebarProjectsList.tsx", import.meta.url), "utf8");
	assert.doesNotMatch(listSource, /sidebar-group-actions/);
	assert.match(listSource, /opacity: active \? 1 : 0/);
	assert.match(listSource, /pointerEvents: active \? "auto" : "none"/);
});

test("no time-bucket grouping remains in the project list path", async () => {
	const groupSource = await readFile(new URL("./sidebar/SessionGroupSection.tsx", import.meta.url), "utf8");
	assert.doesNotMatch(groupSource, /bucketLabels/);
	assert.doesNotMatch(source, /BUCKET_LABELS/);
	assert.match(source, /!searching \?/);
});
