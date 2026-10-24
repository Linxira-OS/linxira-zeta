import { describe, expect, it } from "bun:test";
import {
	BUILTIN_SLASH_COMMANDS_INTERNAL,
	lookupBuiltinSlashCommand,
} from "@linxiraos/zeta/slash-commands/builtin-registry";
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
			"agents",
			"extensions",
			"hub",
			"pause",
			"sidebar",
			"record",
			"open",
			"debug",
			"model",
			"modelpreset",
			"switch",
			"effort",
			"plan",
			"plan-ultra",
			"plan-review",
			"goal",
			"vibe",
		]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(true);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("forwards backend-session dashboards and fast/slow to the backend", () => {
		// These have headless handlers that read the backend's tools, context,
		// usage, jobs and model tiers. Running them locally would render the
		// replica's empty surfaces, so attach must forward them.
		for (const verb of ["tools", "context", "usage", "jobs", "fast", "slow", "skills"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
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
			"setup",
			"providers",
			"cleanse",
			"seance",
			"omfg",
			"tan",
		]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("handles session lifecycle commands through the backend", () => {
		// `/new`, `/resume`, `/fork`, `/branch`, `/tree`, `/clear`, `/delete`,
		// `/login` and `/logout` have dedicated attach handlers (HTTP session ops
		// or RPC auth); they must be neither local nor refused.
		for (const verb of ["new", "resume", "fork", "branch", "tree", "clear", "delete", "login", "logout"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("refuses commands the attached client cannot execute against the backend session", () => {
		for (const verb of ["collab", "join", "leave", "live", "guided-goal"]) {
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(true);
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
		}
	});

	it("routes /restart to the backend host instead of refusing it", () => {
		expect(isBackendAttachRefusedCommand("restart")).toBe(false);
		expect(isBackendAttachLocalCommand("restart")).toBe(false);
	});

	it("routes /loop to the backend loop controller rather than refusing it", () => {
		expect(isBackendAttachRefusedCommand("loop")).toBe(false);
		expect(isBackendAttachLocalCommand("loop")).toBe(false);
	});

	it("re-attaches for session creation and resumption instead of refusing", () => {
		for (const verb of ["new", "resume"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
			expect(isBackendAttachRefusedCommand(verb), verb).toBe(false);
		}
	});

	it("has one extension panel and no duplicate /status alias", () => {
		expect(lookupBuiltinSlashCommand("extensions")?.name).toBe("extensions");
		expect(lookupBuiltinSlashCommand("status")).toBeUndefined();
		expect(isBackendAttachLocalCommand("status")).toBe(false);
	});

	it("never forwards a TUI-only builtin without a headless handler", () => {
		// Commands the input controller implements over HTTP/RPC instead of the
		// generic command plane. Keep this list explicit: adding a TUI-only
		// command without a headless handler must fail this test rather than
		// silently send `/command` to the backend model as a prompt.
		const sessionSpecial = new Set([
			"new",
			"resume",
			"fork",
			"branch",
			"tree",
			"clear",
			"delete",
			"login",
			"logout",
			"loop",
			"queue",
			"btw",
			"restart",
			"setup", // retired globally; forwarded for its disabled message
		]);
		const offenders = BUILTIN_SLASH_COMMANDS_INTERNAL.filter(
			command =>
				!isBackendAttachLocalCommand(command.name) &&
				!isBackendAttachRefusedCommand(command.name) &&
				!sessionSpecial.has(command.name) &&
				typeof command.handle !== "function",
		).map(command => command.name);
		expect(offenders).toEqual([]);
	});

	it("treats a plain message and a missing verb as not-a-command", () => {
		expect(isBackendAttachLocalCommand(undefined)).toBe(false);
		expect(isBackendAttachLocalCommand("")).toBe(false);
		expect(isBackendAttachRefusedCommand(undefined)).toBe(false);
	});

	it("tells the operator which local command performs the refused action", () => {
		expect(backendAttachRefusalHint("guided-goal")).toContain("TUI-only");
		expect(backendAttachRefusalHint("collab")).toContain("sharing");
		expect(backendAttachRefusalHint("clear")).toContain("owns the backend session");
	});
});
