import { afterEach, expect, test, vi } from "bun:test";
import * as loaderState from "../native/loader-state.js";

afterEach(() => vi.restoreAllMocks());

test("passive observation refuses a stale addon before initializing its input-enabled constructor", async () => {
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
	vi.spyOn(loaderState, "loadNative").mockReturnValue({ DesktopSession: StaleSession });
	// Exercise a fresh loader cache after substituting the native binding; a static import would reuse another test's constructor.
	const module = await import(new URL("../native/desktop.js?passive-abi-test", import.meta.url).href);
	expect(() => module.createDesktopSession({ display: "all", observationOnly: true })).toThrow(
		"missing observationOnly or settle",
	);
	expect(constructed).toBe(0);
	module.createDesktopSession({ display: "all" });
	expect(constructed).toBe(1);
});
