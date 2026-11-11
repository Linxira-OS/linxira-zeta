import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadHiddenSessionIds,
	setSessionHidden,
	toggleSessionHidden,
} from "@linxiraos/zeta/session/session-visibility";

describe("shared session visibility", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-visibility-"));
	});

	afterEach(() => {
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("hides and unhides metadata without touching the transcript", async () => {
		await setSessionHidden("sess-a", true, agentDir);
		await setSessionHidden("sess-b", true, agentDir);
		expect([...(await loadHiddenSessionIds(agentDir))].sort()).toEqual(["sess-a", "sess-b"]);

		await setSessionHidden("sess-a", false, agentDir);
		expect([...(await loadHiddenSessionIds(agentDir))]).toEqual(["sess-b"]);
		expect(await toggleSessionHidden("sess-b", agentDir)).toBe(false);
		expect((await loadHiddenSessionIds(agentDir)).size).toBe(0);
	});

	it("degrades to an empty set on a corrupt file", async () => {
		fs.writeFileSync(path.join(agentDir, "session-visibility.json"), "{not json");
		expect((await loadHiddenSessionIds(agentDir)).size).toBe(0);
		await setSessionHidden("sess-a", true, agentDir);
		expect([...(await loadHiddenSessionIds(agentDir))]).toEqual(["sess-a"]);
	});
});
