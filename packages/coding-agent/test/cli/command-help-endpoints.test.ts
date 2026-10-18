import { describe, expect, test } from "bun:test";
import { SKILLS_REGISTRY_UNAVAILABLE } from "@linxiraos/pi-wire/skillshare";
import { clipHelp, skillHelp, streamHelp } from "../../src/cli/command-help";

/** Help surfaces must send users to Zeta's own distribution, not upstream hosts. */
describe("command help endpoints", () => {
	test("skill help names the npm package that carries extra skills", () => {
		expect(skillHelp.description).toContain("@linxiraos/linxira-skills");
		expect(skillHelp.description).toContain("npm i -g @linxiraos/linxira-skills");
		expect(skillHelp.description).not.toContain("skills.omp.sh");
		expect(SKILLS_REGISTRY_UNAVAILABLE).toContain("@linxiraos/linxira-skills");
	});

	test("clip help says uploads are unavailable in Zeta", () => {
		expect(clipHelp.description).toContain("Unavailable in Zeta");
		expect(clipHelp.description).toContain("/record --upload");
	});

	test("stream help says no stream server ships", () => {
		expect(streamHelp.description).toContain("none ships with Zeta");
		expect(streamHelp.description).toContain("stream.serverUrl");
	});
});
