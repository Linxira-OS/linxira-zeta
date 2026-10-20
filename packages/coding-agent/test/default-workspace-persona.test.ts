/**
 * D5 — the default workspace persona is injected into the coordinator's system
 * prompt only when the session cwd is the default workspace. It is layered
 * after the global `personality` block, and a missing file changes nothing.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_WORKSPACE_PERSONA_FILENAME,
	defaultCoordinatorWorkspace,
	initializeDefaultWorkspace,
	loadWorkspacePersona,
	workspacePersonaPath,
} from "../src/default-workspace";
import { buildSystemPrompt } from "../src/system-prompt";

setDefaultTimeout(30_000);

const PERSONA_MARKER = "You are the coordinator of this machine's default workspace";
const PERSONA_HEADER = "## Persona (default workspace)";

describe("default workspace persona (D5)", () => {
	let workspace: string;
	let repo: string;
	let previousOverride: string | undefined;

	beforeEach(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-persona-ws-"));
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-persona-repo-"));
		previousOverride = process.env.ZETA_DEFAULT_WORKSPACE;
		process.env.ZETA_DEFAULT_WORKSPACE = workspace;
		await initializeDefaultWorkspace({ workspace });
	});

	afterEach(() => {
		if (previousOverride === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
		else process.env.ZETA_DEFAULT_WORKSPACE = previousOverride;
		fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("existing persona is injected after the global personality block", async () => {
		expect(defaultCoordinatorWorkspace()).toBe(path.resolve(workspace));
		const prompt = await buildSystemPrompt({
			cwd: workspace,
			personality: "friendly",
			skills: [],
			contextFiles: [],
			rules: [],
		});
		const personaIndex = prompt.systemPrompt.findIndex(block => block.startsWith(PERSONA_HEADER));
		expect(personaIndex).toBe(1);
		expect(prompt.systemPrompt[1]).toContain(PERSONA_MARKER);
		// The global personality block is rendered into block 0, before the persona.
		expect(prompt.systemPrompt[0]).toContain("Warm, supportive collaborator");
	});

	test("a repo-local PERSONA.md does not leak into another cwd", async () => {
		const repoPersona = "# Repo persona\n\nThis must never be injected outside its own workspace.\n";
		fs.writeFileSync(path.join(repo, DEFAULT_WORKSPACE_PERSONA_FILENAME), repoPersona, "utf8");

		expect(await loadWorkspacePersona(repo)).toBeNull();
		const prompt = await buildSystemPrompt({
			cwd: repo,
			personality: "none",
			skills: [],
			contextFiles: [],
			rules: [],
		});
		expect(prompt.systemPrompt.join("\n")).not.toContain(PERSONA_HEADER);
		expect(prompt.systemPrompt.join("\n")).not.toContain("This must never be injected");
	});

	test("missing persona file leaves the prompt unchanged", async () => {
		fs.rmSync(workspacePersonaPath(workspace));
		expect(await loadWorkspacePersona(workspace)).toBeNull();

		const prompt = await buildSystemPrompt({
			cwd: workspace,
			personality: "none",
			skills: [],
			contextFiles: [],
			rules: [],
		});
		expect(prompt.systemPrompt.join("\n")).not.toContain(PERSONA_HEADER);
		expect(prompt.systemPrompt.join("\n")).not.toContain(PERSONA_MARKER);
	});
});
