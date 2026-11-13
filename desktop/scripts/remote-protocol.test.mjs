import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHost, platformFromProbe, safeSshToken } from "../src/remote/protocol.ts";

test("ssh operands reject option-like and control-character input", () => {
	assert.equal(safeSshToken("dev-box", "host"), "dev-box");
	assert.throws(() => safeSshToken("-oProxyCommand=evil", "host"));
	assert.throws(() => safeSshToken("a\nb", "host"));
	assert.throws(() => normalizeHost("host name"));
	assert.equal(normalizeHost("user@example.com"), "user@example.com");
});

test("remote probes map uname output to the renderer platform", () => {
	assert.equal(platformFromProbe("Linux"), "linux");
	assert.equal(platformFromProbe("Darwin"), "darwin");
	assert.equal(platformFromProbe("MINGW64_NT-10.0"), "win32");
	assert.equal(platformFromProbe("unknown"), "linux");
});
