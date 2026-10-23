import { describe, expect, it } from "bun:test";
import {
	backendAttachRefusalHint,
	isBackendAttachLocalCommand,
	isBackendAttachRefusedCommand,
} from "../src/modes/controllers/input-controller";

/**
 * Attached TUI command routing. Three tiers:
 *
 * 1. client-local — display, settings, dashboards, mirrored replica switches;
 * 2. forwarded — the backend executes the builtin with its own session (the
 *    prompts path ACP uses), or expands a custom command/template;
 * 3. refused — swapping the backend's session or writing credentials the
 *    backend already loaded cannot be done from the client.
 *
 * A command in none of the first two lists must never be forwarded blindly:
 * a TUI-only verb forwarded as a prompt would be sent to the model.
 */
describe("backend-attach command routing", () => {
	it("runs client-side commands locally", () => {
		for (const verb of [
			"language",
			"tool",
			"theme",
			"settings",
			"stats",
			"git",
			"changelog",
			"time",
			"tracking",
			"tools",
			"context",
			"agents",
			"skills",
			"extensions",
			"status",
			"usage",
			"jobs",
			"hub",
			"pause",
			"record",
			"open",
			"debug",
			"model",
			"modelpreset",
			"switch",
			"effort",
			"fast",
			"slow",
			"plan",
			"plan-ultra",
			"plan-review",
			"guided-goal",
			"goal",
			"vibe",
		]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(true);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("forwards commands the backend can execute headlessly", () => {
		for (const verb of [
			"compact",
			"handoff",
			"session",
			"retry",
			"rename",
			"move",
			"fresh",
			"share",
			"mcp",
			"memory",
			"marketplace",
			"todo",
			"dirs",
			"add-dir",
			"remove-dir",
			"pin",
			"prewalk",
			"security",
			"plugins",
			"forget-approvals",
			"wt",
			"skillful",
			"advisor",
		]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("refuses only commands that would rewrite the backend session locally", () => {
		for (const verb of [
			"fork",
			"branch",
			"tree",
			"clear",
			"delete",
			"restart",
			"login",
			"logout",
			"setup",
			"collab",
			"join",
			"leave",
			"loop",
			"omfg",
			"cleanse",
			"tan",
			"seance",
			"live",
		]) {
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(true);
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
		}
	});

	it("re-attaches for session creation and resumption instead of refusing", () => {
		for (const verb of ["new", "resume"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("treats a plain message and a missing verb as not-a-command", () => {
		expect(isBackendAttachLocalCommand(undefined)).toBe(false);
		expect(isBackendAttachLocalCommand("")).toBe(false);
		expect(isBackendAttachRefusedCommand(undefined)).toBe(false);
	});

	it("tells the operator which local command performs the refused action", () => {
		expect(backendAttachRefusalHint("fork")).toContain("zetacode attach --new");
		expect(backendAttachRefusalHint("tree")).toContain("--attach-session");
		expect(backendAttachRefusalHint("login")).toContain("standalone `zetacode` terminal");
		expect(backendAttachRefusalHint("collab")).toContain("sharing");
		expect(backendAttachRefusalHint("clear")).toContain("owns the backend session");
	});
});
