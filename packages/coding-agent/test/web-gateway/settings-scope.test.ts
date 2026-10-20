/**
 * Settings scope contract for the web gateway.
 *
 * `Settings.init` is a process singleton, but a session's project layer
 * (`.zeta/`, memory backend, model roles) belongs to ITS cwd. These cases pin
 * the two-repo behaviour, the write-through path (`PUT /api/settings` reaches a
 * session that is already running), and the explicit reload path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
import { getTestModel } from "../helpers/model-fixtures";
import { ModelRegistry } from "../../src/config/model-registry";
import { initializeDefaultWorkspace } from "../../src/default-workspace";
import { cfgMemoryBackend } from "../../src/memory-backend/settings";
import { createAgentSession } from "../../src/sdk";
import { AgentSessionWrapper, sessions } from "../../src/server/web-gateway/agents";
import { handleSettingsPut, handleSettingsReload } from "../../src/server/web-gateway/settings";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

let sharedDir: TempDir;
let previousAgentDir: string | undefined;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
const cleanups: Array<() => void> = [];
const liveSessions: Array<{ dispose(): Promise<void> }> = [];

beforeAll(async () => {
	sharedDir = TempDir.createSync("@pi-gateway-settings-scope-");
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	process.env.ZETA_CODING_AGENT_DIR = sharedDir.path();
	refreshDirsFromEnv();
	authStorage = await AuthStorage.create(path.join(sharedDir.path(), "auth.db"));
	authStorage.keys.setRuntime("anthropic", "test-key");
	modelRegistry = new ModelRegistry(authStorage, path.join(sharedDir.path(), "models.yml"));
});

afterAll(() => {
	authStorage.close();
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	refreshDirsFromEnv();
	for (const entry of fs.readdirSync(sharedDir.path())) {
		try {
			fs.rmSync(sharedDir.join(entry), { recursive: true, force: true });
		} catch {
			// locked by the process-wide registry connection
		}
	}
	try {
		fs.rmSync(sharedDir.path(), { force: true });
	} catch {
		// the locked models.db keeps the now-empty directory in place
	}
});

beforeEach(() => {
	resetSettingsForTest();
	// A stale global config from an earlier case would leak the wrong layer.
	fs.rmSync(path.join(getAgentDir(), "config.yml"), { force: true });
	fs.rmSync(path.join(getAgentDir(), "settings.json"), { force: true });
});

afterEach(async () => {
	for (const session of liveSessions.splice(0)) await session.dispose();
	for (const wrapper of sessions.values()) wrapper.destroy();
	sessions.clear();
	for (const cleanup of cleanups.splice(0)) cleanup();
	resetSettingsForTest();
});

function tempDir(prefix: string): TempDir {
	const dir = TempDir.createSync(prefix);
	cleanups.push(() => dir.removeSync());
	return dir;
}

/** Create a real session without an explicit settings instance, i.e. the production path. */
async function startSession(dir: TempDir) {
	const sessionManager = SessionManager.create(dir.path(), undefined, undefined, { client: "web" });
	const { session } = await createAgentSession({
		cwd: dir.path(),
		agentDir: getAgentDir(),
		authStorage,
		modelRegistry,
		sessionManager,
		model: getTestModel("anthropic"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	liveSessions.push(session);
	const sessionId = sessionManager.getSessionId();
	sessions.set(sessionId, new AgentSessionWrapper(session, sessionId, null));
	return session;
}

function settingsRequest(cwd: string, body: unknown): Request {
	return new Request("http://127.0.0.1/api/settings", {
		method: "PUT",
		headers: { "Content-Type": "application/json", "x-zeta-cwd": cwd },
		body: JSON.stringify(body),
	});
}

function reloadRequest(cwd: string): Request {
	return new Request("http://127.0.0.1/api/settings/reload", {
		method: "POST",
		headers: { "x-zeta-cwd": cwd },
	});
}

describe("per-session settings scope", () => {
	test("default workspace and another repo resolve different memory backends", async () => {
		const workspace = tempDir("@pi-scope-workspace-");
		const repo = tempDir("@pi-scope-repo-");
		await initializeDefaultWorkspace({ workspace: workspace.path() });

		const inWorkspace = await startSession(workspace);
		const inRepo = await startSession(repo);

		expect(cfgMemoryBackend.get(inWorkspace.settings)).toBe("mnemopi");
		expect(inWorkspace.settings.getProvenance(cfgMemoryBackend)).toBe("project");
		expect(cfgMemoryBackend.get(inRepo.settings)).toBe("off");
		expect(inRepo.settings.getProvenance(cfgMemoryBackend)).toBe("default");
		expect(inWorkspace.settings).not.toBe(inRepo.settings);
	});

	test("PUT reaches a running session and reports a project override", async () => {
		const repo = tempDir("@pi-scope-put-");
		fs.mkdirSync(path.join(repo.path(), ".zeta"), { recursive: true });
		fs.writeFileSync(path.join(repo.path(), ".zeta", "config.yml"), "memory:\n  backend: mnemopi\n", "utf8");
		const session = await startSession(repo);
		expect(cfgMemoryBackend.get(session.settings)).toBe("mnemopi");

		// The global write is shadowed by the project layer; the running session
		// keeps the project value and the response names the layer.
		const response = await handleSettingsPut(
			settingsRequest(repo.path(), { path: "memory.backend", value: "local" }),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.provenance).toBe("project");
		expect(body.overriddenBy).toBe("project");
		expect(body.value).toBe("mnemopi");
		expect(cfgMemoryBackend.get(session.settings)).toBe("mnemopi");

		// Removing the project override makes the saved global value effective in
		// the already-running session, without a restart.
		fs.rmSync(path.join(repo.path(), ".zeta", "config.yml"));
		const applied = await handleSettingsPut(settingsRequest(repo.path(), { path: "memory.backend", value: "local" }));
		expect(applied.status).toBe(200);
		const appliedBody = (await applied.json()) as Record<string, unknown>;
		expect(appliedBody.overriddenBy).toBeUndefined();
		expect(appliedBody.value).toBe("local");
		expect(cfgMemoryBackend.get(session.settings)).toBe("local");
	});

	test("POST /api/settings/reload re-reads the live session", async () => {
		const repo = tempDir("@pi-scope-reload-");
		const session = await startSession(repo);
		expect(cfgMemoryBackend.get(session.settings)).toBe("off");

		// An edit made by another process (or by hand): no watcher in this test.
		fs.writeFileSync(path.join(getAgentDir(), "config.yml"), "memory:\n  backend: sharpshooter\n", "utf8");

		const response = await handleSettingsReload(reloadRequest(repo.path()));
		expect(response.status).toBe(200);
		expect(cfgMemoryBackend.get(session.settings)).toBe("sharpshooter");
		expect(session.settings.getProvenance(cfgMemoryBackend)).toBe("global");
	});
});
