import assert from "node:assert/strict";
import test from "node:test";

import { mapUpdateCheck } from "../dist/update-check.js";

const CHECKED_AT = "2026-01-02T03:04:05.000Z";

test("an available runtime update maps to the UI's runtime plan", () => {
	assert.deepEqual(mapUpdateCheck({ current: "1.4.11", latest: "1.4.12", available: true }, "1.4.12", CHECKED_AT), {
		checkedAt: CHECKED_AT,
		app: { currentVersion: "1.4.12", plan: "none" },
		runtime: { plan: "available", runtimeVersion: "1.4.12" },
	});
});

test("an up-to-date runtime reports no plan", () => {
	assert.deepEqual(mapUpdateCheck({ current: "1.4.12", latest: "1.4.12", available: false }, "1.4.12", CHECKED_AT), {
		checkedAt: CHECKED_AT,
		app: { currentVersion: "1.4.12", plan: "none" },
		runtime: { plan: "none" },
	});
});

test("a service error is surfaced and never claims an app update", () => {
	assert.deepEqual(mapUpdateCheck({ error: "registry unreachable" }, "1.4.12", CHECKED_AT), {
		checkedAt: CHECKED_AT,
		app: { currentVersion: "1.4.12", plan: "none" },
		runtime: { plan: "none" },
		error: "registry unreachable",
	});
});

test("unexpected payloads explain themselves instead of inventing versions", () => {
	const junk = mapUpdateCheck({ latest: 42 }, "1.4.12", CHECKED_AT);
	assert.equal(junk.runtime.plan, "none");
	assert.equal(junk.runtime.runtimeVersion, undefined);
	assert.equal(junk.error, undefined);

	const missing = mapUpdateCheck(null, "1.4.12", CHECKED_AT);
	assert.equal(missing.runtime.plan, "none");
	assert.equal(typeof missing.runtime.reason, "string");
});
