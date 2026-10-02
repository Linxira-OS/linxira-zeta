import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sortProjects, sortSessions, isFoldableEmptySession } =
	await jiti.import("../lib/sidebar-groups.ts");

// Fixed "now": 2026-09-16 12:00 local.
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const H = 3_600_000;

function s(id, over = {}) {
	return { id, projectKey: "/p1", updatedAt: NOW, title: id, ...over };
}

test("sortSessions: pinned always first, then sort key", () => {
	const rows = [
		s("new", { updatedAt: NOW }),
		s("old-pinned", { updatedAt: NOW - 10 * 86_400_000 }),
		s("mid", { updatedAt: NOW - H }),
	];
	const meta = new Map([["old-pinned", { pinned: true }]]);
	const out = sortSessions(rows, "recent", (id) => meta.get(id));
	assert.deepEqual(
		out.map((r) => r.id),
		["old-pinned", "new", "mid"],
	);
});

test("sortSessions: name mode ignores recency", () => {
	const rows = [s("b", { title: "banana" }), s("a", { title: "apple" })];
	const out = sortSessions(rows, "name", () => undefined);
	assert.deepEqual(
		out.map((r) => r.id),
		["a", "b"],
	);
});

test("sortProjects: pinned first, name sort, path tiebreak", () => {
	const out = sortProjects(
		[
			{ path: "/z", name: "zed" },
			{ path: "/a", pinned: true },
			{ path: "/m", name: "apple" },
		],
		"name",
	);
	assert.deepEqual(
		out.map((p) => p.path),
		["/a", "/m", "/z"],
	);
});

test("sortProjects: manual order respected", () => {
	const out = sortProjects(
		[
			{ path: "/a", order: 2 },
			{ path: "/b", order: 0 },
			{ path: "/c", order: 1 },
		],
		"manual",
	);
	assert.deepEqual(
		out.map((p) => p.path),
		["/b", "/c", "/a"],
	);
});

// ── D5 empty-session policy ──

const NOW_TS = new Date(2026, 8, 16, 12, 0, 0).getTime();
const HOURS = 3_600_000;

function emptyOpts(over = {}) {
	return { now: NOW_TS, isRunning: false, isPinned: false, ...over };
}

test("isFoldableEmptySession: only stale 0-message sessions fold", () => {
	const fresh = { messageCount: 0, modified: new Date(NOW_TS - 2 * HOURS).toISOString() };
	const stale = { messageCount: 0, modified: new Date(NOW_TS - 25 * HOURS).toISOString() };
	const active = { messageCount: 3, modified: new Date(NOW_TS - 48 * HOURS).toISOString() };
	assert.equal(isFoldableEmptySession(fresh, emptyOpts()), false); // <24h stays
	assert.equal(isFoldableEmptySession(stale, emptyOpts()), true); // >24h folds
	assert.equal(isFoldableEmptySession(active, emptyOpts()), false); // has messages
	assert.equal(isFoldableEmptySession(stale, emptyOpts({ isRunning: true })), false);
	assert.equal(isFoldableEmptySession(stale, emptyOpts({ isPinned: true })), false);
	assert.equal(isFoldableEmptySession({ messageCount: 0, modified: "bogus" }, emptyOpts()), true);
});
