import { describe, expect, test } from "bun:test";
import { lockfileStampState } from "./check-nix-bun-freshness";

describe("lockfileStampState", () => {
	test("accepts the version-1 lockfile the pinned bun2nix reads", () => {
		expect(lockfileStampState('{\n  "lockfileVersion": 1,\n  "workspaces": {},\n}\n')).toEqual({ kind: "current" });
	});

	test("flags a Bun 1.4 version-2 lockfile as needs-restamp (gen:nix restamps it)", () => {
		const state = lockfileStampState('{\n  "lockfileVersion": 2,\n  "workspaces": {},\n}\n');
		expect(state.kind).toBe("restampable");
		expect(state.kind === "restampable" && state.reason).toContain("bun run gen:nix");
	});

	test("rejects version 3+ and a missing stamp as unreadable by the pinned bun2nix", () => {
		const version3 = lockfileStampState('{\n  "lockfileVersion": 3,\n}\n');
		expect(version3.kind).toBe("unstampable");
		expect(version3.kind === "unstampable" && version3.reason).toContain("bun.lock");

		expect(lockfileStampState("{}\n").kind).toBe("unstampable");
	});
});
