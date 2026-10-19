import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

/** Body of a top-level `<ShellSlot name="…">` in the shell's layout call. */
function slotBody(name) {
	const match = source.match(new RegExp(`<ShellSlot name="${name}">([\\s\\S]*?)\\n\\t{4}</ShellSlot>`));
	return match ? match[1] : null;
}

test("the shell mode comes from the URL, with the route able to pin it", () => {
	assert.match(source, /export function AppShell\(\{ mode \}: \{ mode\?: ShellMode \} = \{\}\)/);
	assert.match(source, /<AppShellContent shellMode=\{mode\} \/>/);
	assert.match(
		source,
		/const shellMode = pinnedMode \?\? resolveShellMode\(searchParams\.get\(SHELL_MODE_PARAM\)\);[\s\S]*?const panel = shellMode === "panel";/,
	);
	assert.match(source, /<ShellLayout\n\t{4}mode=\{shellMode\}/);
});

test("chrome columns are handed to the layout as slots, not inlined in the center", () => {
	// Every region is a named slot; ShellLayout decides which ones exist.
	assert.match(source, /<ShellSlot name="sidebar">\{sidebarContent\}<\/ShellSlot>/);

	const topbar = slotBody("topbar");
	assert.ok(topbar, "top bar must be its own slot");
	assert.match(topbar, /ref=\{topBarRef\}/);
	assert.match(topbar, /<TopPanelChips/);

	const tabs = slotBody("tabs");
	assert.ok(tabs, "session tab strip must be its own slot");
	assert.match(tabs, /<SessionTabBar/);

	const center = slotBody("center");
	assert.ok(center, "conversation column must be its own slot");
	assert.match(center, /\{\/\* Chat content \*\/\}/);
	assert.ok(!center.includes("topBarRef"), "the center slot must not own the top bar");
	assert.ok(!center.includes("SessionTabBar"), "the center slot must not own the tab strip");

	assert.match(slotBody("rail"), /<DockRail/);
	assert.match(slotBody("dockWindow"), /<FileViewer/);
});

test("panel mode also drops the chrome that lives outside the layout", () => {
	// Self-drawn desktop titlebar and the mobile drawer backdrop are siblings of
	// ShellLayout, so they carry their own guard.
	assert.match(source, /\{desktopChrome && !panel && \(/);
	assert.match(source, /\{!panel && \(\n\t{4}<div\n\t{5}className=\{`sidebar-overlay-backdrop/);
	assert.match(source, /desktopChromeInset=\{desktopChrome && !panel \? 30 : 0\}/);
});

test("an explicit ?mode= survives the shell's own URL rewrites", () => {
	// Switching session inside a panel must not silently drop back to full
	// chrome — the two router.replace sites carry the parameter along.
	assert.match(source, /const modeParam = searchParams\.get\(SHELL_MODE_PARAM\);/);
	assert.match(source, /if \(modeParam\) params\.set\(SHELL_MODE_PARAM, modeParam\);/);
	assert.match(source, /router\.replace\(withMode\(new URLSearchParams\(\{ session: activeTab\.sessionId \}\)\)/);
	assert.match(source, /router\.replace\(withMode\(new URLSearchParams\(\)\)/);
	assert.ok(!source.includes("router.replace(`?session="), "session rewrite must keep the mode parameter");
	assert.ok(!source.includes('router.replace("/"'), "draft rewrite must keep the mode parameter");
});

test("a panel with nothing to show offers the composer instead of sidebar advice", () => {
	// DegradedDraftCard = workspace picker + hero composer, and picking creates
	// the draft tab; the two placeholders under it only make sense with a sidebar.
	assert.match(
		source,
		/\) : showPlaceholder \? \(\s+panel \? \([\s\S]*?<DegradedDraftCard onWorkspaceSelect=\{cwd => openDraftTab\(cwd, true\)\} \/>\s+\) : activeCwd \? \(/,
	);
});

test("the /panel route pins the mode instead of relying on a query parameter", async () => {
	const route = await readFile(new URL("../app/panel/page.tsx", import.meta.url), "utf8");

	assert.match(route, /<AppShell mode="panel" \/>/);
});

test("session tabs restore from the persisted view list and save back", () => {
	// The stored list is decoded before the first render, and restored tabs are
	// ordinary cold tabs (the hook mounts only the active tab's ChatWindow).
	assert.match(source, /const \[restoredTabs\] = useState\(\(\) => \(panel \? null : readPersistedSessionTabs\(\)\)\)/);
	assert.match(source, /const sessionTabs = useSessionTabs\(\{ initialState: restoredTabs \?\? undefined \}\)/);
	assert.match(source, /writePersistedSessionTabs\(\{ tabs, activeTabId \}\)/);
	// Panel mode is a host-mounted single-session surface: it must never
	// overwrite the full shell's tab list.
	assert.match(source, /useEffect\(\(\) => \{\n\t\tif \(panel\) return;\n\t\twritePersistedSessionTabs/);
});

test("every close path asks before discarding an unsent draft", () => {
	assert.match(source, /const confirmDiscardDrafts = useCallback/);
	assert.match(source, /hasUnsavedDraft\(tab\)/);
	assert.match(source, /tabs\.confirmCloseDraftFmt/);
	assert.match(source, /tabs\.confirmCloseDraftsFmt/);
	assert.match(source, /if \(confirmDiscardDrafts\(\[tabId\]\)\) sessionTabs\.close\(tabId\)/);
	assert.match(source, /if \(confirmDiscardDrafts\(others\)\) sessionTabs\.closeOthers\(tabId\)/);
	assert.match(source, /if \(confirmDiscardDrafts\(right\)\) sessionTabs\.closeRight\(tabId\)/);
});

test("the tab strip receives the right-click close family", () => {
	const tabsSlot = slotBody("tabs");
	assert.ok(tabsSlot, "tab strip slot must exist");
	assert.match(tabsSlot, /onCloseOthers=\{handleCloseOtherTabs\}/);
	assert.match(tabsSlot, /onCloseRight=\{handleCloseTabsRight\}/);
	// The running badge is fed from the shared poll as well, so a restored cold
	// tab shows it without a new request.
	assert.match(source, /selectRunningTabIds\(\{ tabs, runningSessionIds, runningTabIds: runningTabIdsFrom\(tabMeta\) \}\)/);
});
