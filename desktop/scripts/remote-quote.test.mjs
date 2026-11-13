import assert from "node:assert/strict";
import test from "node:test";

import { remoteShellPath, shellQuote } from "../dist/remote/ssh.js";

test("remote shell paths expand HOME outside quoting and quote the rest", () => {
	assert.equal(shellQuote("a'b"), `'a'\\''b'`);
	assert.equal(remoteShellPath("~/.local/share/zeta remote"), `"$HOME"'/.local/share/zeta remote'`);
	assert.equal(remoteShellPath("~/.local/share/zeta", "zeta"), `"$HOME"'/.local/share/zeta'/'zeta'`);
	assert.equal(remoteShellPath("/opt/zeta", "zeta"), `'/opt/zeta'/'zeta'`);
});
