import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	DEFAULT_DESKTOP_SETTINGS,
	RunningSessionsTracker,
	diffTransitions,
	parseDesktopSettings,
	parseRunningSessions,
	parseSessionNames,
	readDesktopSettings,
	runningTooltip,
	writeDesktopSettingsAtomic,
} from "../src/session-monitor.ts";

test("parseRunningSessions accepts the gateway snapshot shape and drops junk ids", () => {
	assert.deepEqual(parseRunningSessions({ runningSessionIds: ["a", "b"] }), { runningSessionIds: ["a", "b"] });
	assert.deepEqual(parseRunningSessions({ runningSessionIds: [] }), { runningSessionIds: [] });
	assert.deepEqual(parseRunningSessions({ runningSessionIds: ["a", 7, null, "", "b"] }), {
		runningSessionIds: ["a", "b"],
	});
});

test("parseRunningSessions rejects anything that is not the expected object shape", () => {
	assert.equal(parseRunningSessions(null), null);
	assert.equal(parseRunningSessions("nope"), null);
	assert.equal(parseRunningSessions(["a"]), null);
	assert.equal(parseRunningSessions({}), null);
	assert.equal(parseRunningSessions({ runningSessionIds: "a" }), null);
	assert.equal(parseRunningSessions({ runningSessionIds: { id: "a" } }), null);
});

test("diffTransitions reports finished and started sessions, order- and duplicate-insensitive", () => {
	assert.deepEqual(diffTransitions(["a", "b"], ["b", "c"]), [
		{ id: "a", from: "running", to: "idle" },
		{ id: "c", from: "idle", to: "running" },
	]);
	assert.deepEqual(diffTransitions([], []), []);
	assert.deepEqual(diffTransitions(["a"], ["a"]), []);
	// duplicates never produce duplicate transitions
	assert.deepEqual(diffTransitions(["a", "a"], []), [{ id: "a", from: "running", to: "idle" }]);
	// deterministic order regardless of input order
	const forward = diffTransitions(["b", "a"], []);
	assert.deepEqual(forward, [
		{ id: "a", from: "running", to: "idle" },
		{ id: "b", from: "running", to: "idle" },
	]);
});

test("RunningSessionsTracker treats the first snapshot as baseline and survives gateway gaps", () => {
	const tracker = new RunningSessionsTracker();
	// First observation: baseline only — never notify for pre-existing sessions.
	assert.deepEqual(tracker.update(["s1", "s2"]), []);
	assert.deepEqual(tracker.update(["s2"]), [{ id: "s1", from: "running", to: "idle" }]);
	assert.deepEqual(tracker.update(["s2", "s3"]), [{ id: "s3", from: "idle", to: "running" }]);
	// After a gap (reset), the next snapshot is a fresh baseline: no replay.
	tracker.reset();
	assert.deepEqual(tracker.update([]), []);
	assert.deepEqual(tracker.update(["s9"]), [{ id: "s9", from: "idle", to: "running" }]);
});

test("runningTooltip shows the running count and falls back to the plain name", () => {
	assert.equal(runningTooltip(0), "Zeta");
	assert.equal(runningTooltip(1), "Zeta — 1 running session");
	assert.equal(runningTooltip(3), "Zeta — 3 running sessions");
	assert.equal(runningTooltip(-1), "Zeta");
	assert.equal(runningTooltip(2, "MyBase"), "MyBase — 2 running sessions");
});

test("parseSessionNames maps session ids to names and tolerates junk", () => {
	assert.deepEqual(
		parseSessionNames({ sessions: [{ id: "a", name: "Refactor" }, { id: "b", name: "" }, { id: "c" }, 7, null] }),
		new Map([["a", "Refactor"]]),
	);
	assert.deepEqual(parseSessionNames(null).size, 0);
	assert.deepEqual(parseSessionNames({}).size, 0);
	assert.deepEqual(parseSessionNames({ sessions: "nope" }).size, 0);
});

test("parseDesktopSettings keeps explicit values and defaults everything else", () => {
	assert.deepEqual(parseDesktopSettings('{"notifications":false}'), { notifications: false });
	assert.deepEqual(parseDesktopSettings('{"notifications":true}'), { notifications: true });
	// missing / wrong-typed / corrupt / non-object payloads → defaults
	assert.deepEqual(parseDesktopSettings("{}"), DEFAULT_DESKTOP_SETTINGS);
	assert.deepEqual(parseDesktopSettings('{"notifications":"no"}'), DEFAULT_DESKTOP_SETTINGS);
	assert.deepEqual(parseDesktopSettings("not json at all"), DEFAULT_DESKTOP_SETTINGS);
	assert.deepEqual(parseDesktopSettings("[true]"), DEFAULT_DESKTOP_SETTINGS);
	assert.deepEqual(parseDesktopSettings("null"), DEFAULT_DESKTOP_SETTINGS);
	assert.deepEqual(DEFAULT_DESKTOP_SETTINGS, { notifications: true });
});

test("read/write desktop settings round-trips atomically and defaults on damage", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-desktop-settings-"));
	try {
		// Missing file → defaults.
		assert.deepEqual(readDesktopSettings(dir), DEFAULT_DESKTOP_SETTINGS);
		// Round-trip.
		writeDesktopSettingsAtomic(dir, { notifications: false });
		assert.deepEqual(readDesktopSettings(dir), { notifications: false });
		// Atomic write leaves no temp files behind.
		assert.deepEqual(
			fs.readdirSync(dir).filter(f => f.endsWith(".tmp")),
			[],
		);
		// Corrupt file → defaults, not a crash.
		fs.writeFileSync(path.join(dir, "desktop-settings.json"), "{broken", "utf8");
		assert.deepEqual(readDesktopSettings(dir), DEFAULT_DESKTOP_SETTINGS);
		// Writing into a not-yet-existing directory creates it.
		const nested = path.join(dir, "userData");
		writeDesktopSettingsAtomic(nested, { notifications: true });
		assert.deepEqual(readDesktopSettings(nested), { notifications: true });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
