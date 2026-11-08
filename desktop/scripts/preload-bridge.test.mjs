/**
 * The shipped renderer reads `window.zetaStudioChrome`; older/embedded hosts
 * read `window.piDesktop`. C1 of the installed-shell audit: both names must
 * expose the same capability object, or the installed app silently falls back
 * to browser behavior (no picker, no open-in-editor, no update check).
 *
 * The preload cannot be imported without Electron, so this guard reads the
 * source: it fails if either global disappears or the shared object loses a
 * capability the renderer feature-detects.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "preload.ts"), "utf8");

test("preload exposes the capability object under both renderer names", () => {
	assert.match(source, /contextBridge\.exposeInMainWorld\("piDesktop",\s*bridge\)/);
	assert.match(source, /contextBridge\.exposeInMainWorld\("zetaStudioChrome",\s*bridge\)/);
});

test("the shared bridge carries the audited desktop capabilities", () => {
	for (const capability of [
		"minimize:",
		"maximize:",
		"close:",
		"isMaximized:",
		"onWindowState:",
		"selectDirectory:",
		"pickWorkspace:",
		"getOpenTargets:",
		"openTarget:",
		"spawnTool:",
		"openProjectInEditor:",
		"openProjectDirectory:",
		"openFile:",
		"openFileWith:",
		"revealFileInFileManager:",
		"resolveFileAbsolutePath:",
		"listFileOpeners:",
		"getPathForFile:",
		"resolveDroppedPaths:",
		"pickPlanSavePath:",
		"getAppVersion:",
		"checkUpdates:",
		"onMenuCommand:",
	]) {
		assert.ok(source.includes(capability), `preload bridge is missing ${capability}`);
	}
});

test("the bridge has no desktop-only surface when loaded outside Electron", () => {
	// The object lives in preload.ts only: no web-app module may fabricate it.
	const studioDir = path.join(import.meta.dirname, "..", "..", "web-app", "src", "studio");
	const fabricated = fs
		.readdirSync(studioDir, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
		.filter(entry => {
			const file = fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8");
			return /(?:globalThis|window)\.zetaStudioChrome\s*=/.test(file);
		});
	assert.deepEqual(fabricated, []);
});
