import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeWithRetries } from "@linxiraos/pi-utils";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { EditTool } from "@linxiraos/zeta/edit";
import * as lsp from "@linxiraos/zeta/lsp";
import type { ToolSession } from "@linxiraos/zeta/tools";

function makeSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		enableLsp: false,
		settings: Settings.isolated({ "edit.mode": "patch" }),
		getArtifactsDir: () => null,
		getSessionId: () => null,
		getPlanModeState: () => undefined,
	} as ToolSession;
}

let tempDir: string;

beforeEach(async () => {
	resetSettingsForTest();
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-patch-unchanged-"));
	await Settings.init({ inMemory: true, cwd: tempDir });
});

afterEach(async () => {
	mock.restore();
	resetSettingsForTest();
	await removeWithRetries(tempDir);
});

describe("EditTool patch post-write verification", () => {
	test("returns the caller-facing path when a reported write leaves disk unchanged", async () => {
		const relPath = "deep/nested/foo.txt";
		await fs.mkdir(path.join(tempDir, "deep", "nested"), { recursive: true });
		await fs.writeFile(path.join(tempDir, relPath), "a\n");

		spyOn(lsp, "writethroughNoop").mockImplementation(async () => undefined);
		const result = await new EditTool(makeSession(tempDir), "patch").execute("unchanged", {
			path: relPath,
			edits: [{ op: "update", diff: "@@\n-a\n+b" }],
		});
		const text = result.content.map(part => (part.type === "text" ? part.text : "")).join("\n");

		expect(result.isError).toBe(true);
		expect(text).toContain(`edit appeared successful but file content did not change on disk: ${relPath}`);
		expect(text).not.toContain(tempDir);
		expect(await Bun.file(path.join(tempDir, relPath)).text()).toBe("a\n");
	});
});
