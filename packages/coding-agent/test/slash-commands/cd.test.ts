/**
 * `/cd`: a high-frequency command that must be in the normal palette, open the
 * folder picker with no argument, and move directly when given a path.
 *
 * Moving is covered by the `/move` machinery; here a stubbed context proves the
 * routing (picker vs. path), the streaming refusal, and that the command is
 * listed for the palette with a description in every language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as piUtils from "@linxiraos/pi-utils";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { M } from "../../src/i18n";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { BUILTIN_SLASH_COMMANDS, executeBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/builtin-registry";

let tempDir: string;

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true, overrides: { doubleEscapeAction: "none" } });
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-cd-command-"));
});

afterEach(() => {
	resetSettingsForTest();
	fs.rmSync(tempDir, { recursive: true, force: true });
});

function runtime(overrides: { streaming?: boolean } = {}) {
	const showDirectoryPicker = vi.fn(async () => {});
	const handleMoveCommand = vi.fn(async () => {});
	const ctx = {
		session: { isStreaming: overrides.streaming ?? false },
		editor: { setText: vi.fn(), addToHistory: vi.fn() },
		settings: Settings.instance,
		showDirectoryPicker,
		handleMoveCommand,
		showWarning: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		sessionManager: { getCwd: () => tempDir },
	} as unknown as InteractiveModeContext;
	return { ctx, showDirectoryPicker, handleMoveCommand };
}

describe("/cd", () => {
	it("is listed in the normal command palette with a description", () => {
		const command = BUILTIN_SLASH_COMMANDS.find(entry => entry.name === "cd");
		expect(command).toBeDefined();
		expect(command?.aliases).toContain("chdir");
		expect(command?.allowArgs).toBe(true);
		expect(command?.argumentCompletionOnly).toBe(true);
		expect(M.cmdCd.length).toBeGreaterThan(0);
		expect(M.cmdCdAcp.length).toBeGreaterThan(0);
	});

	it("completes directories for /cd <path> like /move", async () => {
		const command = BUILTIN_SLASH_COMMANDS.find(entry => entry.name === "cd");
		expect(command?.getArgumentCompletions).toBeFunction();
		fs.mkdirSync(path.join(tempDir, "projects"));
		fs.writeFileSync(path.join(tempDir, "README.md"), "");
		const projectDir = vi.spyOn(piUtils, "getProjectDir").mockReturnValue(tempDir);
		try {
			const result = await command!.getArgumentCompletions!("");
			const values = result?.map(item => item.value) ?? [];
			expect(values).toContain("projects/");
			expect(values).not.toContain("README.md");
		} finally {
			projectDir.mockRestore();
		}
	});

	it("opens the folder picker when no path is given", async () => {
		const { ctx, showDirectoryPicker, handleMoveCommand } = runtime();
		expect(await executeBuiltinSlashCommand("/cd", { ctx })).toBe(true);
		expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
		expect(handleMoveCommand).not.toHaveBeenCalled();
	});

	it("moves directly when a path is given", async () => {
		const { ctx, showDirectoryPicker, handleMoveCommand } = runtime();
		expect(await executeBuiltinSlashCommand("/cd /work/project", { ctx })).toBe(true);
		expect(handleMoveCommand).toHaveBeenCalledWith("/work/project", { allowCreate: false });
		expect(showDirectoryPicker).not.toHaveBeenCalled();
	});

	it("refuses to switch while a response is streaming", async () => {
		const { ctx, showDirectoryPicker, handleMoveCommand } = runtime({ streaming: true });
		expect(await executeBuiltinSlashCommand("/cd", { ctx })).toBe(true);
		expect(showDirectoryPicker).not.toHaveBeenCalled();
		expect(handleMoveCommand).not.toHaveBeenCalled();
	});
});
