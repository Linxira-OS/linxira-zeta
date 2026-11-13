import { describe, expect, test } from "bun:test";
import {
	SURFACE_ACTIONS,
	accessFor,
	classifySurface,
	detectSurfaceFacts,
	isLoopbackHost,
	navAllowedOnSurface,
	surfaceShows,
	type SurfaceFacts,
	type SurfaceId,
} from "./surfaces";

function facts(overrides: Partial<SurfaceFacts> = {}): SurfaceFacts {
	return {
		windowBridge: false,
		chromeBridge: false,
		remoteBridge: false,
		loopback: true,
		mobileViewport: false,
		mobileAgent: false,
		hostDesktop: false,
		...overrides,
	};
}

describe("surface classification", () => {
	test("the desktop shell wins over its own loopback URL", () => {
		expect(classifySurface(facts({ windowBridge: true }))).toBe("desktop");
		expect(classifySurface(facts({ chromeBridge: true }))).toBe("desktop");
		expect(classifySurface(facts({ windowBridge: true, loopback: false, mobileAgent: true }))).toBe("desktop");
	});

	test("a phone-sized coarse pointer or a mobile UA is mobile", () => {
		expect(classifySurface(facts({ mobileViewport: true }))).toBe("mobile");
		expect(classifySurface(facts({ mobileAgent: true, loopback: false }))).toBe("mobile");
	});

	test("a plain browser splits on the address bar, not the host process", () => {
		expect(classifySurface(facts({ loopback: true }))).toBe("loopback-browser");
		expect(classifySurface(facts({ loopback: false }))).toBe("remote-browser");
	});

	test("loopback hostnames are exact, not suffix matches", () => {
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
		expect(isLoopbackHost("localhost.example.com")).toBe(false);
	});

	test("facts are read defensively when there is no window at all", () => {
		expect(detectSurfaceFacts({})).toEqual({
			windowBridge: false,
			chromeBridge: false,
			remoteBridge: false,
			loopback: false,
			mobileViewport: false,
			mobileAgent: false,
			hostDesktop: false,
		});
	});

	test("mobile opens workbench, history and settings", () => {
		expect(navAllowedOnSurface("mobile", "workbench")).toBe(true);
		expect(navAllowedOnSurface("mobile", "history")).toBe(true);
		expect(navAllowedOnSurface("mobile", "settings")).toBe(true);
		expect(navAllowedOnSurface("mobile", "diagnostics")).toBe(false);
		expect(navAllowedOnSurface("desktop", "settings")).toBe(true);
		expect(navAllowedOnSurface("remote-browser", "settings")).toBe(true);
	});
});

describe("surface matrix", () => {
	test("every surface answers every action", () => {
		for (const surface of ["desktop", "loopback-browser", "remote-browser", "mobile", "tui"] as SurfaceId[]) {
			for (const action of SURFACE_ACTIONS) {
				expect(typeof accessFor(surface, action).access).toBe("string");
			}
		}
	});

	test("unavailable decisions always name the missing piece", () => {
		for (const surface of ["desktop", "loopback-browser", "remote-browser", "mobile", "tui"] as SurfaceId[]) {
			for (const action of SURFACE_ACTIONS) {
				const decision = accessFor(surface, action);
				if (decision.access === "unavailable") expect(typeof decision.reason).toBe("string");
			}
		}
	});

	test("desktop owns the desktop-only controls and host actions pass through", () => {
		expect(accessFor("desktop", "window-controls")).toEqual({ access: "show" });
		expect(accessFor("desktop", "open-logs")).toEqual({ access: "show" });
		expect(accessFor("desktop", "file-picker")).toEqual({ access: "show" });
		expect(accessFor("desktop", "im-channels").access).toBe("pass-through");
		expect(accessFor("desktop", "totp").access).toBe("show");
		expect(accessFor("desktop", "ssh-targets").access).toBe("unavailable");
	});

	test("a local browser hides native chrome but keeps gateway actions", () => {
		expect(accessFor("loopback-browser", "window-controls").access).toBe("hidden");
		expect(accessFor("loopback-browser", "open-logs")).toEqual({ access: "unavailable", reason: "desktopOnly" });
		expect(accessFor("loopback-browser", "open-in-editor").access).toBe("hidden");
		expect(accessFor("loopback-browser", "im-channels").access).toBe("pass-through");
		expect(accessFor("loopback-browser", "im-credentials").access).toBe("pass-through");
		expect(accessFor("loopback-browser", "device-revoke").access).toBe("pass-through");
		expect(accessFor("loopback-browser", "remote-pairing").access).toBe("pass-through");
	});

	test("remote is authorized, not crippled: IM auth and device admin pass through", () => {
		expect(accessFor("remote-browser", "im-channels").access).toBe("pass-through");
		expect(accessFor("remote-browser", "im-credentials").access).toBe("pass-through");
		expect(accessFor("remote-browser", "device-list").access).toBe("pass-through");
		expect(accessFor("remote-browser", "remote-token").access).toBe("pass-through");
		expect(accessFor("remote-browser", "remote-pairing").access).toBe("pass-through");
		// First TOTP enrollment is local-only on the server, so the surface is
		// read-only and names that reason instead of hiding the whole section.
		expect(accessFor("remote-browser", "totp")).toEqual({ access: "read-only", reason: "totpLocalEnroll" });
		// Desktop-session actions remain unavailable.
		expect(accessFor("remote-browser", "window-controls").access).toBe("hidden");
		expect(accessFor("remote-browser", "local-update-import")).toEqual({
			access: "unavailable",
			reason: "desktopOnly",
		});
		expect(accessFor("remote-browser", "open-logs").access).toBe("unavailable");
	});

	test("mobile keeps chat/history plus security facts, without local admin", () => {
		// The published matrix: settings is reachable, the paired-device list and
		// pairing card render, and TOTP verification is read-only. Local runtime,
		// credentials, token mutation and device revocation stay hidden.
		expect(accessFor("mobile", "file-picker").access).toBe("pass-through");
		expect(accessFor("mobile", "device-list").access).toBe("pass-through");
		expect(accessFor("mobile", "totp").access).toBe("read-only");
		expect(accessFor("mobile", "remote-pairing").access).toBe("pass-through");
		for (const action of [
			"runtime-install",
			"runtime-restart",
			"local-update-import",
			"local-data-cleanup",
			"open-logs",
			"open-in-editor",
			"file-reveal",
			"im-channels",
			"im-credentials",
			"device-revoke",
			"remote-token",
			"ssh-targets",
		] as const) {
			expect(accessFor("mobile", action).access).toBe("hidden");
			expect(surfaceShows("mobile", action)).toBe(false);
		}
	});

	test("the TUI has no window or device screen but keeps CLI operations", () => {
		expect(accessFor("tui", "window-controls").access).toBe("hidden");
		expect(accessFor("tui", "im-channels").access).toBe("pass-through");
		expect(accessFor("tui", "im-credentials").access).toBe("pass-through");
		expect(accessFor("tui", "device-list")).toEqual({ access: "unavailable", reason: "tuiNoDeviceUi" });
		expect(accessFor("tui", "totp").access).toBe("unavailable");
	});

	test("runtime restart is never offered as a working control", () => {
		for (const surface of ["desktop", "loopback-browser", "remote-browser"] as SurfaceId[]) {
			expect(accessFor(surface, "runtime-restart")).toEqual({ access: "unavailable", reason: "restartHostMode" });
		}
	});
});
