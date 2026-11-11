import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SURFACE_ACTIONS } from "../surfaces";
import { SecuritySettingsPane, SurfaceMatrixTable } from "./SecuritySettingsPane";

const HERE = import.meta.dir;

describe("surface matrix table", () => {
	test("renders one row per action with the access decision", () => {
		const html = renderToStaticMarkup(<SurfaceMatrixTable surface="remote-browser" />);
		expect(html.match(/<tr[^>]*data-action=/g)?.length).toBe(SURFACE_ACTIONS.length);
		expect(html).toContain('data-action="window-controls" data-access="hidden"');
		expect(html).toContain('data-action="im-channels" data-access="pass-through"');
		expect(html).toContain('data-action="totp" data-access="read-only"');
		expect(html).toContain('data-action="remote-token" data-access="pass-through"');
	});

	test("desktop shows its own native controls and the SSH gap", () => {
		const html = renderToStaticMarkup(<SurfaceMatrixTable surface="desktop" />);
		expect(html).toContain('data-action="window-controls" data-access="show"');
		expect(html).toContain('data-action="ssh-targets" data-access="unavailable"');
	});

	test("a mobile matrix hides local actions but keeps 2FA verification", () => {
		const html = renderToStaticMarkup(<SurfaceMatrixTable surface="mobile" />);
		expect(html).toContain('data-action="im-credentials" data-access="hidden"');
		// Verification is allowed on a phone (enrollment stays local); the pane
		// hides enroll/disable via the read-only reason.
		expect(html).toContain('data-action="totp" data-access="read-only"');
		expect(html).toContain('data-action="runtime-install" data-access="hidden"');
	});
});

describe("identity & devices pane", () => {
	test("renders the detected surface, the matrix and the security sections", () => {
		const html = renderToStaticMarkup(<SecuritySettingsPane visible={false} runtimeConnected={false} />);
		expect(html).toContain("data-surface=");
		expect(html).toContain("data-action=");
		expect((html.match(/<table/g)?.length ?? 0) >= 1).toBe(true);
		expect(html).toContain("data-totp-state=");
	});
});

describe("discoverability", () => {
	const settings = readFileSync(join(HERE, "..", "SettingsPage.tsx"), "utf8");
	const palette = readFileSync(join(HERE, "..", "commandPaletteCatalog.ts"), "utf8");

	test("both IM channels and identity & devices are first-class settings groups", () => {
		expect(settings).toContain('"channels"');
		expect(settings).toContain('"security"');
		expect(settings).toContain("SecuritySettingsPane");
		expect(settings).toContain("ImChannelsPane");
	});

	test("the command palette can jump straight to either group", () => {
		expect(palette).toContain('group: "channels"');
		expect(palette).toContain('group: "security"');
	});

	test("the IM pane no longer owns the device/TOTP sections", () => {
		const imPane = readFileSync(join(HERE, "ImChannelsPane.tsx"), "utf8");
		expect(imPane.includes("TotpPanel")).toBe(false);
		expect(imPane.includes("settings.imChannels.devices")).toBe(false);
	});
});
