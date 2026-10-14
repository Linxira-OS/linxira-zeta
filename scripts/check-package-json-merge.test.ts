import { describe, expect, test } from "bun:test";
import { droppedScriptKeys } from "./check-package-json-merge";

const base = { "check:ts": "tsc", "gen:models": "old" };

describe("droppedScriptKeys", () => {
	test("reports a branch-side addition the merge dropped", () => {
		expect(
			droppedScriptKeys({
				branch: { ...base, "check:probe": "bun scripts/probe.ts" },
				ancestor: base,
				merged: base, // the driver rebuilt from the merged-in side
				head: base,
			}),
		).toEqual(["check:probe"]);
	});

	test("clears once HEAD carries the key again", () => {
		expect(
			droppedScriptKeys({
				branch: { ...base, "check:probe": "bun scripts/probe.ts" },
				ancestor: base,
				merged: base,
				head: { ...base, "check:probe": "bun scripts/probe.ts" },
			}),
		).toEqual([]);
	});

	test("ignores a key only the merged-in side dropped or renamed (driver behavior, not branch loss)", () => {
		expect(
			droppedScriptKeys({
				branch: base,
				ancestor: base,
				merged: { "check:ts": "tsc" }, // upstream removed gen:models
				head: { "check:ts": "tsc" },
			}),
		).toEqual([]);
	});

	test("ignores a key both sides changed (upstream value wins by design)", () => {
		expect(
			droppedScriptKeys({
				branch: { ...base, "gen:models": "branch command" },
				ancestor: base,
				merged: { ...base, "gen:models": "main command" },
				head: { ...base, "gen:models": "main command" },
			}),
		).toEqual([]);
	});

	test("tolerates a missing scripts table at any revision", () => {
		expect(droppedScriptKeys({ branch: undefined, ancestor: undefined, merged: undefined, head: undefined })).toEqual(
			[],
		);
		expect(
			droppedScriptKeys({
				branch: { "check:probe": "x" },
				ancestor: undefined, // the manifest has no scripts at the merge-base
				merged: undefined,
				head: undefined,
			}),
		).toEqual(["check:probe"]);
	});
});
