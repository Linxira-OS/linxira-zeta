import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { foldVisible, MAX_VISIBLE_SESSIONS, sortProjects, sortSessions, splitZones, timeGroupOf, timeGroups } =
	await jiti.import("../lib/sidebar-groups.ts");

// Fixed "now": 2026-09-16 12:00 local.
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const H = 3_600_000;

function s(id, over = {}) {
	return { id, projectKey: "/p1", updatedAt: NOW, title: id, ...over };
}

test("timeGroupOf boundaries: 23:59 yesterday vs 00:01 today", () => {
	const todayStart = new Date(2026, 8, 16, 0, 0, 0).getTime();
	assert.equal(timeGroupOf(todayStart - 60_000, NOW), "yesterday"); // 23:59
	assert.equal(timeGroupOf(todayStart + 60_000, NOW), "today"); // 00:01
	assert.equal(timeGroupOf(NOW - 3 * 86_400_000, NOW), "thisWeek");
	assert.equal(timeGroupOf(NOW - 30 * 86_400_000, NOW), "older");
	assert.equal(timeGroupOf(undefined, NOW), "older");
});

test("timeGroups: today renders without a label; empty groups omitted", () => {
	const groups = timeGroups(
		[
			s("a", { updatedAt: NOW }),
			s("b", { updatedAt: NOW - 30 * 86_400_000 }),
			s("c", { updatedAt: NOW - 2 * 86_400_000 }),
		],
		NOW,
	);
	assert.deepEqual(
		groups.map((g) => [g.key, g.label]),
		[
			["today", null],
			["thisWeek", "thisWeek"],
			["older", "older"],
		],
	);
});

test("timeGroups: 2 days ago lands in thisWeek", () => {
	const groups = timeGroups([s("c", { updatedAt: NOW - 2 * 86_400_000 })], NOW);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].key, "thisWeek");
});

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

test("splitZones: pins float out, temp excluded, groups sorted", () => {
	const zones = splitZones(
		[
			s("pinned", { projectKey: "/p1" }),
			s("t1", { temp: true, projectKey: "" }),
			s("p2new", { projectKey: "/p2", updatedAt: NOW }),
			s("p1old", { projectKey: "/p1", updatedAt: NOW - 9 * 86_400_000 }),
			s("p1new", { projectKey: "/p1", updatedAt: NOW - H }),
		],
		"recent",
		(id) => (id === "pinned" ? { pinned: true } : undefined),
	);
	assert.deepEqual(zones.pinned.map((r) => r.id), ["pinned"]);
	assert.deepEqual(zones.temp.map((r) => r.id), ["t1"]);
	// Groups ordered by most recently active project first (/p2 is newer).
	assert.deepEqual(zones.projectRows.map((g) => g.project), ["/p2", "/p1"]);
	assert.deepEqual(zones.projectRows[1].sessions.map((r) => r.id), ["p1new", "p1old"]);
});

test("foldVisible caps at 10 and reports hidden count", () => {
	const items = Array.from({ length: 13 }, (_, i) => s(`s${i}`));
	const folded = foldVisible(items, false);
	assert.equal(folded.visible.length, MAX_VISIBLE_SESSIONS);
	assert.equal(folded.hidden, 3);
	assert.equal(foldVisible(items, true).hidden, 0);
	assert.equal(foldVisible(items.slice(0, 3), false).hidden, 0);
});
