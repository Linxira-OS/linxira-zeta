/**
 * REQ057: a discovered APPEND_SYSTEM.md or SYSTEM.md that did not exist at
 * startup must be re-discovered by the sdk prompt rebuild. The rebuild reads
 * the source again (no second assembly path), so creating, byte-identically
 * rewriting, or deleting the file changes the next applied prompt and, when it
 * does change, invalidates the inherited provider prompt-cache key. Explicit
 * CLI prompt inputs stay one-shot.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createMockModel, registerMockApi } from "@linxiraos/pi-ai/providers/mock";
import { getProjectDir, setProjectDir, TempDir } from "@linxiraos/pi-utils";
import { reset as resetCapabilities } from "../../src/capability";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

registerMockApi();

describe("late-discovered system prompt files", () => {
	it("re-discovers an APPEND_SYSTEM.md created after startup, ignores a same-byte rewrite, and restores on delete", async () => {
		const dir = TempDir.createSync("@late-append-");
		const auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		const originalProjectDir = getProjectDir();
		try {
			auth.keys.setRuntime("mock", "test-key");
			setProjectDir(dir.path());
			const mockModel = createMockModel({ id: "text", handler: () => ({ content: ["ok"] }) });
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"todo.enabled": false,
				"retry.enabled": false,
			});
			const sessionManager = SessionManager.inMemory(dir.path());
			const { session } = await createAgentSession({
				cwd: dir.path(),
				agentDir: dir.path(),
				authStorage: auth,
				modelRegistry: new ModelRegistry(auth, path.join(dir.path(), "models.yml")),
				model: mockModel,
				settings,
				sessionManager,
				providerPromptCacheKey: "inherited-cache",
				providerPromptCacheKeySource: "fork",
				disableExtensionDiscovery: true,
				enableMCP: false,
				enableLsp: false,
				skills: [],
				rules: [],
				contextFiles: [],
			});
			try {
				const systemPrompt = (): string => session.agent.state.systemPrompt.join("\n");
				await session.prompt("noop");
				const initialPrompt = systemPrompt();
				expect(initialPrompt).not.toContain("LATE-APPEND-MARKER");
				expect(session.agent.promptCacheKey).toBe("inherited-cache");

				const appendPath = path.join(dir.path(), ".zeta", "APPEND_SYSTEM.md");
				fs.mkdirSync(path.dirname(appendPath), { recursive: true });
				fs.writeFileSync(appendPath, "LATE-APPEND-MARKER\n", "utf8");

				await session.refreshBaseSystemPrompt();
				expect(systemPrompt()).toContain("LATE-APPEND-MARKER");
				// The applied prompt changed, so the inherited cache lineage is invalidated.
				expect(session.agent.promptCacheKey).toBeUndefined();

				// Same bytes again: the rebuild commits no new prompt and no new key.
				fs.writeFileSync(appendPath, "LATE-APPEND-MARKER\n", "utf8");
				await session.refreshBaseSystemPrompt();
				expect(systemPrompt()).toContain("LATE-APPEND-MARKER");

				// Deleting the file returns the prompt to the startup shape.
				fs.rmSync(appendPath);
				await session.refreshBaseSystemPrompt();
				expect(systemPrompt()).toBe(initialPrompt);
			} finally {
				await session.dispose();
			}
		} finally {
			setProjectDir(originalProjectDir);
			auth.close();
			dir.removeSync();
		}
	});

	it("keeps an explicit append flag one-shot and never reads a late file over it", async () => {
		const dir = TempDir.createSync("@late-append-flag-");
		const auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		const originalProjectDir = getProjectDir();
		try {
			auth.keys.setRuntime("mock", "test-key");
			setProjectDir(dir.path());
			const mockModel = createMockModel({ id: "text", handler: () => ({ content: ["ok"] }) });
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"todo.enabled": false,
				"retry.enabled": false,
			});
			const sessionManager = SessionManager.inMemory(dir.path());
			const { session } = await createAgentSession({
				cwd: dir.path(),
				agentDir: dir.path(),
				appendSystemPrompt: "FLAG-ONLY-MARKER",
				authStorage: auth,
				modelRegistry: new ModelRegistry(auth, path.join(dir.path(), "models.yml")),
				model: mockModel,
				settings,
				sessionManager,
				disableExtensionDiscovery: true,
				enableMCP: false,
				enableLsp: false,
				skills: [],
				rules: [],
				contextFiles: [],
			});
			try {
				const appendPath = path.join(dir.path(), ".zeta", "APPEND_SYSTEM.md");
				fs.mkdirSync(path.dirname(appendPath), { recursive: true });
				fs.writeFileSync(appendPath, "LATE-FILE-SHOULD-LOSE\n", "utf8");

				await session.refreshBaseSystemPrompt();
				const prompt = session.agent.state.systemPrompt.join("\n");
				expect(prompt).toContain("FLAG-ONLY-MARKER");
				expect(prompt).not.toContain("LATE-FILE-SHOULD-LOSE");
			} finally {
				await session.dispose();
			}
		} finally {
			setProjectDir(originalProjectDir);
			auth.close();
			dir.removeSync();
		}
	});

	it("re-discovers a SYSTEM.md created after startup", async () => {
		const dir = TempDir.createSync("@late-system-");
		const auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		const originalProjectDir = getProjectDir();
		try {
			auth.keys.setRuntime("mock", "test-key");
			setProjectDir(dir.path());
			const mockModel = createMockModel({ id: "text", handler: () => ({ content: ["ok"] }) });
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"todo.enabled": false,
				"retry.enabled": false,
			});
			const sessionManager = SessionManager.inMemory(dir.path());
			const { session } = await createAgentSession({
				cwd: dir.path(),
				agentDir: dir.path(),
				authStorage: auth,
				modelRegistry: new ModelRegistry(auth, path.join(dir.path(), "models.yml")),
				model: mockModel,
				settings,
				sessionManager,
				disableExtensionDiscovery: true,
				enableMCP: false,
				enableLsp: false,
				skills: [],
				rules: [],
				contextFiles: [],
			});
			try {
				await session.prompt("noop");
				const initialPrompt = session.agent.state.systemPrompt.join("\n");
				expect(initialPrompt).not.toContain("LATE-SYSTEM-OVERRIDE");

				const systemPath = path.join(dir.path(), ".zeta", "SYSTEM.md");
				fs.mkdirSync(path.dirname(systemPath), { recursive: true });
				fs.writeFileSync(systemPath, "LATE-SYSTEM-OVERRIDE\n", "utf8");

				// The capability directory cache is process-global; the context-reload
				// turn boundary clears it before the rebuild reads the changed tree.
				resetCapabilities();
				await session.refreshBaseSystemPrompt();
				const rebuilt = session.agent.state.systemPrompt.join("\n");
				expect(rebuilt).toContain("LATE-SYSTEM-OVERRIDE");
				expect(rebuilt).not.toBe(initialPrompt);

				fs.rmSync(systemPath);
				resetCapabilities();
				await session.refreshBaseSystemPrompt();
				expect(session.agent.state.systemPrompt.join("\n")).not.toContain("LATE-SYSTEM-OVERRIDE");
			} finally {
				await session.dispose();
			}
		} finally {
			setProjectDir(originalProjectDir);
			auth.close();
			dir.removeSync();
		}
	});
});
