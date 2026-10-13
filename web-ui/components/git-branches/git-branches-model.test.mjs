import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { branchListState, loadBranches, orderBranches, switchBranch } = await jiti.import(
	"@/components/git-branches/git-branches-model",
);

/** fetch stub: records the call and answers with the given status/body. */
function stubFetch(status, body, calls) {
	return async (input, init) => {
		calls.push({ input, init });
		return new Response(body === undefined ? "" : JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
}

test("orders the current branch first, then alphabetically", () => {
	const ordered = orderBranches([
		{ name: "zeta", current: false },
		{ name: "main", current: true },
		{ name: "feature/a", current: false },
	]);
	assert.deepEqual(
		ordered.map(b => b.name),
		["main", "feature/a", "zeta"],
	);
});

test("maps a git payload onto the ready state and flags the current branch", () => {
	const state = branchListState({
		isGitRepository: true,
		current: "main",
		branches: [
			{ name: "wip", current: false },
			{ name: "main", current: false },
		],
	});
	assert.equal(state.kind, "ready");
	assert.equal(state.current, "main");
	assert.deepEqual(
		state.branches.map(b => [b.name, b.current]),
		[
			["main", true],
			["wip", false],
		],
	);
});

test("a detached HEAD leaves every branch unflagged", () => {
	const state = branchListState({ isGitRepository: true, current: null, branches: [{ name: "main" }] });
	assert.equal(state.kind, "ready");
	assert.equal(state.current, null);
	assert.deepEqual(state.branches, [{ name: "main", current: false }]);
});

test("a non-repository payload and a malformed one are distinct states", () => {
	assert.equal(branchListState({ isGitRepository: false }).kind, "not-a-repo");
	assert.equal(branchListState(null).kind, "failed");
	assert.equal(branchListState("nope").kind, "failed");
});

test("no workspace is the empty state, not a failure", async () => {
	const calls = [];
	const state = await loadBranches(null, stubFetch(200, {}, calls));
	assert.equal(state.kind, "empty");
	assert.deepEqual(calls, []);
});

test("loadBranches encodes the cwd and surfaces a transport failure", async () => {
	const calls = [];
	const ready = await loadBranches("C:\\re pos", stubFetch(200, { isGitRepository: true, current: "main", branches: [] }, calls));
	assert.equal(ready.kind, "ready");
	assert.equal(calls[0].input, "/api/git/branches?cwd=C%3A%5Cre%20pos");

	const down = await loadBranches("/repo", stubFetch(500, { error: "boom" }, []));
	assert.equal(down.kind, "failed");
	assert.match(down.message, /HTTP 500/);

	const offline = await loadBranches("/repo", async () => {
		throw new Error("ECONNREFUSED");
	});
	assert.equal(offline.kind, "failed");
	assert.match(offline.message, /ECONNREFUSED/);
});

test("a successful checkout posts cwd+branch and reports the branch", async () => {
	const calls = [];
	const result = await switchBranch("/repo", "release/1.2.0", stubFetch(200, { ok: true, branch: "release/1.2.0" }, calls));
	assert.deepEqual(result, { ok: true, branch: "release/1.2.0" });
	assert.equal(calls[0].input, "/api/git/checkout");
	assert.equal(calls[0].init.method, "POST");
	assert.deepEqual(JSON.parse(calls[0].init.body), { cwd: "/repo", branch: "release/1.2.0" });
});

test("a dirty tree keeps the gateway's file count", async () => {
	const result = await switchBranch("/repo", "main", stubFetch(409, { error: "dirty", files: 3 }, []));
	assert.deepEqual(result, { ok: false, kind: "dirty", files: 3 });
});

test("a dirty tree without a count still reports dirty", async () => {
	const result = await switchBranch("/repo", "main", stubFetch(409, {}, []));
	assert.deepEqual(result, { ok: false, kind: "dirty", files: null });
});

test("a rejected switch carries the gateway's reason", async () => {
	const result = await switchBranch("/repo", "ghost", stubFetch(400, { error: "unknown branch: ghost" }, []));
	assert.equal(result.ok, false);
	assert.equal(result.kind, "rejected");
	assert.match(result.message, /unknown branch: ghost/);
});

test("a rejected switch without a body falls back to the status", async () => {
	const result = await switchBranch("/repo", "main", stubFetch(500, undefined, []));
	assert.deepEqual(result, { ok: false, kind: "rejected", message: "HTTP 500" });
});

test("a transport failure is its own outcome", async () => {
	const result = await switchBranch("/repo", "main", async () => {
		throw new Error("offline");
	});
	assert.deepEqual(result, { ok: false, kind: "request-failed" });
});
