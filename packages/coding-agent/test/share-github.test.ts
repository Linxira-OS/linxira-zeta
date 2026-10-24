import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSession } from "../src/session/agent-session";
import type { SessionManager } from "../src/session/session-manager";
import { buildGithubSharePrompt, prepareShareForGithub } from "../src/export/share-github";

const temps: string[] = [];
afterEach(async () => {
	for (const dir of temps.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-share-github-"));
	temps.push(dir);
	return dir;
}

describe("GitHub session publication", () => {
	test("prepares a redacted local transcript and prompts the agent to use gh", async () => {
		const dir = await tempDir();
		const session = {
			formatSessionAsText: () => "## User\nAPI_KEY=super-secret\n",
			obfuscator: {
				hasSecrets: () => true,
				obfuscate: (text: string) => text.replace("super-secret", "[SECRET]"),
			},
		} as unknown as AgentSession;
		const manager = {
			getSessionId: () => "session-1",
			getSessionFile: () => "/tmp/session-1.jsonl",
		} as unknown as SessionManager;

		const prepared = await prepareShareForGithub(session, manager, { redact: true, dir });
		expect(prepared.redacted).toBe(true);
		expect(prepared.markdownPath).toBe(path.join(dir, "session-1.md"));
		const written = await fs.readFile(prepared.markdownPath, "utf8");
		expect(written).toContain("[SECRET]");
		expect(written).not.toContain("super-secret");

		const prompt = buildGithubSharePrompt(prepared);
		expect(prompt).toContain(prepared.markdownPath);
		expect(prompt).toContain("gh auth status");
		expect(prompt).toContain("Do not upload it to `my.omp.sh`");
		expect(prompt).toContain("gh auth login");
		expect(prompt).toContain("Do not paste the transcript into chat");
	});

	test("does not claim redaction when no secret matched", async () => {
		const dir = await tempDir();
		const session = {
			formatSessionAsText: () => "clean transcript",
			obfuscator: undefined,
		} as unknown as AgentSession;
		const manager = {
			getSessionId: () => "session-2",
			getSessionFile: () => undefined,
		} as unknown as SessionManager;

		const prepared = await prepareShareForGithub(session, manager, { redact: true, dir });
		expect(prepared.redacted).toBe(false);
		expect(buildGithubSharePrompt(prepared)).toContain("No known secret matched");
	});
});
