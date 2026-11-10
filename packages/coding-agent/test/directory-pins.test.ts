/**
 * `/cd` pins: persisted in the config root (never in the home directory), with
 * a corrupt file degrading to "no pins" instead of breaking the picker.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DIRECTORY_PINS_FILENAME,
	directoryPinsPath,
	loadDirectoryPins,
	toggleDirectoryPin,
} from "@linxiraos/zeta/modes/directory-pins";

let root: string;
let agentDir: string;
let workDir: string;
let counter = 0;

// One temp root per file: Windows temp-dir churn (creation and recursive
// removal) dominates these tests, and the store only needs distinct paths.
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-cd-pins-"));
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
	counter += 1;
	agentDir = path.join(root, `agent-${counter}`);
	workDir = path.join(root, `work-${counter}`);
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(workDir, { recursive: true });
});

describe("directory pins", () => {
	it("pins and unpins a directory, persisting across reads", async () => {
		expect(await loadDirectoryPins(agentDir)).toEqual([]);

		expect(await toggleDirectoryPin(workDir, agentDir)).toBe(true);
		expect(await loadDirectoryPins(agentDir)).toEqual([workDir]);

		expect(await toggleDirectoryPin(workDir, agentDir)).toBe(false);
		expect(await loadDirectoryPins(agentDir)).toEqual([]);
	});

	it("keeps the newest pin first", async () => {
		const second = path.join(root, "second");
		fs.mkdirSync(second, { recursive: true });
		await toggleDirectoryPin(workDir, agentDir);
		await toggleDirectoryPin(second, agentDir);
		expect(await loadDirectoryPins(agentDir)).toEqual([second, workDir]);
	});

	it("writes only into the agent directory", async () => {
		await toggleDirectoryPin(workDir, agentDir);
		expect(fs.existsSync(path.join(agentDir, DIRECTORY_PINS_FILENAME))).toBe(true);
		expect(fs.readdirSync(workDir)).toEqual([]);
		expect(directoryPinsPath(agentDir)).toBe(path.join(agentDir, DIRECTORY_PINS_FILENAME));
	});

	it("degrades a corrupt pin file to no pins", async () => {
		fs.writeFileSync(path.join(agentDir, DIRECTORY_PINS_FILENAME), "{ not json");
		expect(await loadDirectoryPins(agentDir)).toEqual([]);
	});

	it("drops relative paths from a pins file", async () => {
		fs.writeFileSync(
			path.join(agentDir, DIRECTORY_PINS_FILENAME),
			JSON.stringify({ version: 1, pins: [workDir, "relative/path"] }),
		);
		expect(await loadDirectoryPins(agentDir)).toEqual([workDir]);
	});
});
