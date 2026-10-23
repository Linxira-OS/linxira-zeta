import { describe, expect, it } from "bun:test";
import { BACKEND_ATTACH_LOCAL_COMMANDS, isBackendAttachLocalCommand } from "../src/modes/controllers/input-controller";

/**
 * The attached TUI refuses backend-owned slash commands with a status line.
 * `/language`, `/tool`, `/theme` and the local dashboards are client-side and
 * must keep working — they used to be refused with the rest, which made an
 * attached session look broken next to a local one.
 */
describe("backend-attach local commands", () => {
	it("runs client-side commands locally", () => {
		for (const verb of ["language", "tool", "theme", "settings", "stats", "git", "changelog", "time", "tracking"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(true);
		}
	});

	it("keeps backend-owned session commands refused", () => {
		for (const verb of ["compact", "new", "resume", "fork", "reload", "queue", "mcp", "skill", "todo"]) {
			expect(isBackendAttachLocalCommand(verb), verb).toBe(false);
		}
	});

	it("treats a plain message and a missing verb as not-a-command", () => {
		expect(isBackendAttachLocalCommand(undefined)).toBe(false);
		expect(isBackendAttachLocalCommand("")).toBe(false);
		expect(isBackendAttachLocalCommand("plan")).toBe(false);
	});

	it("keeps the table to local-only entries", () => {
		// Guard against a future entry that mutates the backend session locally:
		// the refusal list above is the contract this table must not erode.
		for (const verb of ["compact", "new", "resume", "fork", "reload", "queue", "todo"]) {
			expect(BACKEND_ATTACH_LOCAL_COMMANDS[verb], verb).toBeUndefined();
		}
	});
});
