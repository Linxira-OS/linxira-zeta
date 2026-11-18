import { describe, expect, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { adaptDesktopSession } from "../native/desktop-adapter.js";

if (process.argv[2] === "--probe-desktop-abi") {
	await probeMissingEscapeExports();
} else {
	registerDesktopTests();
}

function registerDesktopTests(): void {
	describe("desktop native ABI requirements", () => {
		it.each([
			["missing desktop export", undefined],
			[
				"legacy execute ABI",
				class {
					execute() {}
				},
			],
			[
				"pre-zoom ABI",
				class {
					click() {}
					cancel() {}
				},
			],
			[
				"uncancellable ABI",
				class {
					click() {}
					captureRegion() {}
				},
			],
		])("defers rejection of %s until desktop use without constructing the addon", (_label, NativeSession) => {
			// Importing the shared native module must remain safe for non-desktop tools.
			const DesktopSession = adaptDesktopSession(NativeSession);
			expect(() => new DesktopSession({ display: "active" })).toThrow(/^Unsupported:/);
		});

		it("rejects an addon built before the turn-scoped display hold", () => {
			const Stale = adaptDesktopSession(class {});
			expect(() => new Stale({ display: "active" })).toThrow(/holdDisplayUntilReleased, releaseDisplayAwake/);
		});

		it("rejects an addon built before the Escape stop count", () => {
			// Every method present, so only the getter can decide; without it the worker reads each run as stopped.
			const prototype = (escapeStops: boolean) =>
				new Proxy(
					{},
					{
						get: () => () => {},
						has: (_target, key) => escapeStops || key !== "escapeStops",
					},
				);
			const Current = { prototype: prototype(true) };
			expect<unknown>(adaptDesktopSession(Current)).toBe(Current);
			const Stale = adaptDesktopSession({ prototype: prototype(false) });
			expect(() => new Stale({ display: "active" })).toThrow(/^Unsupported: .*\(missing escapeStops\)/);
		});
	});

	it("reports missing Escape exports with the stale-addon diagnostic", async () => {
		const child = Bun.spawn([process.execPath, import.meta.path, "--probe-desktop-abi"], {
			stdout: "ignore",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	});
}

async function probeMissingEscapeExports(): Promise<void> {
	const loaderPath = fileURLToPath(new URL("../native/loader-state.js", import.meta.url));
	const loader = await import("../native/loader-state.js");
	const { missingNativeExport } = loader;
	const stale = {
		path: "/w/packages/natives/native/pi_natives.darwin-arm64.node",
		version: "18.8.7",
		packageVersion: "18.12.1",
		stale: true,
	};
	mock.module(loaderPath, () => ({
		...loader,
		loadNative: () => ({}),
		missingNativeExport: (name: string) => missingNativeExport(name, stale),
	}));
	const { desktopEscapeStops, forgetDesktopEscapeStops } = await import("../native/desktop.js");
	for (const [name, call] of [
		["desktopEscapeStops", () => desktopEscapeStops("k")],
		["forgetDesktopEscapeStops", () => forgetDesktopEscapeStops("k")],
	] as const) {
		assert.throws(call, error => {
			assert.ok(error instanceof Error);
			assert.ok(error.message.includes(`\`${name}\` is missing`));
			assert.ok(error.message.includes("bun run build:native"));
			return true;
		});
	}
}
