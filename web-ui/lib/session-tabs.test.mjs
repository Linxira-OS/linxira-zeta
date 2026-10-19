import assert from "node:assert/strict";
import test from "node:test";

import {
	activateTab,
	closeOtherTabs,
	closeTab,
	closeTabs,
	closeTabsToRight,
	draftKeyForTab,
	draftTab,
	EMPTY_TABS_STATE,
	evictionCandidate,
	findTabBySessionId,
	insertTab,
	isTabRunning,
	MAX_BACKGROUND_STREAMS,
	reorderTabs,
	selectRunningTabIds,
	selectStreamingTabIds,
	sessionTab,

	updateTab,
} from "./session-tabs.ts";

const SESSION_A = { id: "s-a", cwd: "/repo/a", projectRoot: "/repo" };
const SESSION_B = { id: "s-b", cwd: "/repo/b" };

function tabA(now = 1) {
	return sessionTab(SESSION_A, { title: "A", now, id: "t:a" });
}
function tabB(now = 2) {
	return sessionTab(SESSION_B, { title: "B", now, id: "t:b" });
}

test("session tabs take projectRoot, falling back to cwd", () => {
	assert.equal(tabA().projectRoot, "/repo");
	assert.equal(tabB().projectRoot, "/repo/b");
	assert.equal(draftTab("/repo/c", { title: "New", explicitNew: true }).projectRoot, "/repo/c");
});

test("draft tabs with the same cwd keep separate draft keys (F5)", () => {
	const first = draftTab("/repo/c", { title: "New", explicitNew: true, id: "t:1" });
	const second = draftTab("/repo/c", { title: "New", explicitNew: true, id: "t:2" });
	assert.notEqual(draftKeyForTab(first), draftKeyForTab(second));
	assert.equal(draftKeyForTab(first), "draft:t:1");
});

test("session tabs keep the session id as draft key", () => {
	assert.equal(draftKeyForTab(tabA()), "s-a");
});

test("draft tabs keep the explicit-new flag (shared-coordinator drafts do not)", () => {
	assert.equal(draftTab("/repo/c", { title: "New", explicitNew: true }).explicitNew, true);
	assert.equal(draftTab("/repo/c", { title: "New", explicitNew: false }).explicitNew, false);
	assert.equal(tabA().explicitNew, false);
});

test("insertTab appends by default and activates the new tab", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	assert.deepEqual(
		state.tabs.map(t => t.id),
		["t:a", "t:b"],
	);
	assert.equal(state.activeTabId, "t:b");
});

test("insertTab honours an explicit index and activate:false", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2), { index: 0, activate: false });
	assert.deepEqual(
		state.tabs.map(t => t.id),
		["t:b", "t:a"],
	);
	assert.equal(state.activeTabId, "t:a");
});

test("activateTab refreshes the LRU stamp and ignores unknown ids", () => {
	const state = insertTab(EMPTY_TABS_STATE, tabA(1));
	const later = activateTab(state, "t:a", 50);
	assert.equal(later.tabs[0].lastActiveAt, 50);
	assert.equal(activateTab(state, "t:missing", 50), state);
});

test("closing the active tab activates the right neighbour, else the left", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	state = insertTab(state, sessionTab({ id: "s-c", cwd: "/repo/c" }, { title: "C", now: 3, id: "t:c" }));

	const middle = activateTab(state, "t:b", 10);
	const afterMiddleClose = closeTab(middle, "t:b");
	assert.deepEqual(
		afterMiddleClose.tabs.map(t => t.id),
		["t:a", "t:c"],
	);
	assert.equal(afterMiddleClose.activeTabId, "t:c");

	const afterLastClose = closeTab(afterMiddleClose, "t:c");
	assert.equal(afterLastClose.activeTabId, "t:a");

	const empty = closeTab(afterLastClose, "t:a");
	assert.deepEqual(empty, EMPTY_TABS_STATE);
});

test("closing a background tab leaves the active tab alone", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	const next = closeTab(state, "t:a");
	assert.equal(next.activeTabId, "t:b");
});

test("closeTabs drops every listed tab and re-homes the active one", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	state = insertTab(state, sessionTab({ id: "s-c", cwd: "/repo/c" }, { title: "C", now: 3, id: "t:c" }));
	const next = closeTabs(state, ["t:b", "t:c"]);
	assert.deepEqual(
		next.tabs.map(t => t.id),
		["t:a"],
	);
	assert.equal(next.activeTabId, "t:a");
});

function threeTabs() {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	return insertTab(state, sessionTab({ id: "s-c", cwd: "/repo/c" }, { title: "C", now: 3, id: "t:c" }));
}

test("close other tabs keeps the target tab active", () => {
	const state = threeTabs();
	const next = closeOtherTabs(state, "t:a");
	assert.deepEqual(
		next.tabs.map(t => t.id),
		["t:a"],
	);
	assert.equal(next.activeTabId, "t:a");
	assert.equal(closeOtherTabs(state, "t:missing"), state);
});

test("close tabs to the right follows strip order and the close-successor rule", () => {
	const state = threeTabs();
	const next = closeTabsToRight(state, "t:a");
	assert.deepEqual(
		next.tabs.map(t => t.id),
		["t:a"],
	);
	assert.equal(next.activeTabId, "t:a");

	// Closing from the middle drops only the right-hand tab; the active tab
	// (left of it) is untouched.
	const active = activateTab(state, "t:b", 10);
	const middle = closeTabsToRight(active, "t:b");
	assert.deepEqual(
		middle.tabs.map(t => t.id),
		["t:a", "t:b"],
	);
	assert.equal(middle.activeTabId, "t:b");

	// Nothing to the right: the state is returned unchanged.
	assert.equal(closeTabsToRight(state, "t:c"), state);
	assert.equal(closeTabsToRight(state, "t:missing"), state);
});

test("updateTab patches one tab and findTabBySessionId locates it", () => {
	const state = insertTab(EMPTY_TABS_STATE, tabA(1));
	const next = updateTab(state, "t:a", { title: "Renamed", sessionId: "s-a2" });
	assert.equal(next.tabs[0].title, "Renamed");
	assert.equal(findTabBySessionId(next.tabs, "s-a2")?.id, "t:a");
	assert.equal(findTabBySessionId(next.tabs, "s-a"), null);
	assert.equal(updateTab(state, "t:missing", { title: "x" }), state);
});

test("reorderTabs moves a tab without touching the active id", () => {
	let state = insertTab(EMPTY_TABS_STATE, tabA(1));
	state = insertTab(state, tabB(2));
	state = insertTab(state, sessionTab({ id: "s-c", cwd: "/repo/c" }, { title: "C", now: 3, id: "t:c" }));
	const next = reorderTabs(state, 2, 0);
	assert.deepEqual(
		next.tabs.map(t => t.id),
		["t:c", "t:a", "t:b"],
	);
	assert.equal(next.activeTabId, "t:c");
	assert.equal(reorderTabs(state, 5, 0), state);
	assert.equal(reorderTabs(state, 0, 0), state);
});

test("evictionCandidate picks the least recently used evictable tab", () => {
	const tabs = [tabA(10), tabB(5)].concat(draftTab("/repo/c", { title: "New", explicitNew: true, now: 30, id: "t:d" }));
	assert.equal(evictionCandidate(tabs, () => true)?.id, "t:b");
	assert.equal(evictionCandidate(tabs, tab => tab.id === "t:a")?.id, "t:a");
	assert.equal(evictionCandidate(tabs, () => false), null);
});

test("isTabRunning reads both the shared poll and the tab's live run state", () => {
	assert.equal(isTabRunning(tabA(), { runningSessionIds: new Set(["s-a"]) }), true);
	assert.equal(isTabRunning(tabA(), { runningSessionIds: new Set() }), false);
	assert.equal(isTabRunning(tabA(), { runningSessionIds: new Set(), runningTabIds: new Set(["t:a"]) }), true);
	// Drafts have no server session, so only their own live run state counts.
	assert.equal(isTabRunning(draftTab("/repo/c", { title: "New", explicitNew: true, id: "t:d" }), { runningSessionIds: new Set(["s-a"]) }), false);
});

test("running badge covers cold tabs through the shared poll, without a new signal", () => {
	const tabs = [tabA(), tabB(), draftTab("/repo/c", { title: "New", explicitNew: true, id: "t:d" })];
	const ids = selectRunningTabIds({
		tabs,
		// t:a is running per the gateway poll; t:b reported a live run itself.
		runningSessionIds: new Set(["s-a"]),
		runningTabIds: new Set(["t:b"]),
	});
	assert.deepEqual([...ids].sort(), ["t:a", "t:b"]);

	// The poll alone can only name session tabs.
	assert.deepEqual([...selectRunningTabIds({ tabs, runningSessionIds: new Set(["s-b"]) })], ["t:b"]);
	// Draft tabs have no session, so only their own run state can badge them.
	assert.deepEqual([...selectRunningTabIds({ tabs, runningSessionIds: new Set(["s-a"]), runningTabIds: new Set(["t:d"]) })].sort(), [
		"t:a",
		"t:d",
	]);
});

test("stream budget: active always streams, idle background tabs never do", () => {
	const tabs = [tabA(10), tabB(5), draftTab("/repo/c", { title: "New", explicitNew: true, now: 1, id: "t:d" })];
	const streaming = selectStreamingTabIds({
		tabs,
		activeTabId: "t:d",
		runningSessionIds: new Set(["s-b"]),
	});
	assert.deepEqual([...streaming], ["t:d", "t:b"]);
});

test("stream budget keeps at most two running background tabs, MRU first", () => {
	const tabs = [
		sessionTab({ id: "s-1", cwd: "/w/1" }, { title: "1", now: 40, id: "t:1" }),
		sessionTab({ id: "s-2", cwd: "/w/2" }, { title: "2", now: 30, id: "t:2" }),
		sessionTab({ id: "s-3", cwd: "/w/3" }, { title: "3", now: 20, id: "t:3" }),
		sessionTab({ id: "s-4", cwd: "/w/4" }, { title: "4", now: 10, id: "t:4" }),
	];
	const streaming = selectStreamingTabIds({
		tabs,
		activeTabId: "t:1",
		runningSessionIds: new Set(["s-2", "s-3", "s-4"]),
	});
	assert.deepEqual([...streaming], ["t:1", "t:2", "t:3"]);
	assert.equal(streaming.size, MAX_BACKGROUND_STREAMS + 1);

	const oneSlot = selectStreamingTabIds({
		tabs,
		activeTabId: "t:4",
		runningSessionIds: new Set(["s-1", "s-2", "s-3"]),
		maxBackgroundStreams: 1,
	});
	assert.deepEqual([...oneSlot], ["t:4", "t:1"]);
});

test("a live run reported by the tab itself counts toward the budget", () => {
	const tabs = [
		sessionTab({ id: "s-1", cwd: "/w/1" }, { title: "1", now: 40, id: "t:1" }),
		sessionTab({ id: "s-2", cwd: "/w/2" }, { title: "2", now: 30, id: "t:2" }),
	];
	const streaming = selectStreamingTabIds({
		tabs,
		activeTabId: "t:1",
		runningSessionIds: new Set(),
		runningTabIds: new Set(["t:2"]),
	});
	assert.deepEqual([...streaming], ["t:1", "t:2"]);
});
