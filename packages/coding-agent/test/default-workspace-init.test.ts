/**
 * D8b — `zeta serve` initialises the default workspace as a real repository:
 * directory → `git init` → project settings (`memory.backend: mnemopi`) →
 * official `AGENTS.md` → persona → first commit. The second startup must be a
 * no-op, including when the user edited `AGENTS.md`.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_WORKSPACE_AGENTS_FILENAME,
	DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT,
	DEFAULT_WORKSPACE_PERSONA_FILENAME,
	DEFAULT_WORKSPACE_SETTINGS_RELPATH,
	initializeDefaultWorkspace,
} from "../src/default-workspace";

// Git spawns on Windows are slow; each initialisation is several processes.
setDefaultTimeout(30_000);

function git(cwd: string, args: string[]): string {
	const result = Bun.spawnSync({
		cmd: ["git", ...args],
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
	}
	return result.stdout.toString().trim();
}

describe("default workspace init (D8b)", () => {
	let workspace: string;

	beforeEach(() => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-default-ws-"));
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("empty directory becomes a repo with settings, AGENTS.md, persona, and a first commit", async () => {
		const result = await initializeDefaultWorkspace({ workspace });

		expect(result.workspace).toBe(path.resolve(workspace));
		expect(result.gitInitialized).toBe(true);
		expect(result.committed).toBe(true);
		expect(result.commitSubject).toBe(DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT);
		expect(result.created.sort()).toEqual(
			[
				".git/",
				DEFAULT_WORKSPACE_AGENTS_FILENAME,
				DEFAULT_WORKSPACE_PERSONA_FILENAME,
				DEFAULT_WORKSPACE_SETTINGS_RELPATH.replaceAll("\\", "/"),
			].sort(),
		);

		expect(fs.existsSync(path.join(workspace, ".git"))).toBe(true);
		expect(fs.existsSync(path.join(workspace, DEFAULT_WORKSPACE_AGENTS_FILENAME))).toBe(true);
		expect(fs.existsSync(path.join(workspace, DEFAULT_WORKSPACE_PERSONA_FILENAME))).toBe(true);
		const settings = JSON.parse(fs.readFileSync(path.join(workspace, DEFAULT_WORKSPACE_SETTINGS_RELPATH), "utf8"));
		expect(settings).toEqual({ memory: { backend: "mnemopi" } });

		expect(git(workspace, ["log", "--format=%s"])).toBe(DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT);
		// Only the managed files are in the first commit.
		expect(git(workspace, ["show", "--name-only", "--format="]).split("\n").sort()).toEqual(
			[
				DEFAULT_WORKSPACE_AGENTS_FILENAME,
				DEFAULT_WORKSPACE_PERSONA_FILENAME,
				DEFAULT_WORKSPACE_SETTINGS_RELPATH.replaceAll("\\", "/"),
			].sort(),
		);
	});

	test("second startup is a no-op and never overwrites a user-edited AGENTS.md", async () => {
		await initializeDefaultWorkspace({ workspace });
		const headBefore = git(workspace, ["rev-parse", "HEAD"]);

		const agentsPath = path.join(workspace, DEFAULT_WORKSPACE_AGENTS_FILENAME);
		const edited = `${fs.readFileSync(agentsPath, "utf8")}\n## My note\n\nThis line is mine.\n`;
		fs.writeFileSync(agentsPath, edited, "utf8");
		const statusBefore = git(workspace, ["status", "--porcelain"]);

		const second = await initializeDefaultWorkspace({ workspace });

		expect(second.gitInitialized).toBe(false);
		expect(second.created).toEqual([]);
		expect(second.committed).toBe(false);
		expect(second.commitSubject).toBeUndefined();
		// No new commit, and the user's edit survives byte-for-byte.
		expect(git(workspace, ["rev-parse", "HEAD"])).toBe(headBefore);
		expect(fs.readFileSync(agentsPath, "utf8")).toBe(edited);
		// The init path itself introduces no further diff.
		expect(git(workspace, ["status", "--porcelain"])).toBe(statusBefore);
	});
});
