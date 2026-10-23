import { describe, expect, it } from "bun:test";
import { type BackendSessionInfo, pickMostRecentSessionForCwd } from "../../src/backend/client";

function session(
	id: string,
	cwd: string,
	branch?: string,
	modified = "2026-10-24T00:00:00.000Z",
	tag?: string,
): BackendSessionInfo {
	return { id, cwd, branch, modified, created: modified, tag };
}

describe("attach session selection binds cwd and branch", () => {
	it("prefers the session on the same branch", () => {
		const sessions = [
			session("a", "/repo", "main", "2026-10-24T01:00:00.000Z"),
			session("b", "/repo", "feat/x", "2026-10-24T02:00:00.000Z"),
		];
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "main")?.id).toBe("a");
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "feat/x")?.id).toBe("b");
	});

	it("refuses to reuse a session from another branch", () => {
		const sessions = [session("a", "/repo", "main")];
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "feat/new")).toBeUndefined();
	});

	it("adopts branch-less legacy sessions so an upgrade keeps its transcript", () => {
		const sessions = [session("old", "/repo", undefined)];
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "main")?.id).toBe("old");
	});

	it("falls back to newest-by-cwd when the caller has no branch", () => {
		const sessions = [
			session("a", "/repo", "main", "2026-10-24T01:00:00.000Z"),
			session("b", "/repo", "feat/x", "2026-10-24T02:00:00.000Z"),
		];
		expect(pickMostRecentSessionForCwd(sessions, "/repo")?.id).toBe("b");
	});

	it("never auto-attaches to a bot/relay session", () => {
		const sessions = [
			session("relay", "/repo", "main", "2026-10-24T03:00:00.000Z", "relay"),
			session("user", "/repo", "main"),
		];
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "main")?.id).toBe("user");
		expect(pickMostRecentSessionForCwd([sessions[0]!], "/repo", "main")).toBeUndefined();
	});

	it("never mixes repositories", () => {
		const sessions = [session("other", "/other", "main"), session("here", "/repo", "main")];
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "feat/x")).toBeUndefined();
		expect(pickMostRecentSessionForCwd(sessions, "/repo", "main")?.id).toBe("here");
	});
});
