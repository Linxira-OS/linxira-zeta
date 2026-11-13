/**
 * Remote probe contracts: release installs ship `/usr/bin/zetacode` (plus
 * `/usr/bin/zetaide`) and no `zeta`, so the desktop probe must prefer
 * `zetacode`, keep `zeta` as a compat fallback, and surface the version.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseProbeOutput, REMOTE_PROBE_COMMAND } from "../src/remote/probe.ts";

test("parses a release zetacode install with its version", () => {
	const raw = [
		"__ZETA_PROBE__",
		"Linux",
		"x86_64",
		"__ZETA_BIN__/usr/bin/zetacode",
		"__ZETA_VERSION__zetacode 1.5.2",
	].join("\n");
	assert.deepEqual(parseProbeOutput(raw), {
		platform: "linux",
		arch: "x86_64",
		zetaPath: "/usr/bin/zetacode",
		binary: "zetacode",
		version: "zetacode 1.5.2",
	});
});

test("recognises the zeta compat binary when zetacode is absent", () => {
	const raw = [
		"__ZETA_PROBE__",
		"Darwin",
		"arm64",
		"__ZETA_BIN__/opt/homebrew/bin/zeta",
		"__ZETA_VERSION__1.5.1",
	].join("\n");
	assert.deepEqual(parseProbeOutput(raw), {
		platform: "darwin",
		arch: "arm64",
		zetaPath: "/opt/homebrew/bin/zeta",
		binary: "zeta",
		version: "1.5.1",
	});
});

test("keeps a legacy unmarked probe body readable", () => {
	const raw = ["__ZETA_PROBE__", "Linux", "aarch64", "/usr/bin/zeta"].join("\n");
	assert.deepEqual(parseProbeOutput(raw), {
		platform: "linux",
		arch: "aarch64",
		zetaPath: "/usr/bin/zeta",
		binary: "zeta",
		version: null,
	});
});

test("reports a missing runtime explicitly", () => {
	const raw = ["__ZETA_PROBE__", "Linux", "x86_64"].join("\n");
	assert.deepEqual(parseProbeOutput(raw), {
		platform: "linux",
		arch: "x86_64",
		zetaPath: null,
		binary: null,
		version: null,
	});
});

test("probe command prefers zetacode and requests its version", () => {
	assert.match(REMOTE_PROBE_COMMAND, /for b in zetacode zeta;/);
	assert.match(REMOTE_PROBE_COMMAND, /"\$b" --version/);
	assert.match(REMOTE_PROBE_COMMAND, /uname -s/);
});
