import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// In-memory storage stub shaped like the globalThis.localStorage surface.
function makeStorage(initial = new Map()) {
	const map = new Map(initial);
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		_dump: () => map,
	};
}

async function loadModule(storage) {
	const savedWindow = globalThis.window;
	globalThis.window = { localStorage: storage };
	const mod = await jiti.import("../lib/sidebar-prefs.ts");
	mod.resetPrefsCacheForTest();
	return { mod, storage, restore: () => (savedWindow === undefined ? delete globalThis.window : (globalThis.window = savedWindow)) };
}

const LEGACY = {
	pinnedSessions: "zeta-web:sidebar-pinned",
	aliases: "zeta-web:sidebar-project-aliases",
	pinnedProjects: "zeta-web:sidebar-pinned-projects",
	collapsedProjects: "zeta-web:sidebar-collapsed-projects",
	display: "zeta-web:sidebar-display",
};

test("migration folds all P1 keys into the unified schema and deletes them", async () => {
	const storage = makeStorage(
		new Map([
			[LEGACY.pinnedSessions, JSON.stringify(["sess-a", "sess-b"])],
			[LEGACY.aliases, JSON.stringify({ "/p/one": "One Alias" })],
			[LEGACY.pinnedProjects, JSON.stringify(["/p/two"])],
			[LEGACY.collapsedProjects, JSON.stringify(["/p/three"])],
			[LEGACY.display, JSON.stringify({ projectSort: "a-z", sessionGrouping: "flat", showRecent: false })],
		]),
	);
	const { mod, restore } = await loadModule(storage);
	const prefs = mod.loadSidebarPrefs();
	assert.equal(prefs.sessionMeta["sess-a"].pinned, true);
	assert.equal(prefs.sessionMeta["sess-b"].pinned, true);
	assert.equal(prefs.projectMeta["/p/one"].name, "One Alias");
	assert.equal(prefs.projectMeta["/p/two"].pinned, true);
	assert.equal(prefs.projectMeta["/p/three"].collapsed, true);
	assert.equal(prefs.projectSort, "name"); // a-z → name
	for (const key of Object.values(LEGACY)) assert.equal(storage.getItem(key), null, key);
	assert.ok(storage.getItem(mod.SIDEBAR_PREFS_KEY));
	restore();
});

test("legacy date-added sort maps to created; manual survives", async () => {
	const storage = makeStorage(new Map([[LEGACY.display, JSON.stringify({ projectSort: "date-added" })]]));
	const { mod, restore } = await loadModule(storage);
	assert.equal(mod.loadSidebarPrefs().projectSort, "created");
	restore();

	const storage2 = makeStorage(new Map([[LEGACY.display, JSON.stringify({ projectSort: "manual" })]]));
	const { mod: mod2, restore: restore2 } = await loadModule(storage2);
	assert.equal(mod2.loadSidebarPrefs().projectSort, "manual");
	restore2();
});

test("corrupt JSON falls back to defaults without throwing", async () => {
	const storage = makeStorage(new Map([["zeta-web:sidebar-preferences-v2", "{not json"]]));
	const { mod, restore } = await loadModule(storage);
	const prefs = mod.loadSidebarPrefs();
	assert.deepEqual(prefs, { ...mod.DEFAULT_PREFS });
	restore();
});

test("unknown sort values clamp to defaults; oversize alias truncated", async () => {
	const v2 = "zeta-web:sidebar-preferences-v2";
	const storage = makeStorage(
		new Map([
			[v2, JSON.stringify({ projectSort: "bogus", sessionView: { sort: "nope" }, projectMeta: { "/p": { name: "x".repeat(200) } } })],
		]),
	);
	const { mod, restore } = await loadModule(storage);
	const prefs = mod.loadSidebarPrefs();
	assert.equal(prefs.projectSort, "recent");
	assert.equal(prefs.sessionView.sort, "recent");
	assert.equal(prefs.projectMeta["/p"].name.length, 80);
	restore();
});

test("updatePrefs round-trips through storage and cache", async () => {
	const storage = makeStorage();
	const { mod, restore } = await loadModule(storage);
	mod.pinSession("s1", true);
	mod.setProjectAlias("/p", "Renamed");
	mod.reorderProjects(["/p", "/q"]);
	const prefs = mod.loadSidebarPrefs();
	assert.equal(prefs.sessionMeta.s1.pinned, true);
	assert.equal(prefs.projectMeta["/p"].name, "Renamed");
	assert.equal(prefs.projectMeta["/p"].order, 0);
	assert.equal(prefs.projectMeta["/q"].order, 1);
	assert.equal(prefs.projectSort, "manual");
	// A second module instance over the same storage sees the same state.
	const storage2 = makeStorage(storage._dump());
	const { mod: mod2, restore: restore2 } = await loadModule(storage2);
	assert.equal(mod2.loadSidebarPrefs().sessionMeta.s1.pinned, true);
	restore2();
	restore();
});

test("markSessionRead records readAt used by unread badges", async () => {
	const storage = makeStorage();
	const { mod, restore } = await loadModule(storage);
	mod.markSessionRead("s9", 1234);
	assert.equal(mod.loadSidebarPrefs().sessionMeta.s9.readAt, 1234);
	restore();
});
