import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const persist = await jiti.import("./session-tabs-persist.ts");

const KEY = "zeta-web:session-tabs-v1";

function makeStorage(initial = new Map()) {
	const map = new Map(initial);
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		_dump: () => map,
	};
}

function session(id, overrides = {}) {
	return {
		id,
		kind: "session",
		sessionId: id,
		draftCwd: null,
		projectRoot: "/repo",
		title: id,
		openedAt: 1,
		lastActiveAt: 1,
		explicitNew: false,
		...overrides,
	};
}

function draft(id, overrides = {}) {
	return {
		id,
		kind: "draft",
		sessionId: null,
		draftCwd: "/repo",
		projectRoot: "/repo",
		title: "New",
		openedAt: 1,
		lastActiveAt: 1,
		explicitNew: true,
		...overrides,
	};
}

test("round-trips order, active id and tab metadata", () => {
	const state = {
		tabs: [session("s-a", { lastActiveAt: 20 }), draft("t:d", { lastActiveAt: 10 })],
		activeTabId: "t:d",
	};
	assert.deepEqual(persist.decodeSessionTabs(persist.encodeSessionTabs(state)), state);
});

test("stores only the view list (no chat content, no runtime metadata)", () => {
	const encoded = JSON.parse(persist.encodeSessionTabs({ tabs: [session("s-a")], activeTabId: "s-a" }));
	assert.equal(encoded.version, 1);
	assert.equal(encoded.activeTabId, "s-a");
	assert.deepEqual(Object.keys(encoded.tabs[0]).sort(), [
		"draftCwd",
		"explicitNew",
		"id",
		"kind",
		"lastActiveAt",
		"openedAt",
		"projectRoot",
		"sessionId",
		"title",
	]);
});

test("rejects absent, oversized, corrupt and structurally wrong payloads", () => {
	assert.equal(persist.decodeSessionTabs(null), null);
	assert.equal(persist.decodeSessionTabs(""), null);
	assert.equal(persist.decodeSessionTabs("{not json"), null);
	assert.equal(persist.decodeSessionTabs("null"), null);
	assert.equal(persist.decodeSessionTabs("[]"), null);
	assert.equal(persist.decodeSessionTabs(JSON.stringify({ version: 1, tabs: "nope" })), null);
	assert.equal(persist.decodeSessionTabs("x".repeat(70 * 1024)), null);
});

test("an unknown schema version is ignored rather than guessed at", () => {
	const payload = JSON.stringify({ version: 2, activeTabId: "s-a", tabs: [session("s-a")] });
	assert.equal(persist.decodeSessionTabs(payload), null);
	const noVersion = JSON.stringify({ activeTabId: "s-a", tabs: [session("s-a")] });
	assert.equal(persist.decodeSessionTabs(noVersion), null);
});

test("drops invalid rows and keeps the rest of the strip", () => {
	const payload = JSON.stringify({
		version: 1,
		activeTabId: "s-a",
		tabs: [
			session("s-a"),
			{ ...session("s-b"), kind: "mystery" },
			{ ...session("s-c"), sessionId: null },
			{ ...session("s-d"), id: "" },
			{ ...session("s-e"), lastActiveAt: "soon" },
			{ ...draft("t:d"), sessionId: "s-draft" },
			{ ...session("s-f"), openedAt: Number.NaN },
			null,
			"tab",
		],
	});
	const decoded = persist.decodeSessionTabs(payload);
	assert.deepEqual(
		decoded.tabs.map((tab) => tab.id),
		["s-a"],
	);
	assert.equal(decoded.activeTabId, "s-a");
});

test("de-duplicates tab ids and session views", () => {
	const payload = JSON.stringify({
		version: 1,
		activeTabId: "s-a",
		tabs: [session("s-a", { title: "first" }), session("s-a", { title: "dupe" }), session("s-a2", { sessionId: "s-a" })],
	});
	const decoded = persist.decodeSessionTabs(payload);
	assert.equal(decoded.tabs.length, 1);
	assert.equal(decoded.tabs[0].title, "first");
});

test("normalizes session-only fields on restored tabs", () => {
	const payload = JSON.stringify({
		version: 1,
		activeTabId: "s-a",
		tabs: [
			session("s-a", { draftCwd: "/stale", explicitNew: true, title: 42, projectRoot: 7 }),
			draft("t:d", { explicitNew: "yes" }),
		],
	});
	const [sessionTab, draftTab] = persist.decodeSessionTabs(payload).tabs;
	assert.equal(sessionTab.draftCwd, null);
	assert.equal(sessionTab.explicitNew, false);
	assert.equal(sessionTab.title, "");
	assert.equal(sessionTab.projectRoot, null);
	assert.equal(draftTab.explicitNew, false);
});

test("evicts the least recently active tabs over the 12-tab cap, never the active one", () => {
	const tabs = Array.from({ length: 14 }, (_, index) =>
		session(`s-${index}`, { lastActiveAt: index + 1, openedAt: index + 1 }),
	);
	// The active tab is the oldest one on purpose: restore must keep it.
	const decoded = persist.decodeSessionTabs(
		JSON.stringify({ version: 1, activeTabId: "s-0", tabs }),
	);
	assert.equal(decoded.tabs.length, 12);
	assert.deepEqual(
		decoded.tabs.map((tab) => tab.id),
		["s-0", ...tabs.slice(3).map((tab) => tab.id)],
	);
	assert.equal(decoded.activeTabId, "s-0");

	// Without a pinned active tab the two oldest go instead.
	const trimmed = persist.decodeSessionTabs(
		JSON.stringify({ version: 1, activeTabId: "s-13", tabs }),
	);
	assert.equal(trimmed.tabs.length, 12);
	assert.equal(trimmed.tabs[0].id, "s-2");
	assert.equal(trimmed.activeTabId, "s-13");
});

test("falls back to the most recently active tab when the stored active id is gone", () => {
	const decoded = persist.decodeSessionTabs(
		JSON.stringify({
			version: 1,
			activeTabId: "t:missing",
			tabs: [session("s-a", { lastActiveAt: 5 }), session("s-b", { lastActiveAt: 9 })],
		}),
	);
	assert.equal(decoded.activeTabId, "s-b");
});

test("a valid empty payload decodes to the empty state", () => {
	assert.deepEqual(persist.decodeSessionTabs(JSON.stringify({ version: 1, tabs: [], activeTabId: null })), {
		tabs: [],
		activeTabId: null,
	});
});

test("writes and reads the stored key, and survives storage failures", () => {
	const storage = makeStorage();
	const state = { tabs: [session("s-a")], activeTabId: "s-a" };
	persist.writePersistedSessionTabs(state, storage);
	assert.ok(storage.getItem(KEY));
	assert.deepEqual(persist.readPersistedSessionTabs(storage), state);

	const brokenWrite = {
		getItem: () => null,
		setItem: () => {
			throw new Error("QuotaExceededError");
		},
	};
	assert.doesNotThrow(() => persist.writePersistedSessionTabs(state, brokenWrite));

	const brokenRead = {
		getItem: () => {
			throw new Error("SecurityError");
		},
		setItem: () => {},
	};
	assert.equal(persist.readPersistedSessionTabs(brokenRead), null);
});
