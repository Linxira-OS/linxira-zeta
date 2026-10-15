import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
	return import("./shell-mode.ts");
}

test("defaults to the full shell when the mode parameter is absent", async () => {
	const { resolveShellMode, DEFAULT_SHELL_MODE } = await loadSubject();

	assert.equal(DEFAULT_SHELL_MODE, "full");
	assert.equal(resolveShellMode(null), "full");
	assert.equal(resolveShellMode(undefined), "full");
	assert.equal(resolveShellMode(""), "full");
	assert.equal(resolveShellMode("   "), "full");
});

test("reads the embed mode from the mode parameter", async () => {
	const { resolveShellMode } = await loadSubject();

	assert.equal(resolveShellMode("embed"), "embed");
	assert.equal(resolveShellMode(" EMBED "), "embed");
	assert.equal(resolveShellMode("Embed"), "embed");
	assert.equal(resolveShellMode("full"), "full");
});

test("falls back to full for unknown mode values", async () => {
	const { resolveShellMode } = await loadSubject();

	assert.equal(resolveShellMode("mobile"), "full");
	assert.equal(resolveShellMode("0"), "full");
	assert.equal(resolveShellMode("true"), "full");
});

test("names the mode parameter, the embed route and the hidden chrome regions", async () => {
	const {
		SHELL_MODE_PARAM,
		EMBED_MODE_ROUTE,
		SHELL_MODES,
		EMBED_HIDDEN_SHELL_REGIONS,
		SHELL_REGION_ATTRIBUTE,
		SHELL_MODE_ATTRIBUTE,
	} = await loadSubject();

	assert.equal(SHELL_MODE_PARAM, "mode");
	assert.equal(EMBED_MODE_ROUTE, "/embed");
	assert.deepEqual([...SHELL_MODES], ["full", "embed"]);
	assert.equal(SHELL_REGION_ATTRIBUTE, "data-shell-region");
	assert.equal(SHELL_MODE_ATTRIBUTE, "data-shell-mode");
	assert.deepEqual([...EMBED_HIDDEN_SHELL_REGIONS].sort(), [
		"dockWindow",
		"rail",
		"sidebar",
		"tabs",
		"topbar",
	]);
	// The conversation column is never hidden — embed keeps exactly that.
	assert.ok(!EMBED_HIDDEN_SHELL_REGIONS.includes("center"));
});
