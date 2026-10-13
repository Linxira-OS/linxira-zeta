import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { GitBranchesView } = await jiti.import("@/components/git-branches/GitBranchesView");
const { gitBranchesPanelEntry, GitBranchesIcon } = await jiti.import("@/components/git-branches/panel-entry");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(element) {
	return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const noop = () => {};

function renderView(overrides = {}) {
	return render(
		React.createElement(GitBranchesView, {
			cwd: "/repo",
			state: {
				kind: "ready",
				current: "main",
				branches: [
					{ name: "main", current: true },
					{ name: "wip", current: false },
				],
			},
			busyBranch: null,
			confirmBranch: null,
			error: null,
			onRequestSwitch: noop,
			onConfirmSwitch: noop,
			onCancelSwitch: noop,
			onRefresh: noop,
			...overrides,
		}),
	);
}

test("lists every branch, flags the current one and shows the count", () => {
	const html = renderView();
	assert.match(html, /class="git-branches"/);
	assert.match(html, /\/repo/);
	assert.match(html, /2 local branches/);
	assert.equal((html.match(/git-branches__row"/g) ?? []).length, 1);
	assert.equal((html.match(/git-branches__row--current/g) ?? []).length, 1);
	assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
	assert.match(html, /<span class="git-branches__badge">current<\/span>/);
	// The current row is not a switch target; the other one is.
	assert.match(html, /title="Switch to wip"/);
	assert.match(html, /<span class="git-branches__name">wip<\/span>/);
});

test("a pending switch renders the confirmation instead of switching outright", () => {
	const html = renderView({ confirmBranch: "wip" });
	assert.match(html, /role="alertdialog"/);
	assert.match(html, /Switch to wip\?/);
	assert.match(html, /uncommitted changes make the switch fail/);
	assert.match(html, /git-branches__button--primary/);
	assert.match(html, /<button type="button" class="git-branches__button">Cancel<\/button>/);
});

test("a busy switch names the branch and freezes every row", () => {
	const html = renderView({ confirmBranch: "wip", busyBranch: "wip" });
	assert.match(html, /Switching…/);
	// Both rows are inert while the gateway applies the checkout.
	assert.equal((html.match(/git-branches__row-button[^>]*disabled=""/g) ?? []).length, 2);
	const idle = renderView();
	assert.equal((idle.match(/git-branches__row-button[^>]*disabled=""/g) ?? []).length, 1);
});

test("a failed switch is announced, never silent", () => {
	const html = renderView({ error: "The working tree has 3 uncommitted change(s) — commit or stash them first." });
	assert.match(html, /role="alert"/);
	assert.match(html, /3 uncommitted change/);
});

test("a detached HEAD says so instead of flagging a row", () => {
	const html = renderView({
		state: { kind: "ready", current: null, branches: [{ name: "main", current: false }] },
	});
	assert.match(html, /HEAD is detached/);
	assert.equal((html.match(/aria-current="true"/g) ?? []).length, 0);
});

test("non-repository, empty and failed states each explain themselves", () => {
	assert.match(renderView({ state: { kind: "not-a-repo" } }), /not a git repository/);
	assert.match(renderView({ cwd: null, state: { kind: "empty" } }), /No workspace selected/);
	assert.match(renderView({ state: { kind: "failed", message: "HTTP 500" } }), /Could not read branches: HTTP 500/);
	assert.match(renderView({ state: { kind: "loading" } }), /Loading branches/);
});

test("the registry entry is a rail dock panel titled for the shell", () => {
	assert.equal(gitBranchesPanelEntry.id, "git");
	assert.equal(gitBranchesPanelEntry.titleKey, "dock.window.branches");
	assert.equal(gitBranchesPanelEntry.surface, "rail");
	assert.equal(gitBranchesPanelEntry.kind, "dock");
	assert.equal(gitBranchesPanelEntry.exclusive, true);
	assert.match(render(React.createElement(GitBranchesIcon, { size: 14 })), /width="14"/);
});
