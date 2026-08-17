import { describe, expect, it } from "bun:test";
import { resolveDaemonSpawnOptions } from "../../src/launch/spawn-options";

describe("resolveDaemonSpawnOptions", () => {
	it("hides Windows daemons when the host has no console", () => {
		expect(
			resolveDaemonSpawnOptions({
				platform: "win32",
				hostHasInheritableConsole: false,
			}),
		).toEqual({ detached: true, windowsHide: true });
	});

	it("keeps Windows daemons alive after their spawning process exits", () => {
		// `detached: true` on win32 outlives the spawning process: with
		// `detached: false` Bun joins the broker to the parent's job, so the
		// broker (and every daemon it owns, e.g. the browser relay) dies with
		// the first consumer that started it. A host with a console shares it.
		expect(
			resolveDaemonSpawnOptions({
				platform: "win32",
				hostHasInheritableConsole: true,
			}),
		).toEqual({ detached: true, windowsHide: false });
	});

	it("keeps POSIX daemons in their own session", () => {
		expect(
			resolveDaemonSpawnOptions({
				platform: "linux",
				hostHasInheritableConsole: false,
			}),
		).toEqual({ detached: true });
	});
});
