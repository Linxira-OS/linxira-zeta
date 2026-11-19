import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

async function probe(): Promise<void> {
	let constructed = 0;
	class StaleSession {
		constructor() {
			constructed++;
		}
	}
	const methods = [
		"click",
		"capture",
		"captureRegion",
		"cancel",
		"retire",
		"setRunDeadline",
		"observe",
		"listApplications",
		"openApplication",
		"menuItems",
		"menuSelect",
		"holdKeys",
		"holdMouse",
		"acquireControl",
		"releaseControl",
		"controlState",
		"bringToCurrentSpace",
		"axSelectText",
		"holdDisplayUntilReleased",
		"releaseDisplayAwake",
	];
	for (const method of methods) Object.defineProperty(StaleSession.prototype, method, { value() {} });
	Object.defineProperty(StaleSession.prototype, "escapeStops", {
		get() {
			return 0;
		},
	});
	const loaderPath = fileURLToPath(new URL("../native/loader-state.js", import.meta.url));
	const loader = await import(loaderPath);
	mock.module(loaderPath, () => ({ ...loader, loadNative: () => ({ DesktopSession: StaleSession }) }));
	const { createDesktopSession } = await import("../native/desktop.js");
	assert.throws(
		() => createDesktopSession({ display: "all", observationOnly: true }),
		/missing observationOnly or settle/,
	);
	assert.equal(constructed, 0);
	createDesktopSession({ display: "all" });
	assert.equal(constructed, 1);
}

if (process.argv[2] === "--probe-desktop-abi") {
	await probe();
} else {
	test("passive observation refuses a stale addon before initializing its input-enabled constructor", async () => {
		// A fresh process isolates the lazy constructor cache and the module mock.
		const child = Bun.spawn([process.execPath, import.meta.path, "--probe-desktop-abi"], {
			stdout: "ignore",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	});
}
