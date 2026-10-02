import { afterEach, describe, expect, it } from "bun:test";
import { CLI_BIN_NAME, getActiveProfile, setProfile } from "@linxiraos/pi-utils/dirs";
import { resumeCommand } from "@linxiraos/zeta/utils/resume-command";

describe("resumeCommand", () => {
	const originalProfile = getActiveProfile();

	afterEach(() => {
		setProfile(originalProfile);
	});

	it("omits the profile flag in the default profile", () => {
		setProfile(undefined);
		expect(resumeCommand("abc123")).toBe(`${CLI_BIN_NAME} --resume abc123`);
	});

	it("carries the active profile so the emitted hint is runnable verbatim", () => {
		// Profile sessions live in ~/.zeta/profiles/<name>/agent, so a resume hint
		// without --profile fails with "Session not found" (issue #9018).
		setProfile("personal");
		expect(resumeCommand("abc123")).toBe(`${CLI_BIN_NAME} --profile personal --resume abc123`);
	});
});
