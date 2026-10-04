import assert from "node:assert/strict";
import test from "node:test";

import { SERVICE_MAX_RESTARTS, shouldRestartServe } from "../src/service-supervision.ts";

test("an unused restart budget allows one retry", () => {
	assert.equal(shouldRestartServe(0), true);
	assert.equal(shouldRestartServe(-1), true);
});

test("budget exhausts after the allowed restarts", () => {
	assert.equal(shouldRestartServe(SERVICE_MAX_RESTARTS), false);
	assert.equal(shouldRestartServe(SERVICE_MAX_RESTARTS + 3), false);
});

test("restart budget stays a small fixed number (crash loops must fail fast)", () => {
	assert.ok(SERVICE_MAX_RESTARTS >= 1 && SERVICE_MAX_RESTARTS <= 2);
});
