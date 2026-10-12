/**
 * Custom-command hot reload: editing `commands/<name>/index.*` while a session
 * runs must refresh the live command set (and therefore every command-metadata
 * subscriber: TUI autocomplete, RPC and ACP command lists), a malformed write
 * must keep the last version that loaded and warn once, and a deleted file must
 * disappear on the next reload.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Api, Model, ModelSpec } from "@linxiraos/pi-ai";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir, withTimeout } from "@linxiraos/pi-utils";

const COMMAND_NAME = "hot-reload-probe";
const MALFORMED_SOURCE = "export default () => { this is not valid;\n";

function buildLocalModel(api: string): Model<Api> {
	return buildModel({
		id: "command-reload-model",
		name: "Command Reload Model",
		api,
		provider: "managed-primary",
		baseUrl: "http://127.0.0.1:8080/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	} as ModelSpec<Api>) as Model<Api>;
}

function commandModule(description: string): string {
	return [
		"export default () => ({",
		`\tname: ${JSON.stringify(COMMAND_NAME)},`,
		`\tdescription: ${JSON.stringify(description)},`,
		"\texecute() {},",
		"});",
		"",
	].join("\n");
}

function descriptionOf(session: AgentSession): string | undefined {
	return session.customCommands.find(({ command }) => command.name === COMMAND_NAME)?.command.description;
}

/** Resolve once a command-metadata notification observes `predicate`. */
async function waitForCommandState(
	session: AgentSession,
	predicate: () => boolean,
	label: string,
	timeoutMs = 15_000,
): Promise<void> {
	if (predicate()) return;
	const { promise, resolve } = Promise.withResolvers<void>();
	const unsubscribe = session.subscribeCommandMetadataChanged(() => {
		if (!predicate()) return;
		unsubscribe();
		resolve();
	});
	await withTimeout(promise, timeoutMs, `Timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function createReloadSession(tempDir: TempDir): Promise<{ session: AgentSession; authStorage: AuthStorage }> {
	const marker = Bun.nanoseconds().toString(36);
	const authStorage = await AuthStorage.create(tempDir.join("auth.db"));
	authStorage.keys.setRuntime("managed-primary", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, tempDir.join("models.yml"));
	const { session } = await createAgentSession({
		cwd: tempDir.path(),
		agentDir: tempDir.path(),
		sessionManager: SessionManager.inMemory(tempDir.path()),
		authStorage,
		modelRegistry,
		settings: Settings.isolated({ "compaction.enabled": false, extensions: [] }),
		model: buildLocalModel(`command-reload-${marker}`),
		skills: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	return { session, authStorage };
}

async function createProbeCommandFile(tempDir: TempDir): Promise<string> {
	const commandDir = path.join(tempDir.path(), "commands", "probe");
	await fs.mkdir(commandDir, { recursive: true });
	const commandPath = path.join(commandDir, "index.ts");
	await fs.writeFile(commandPath, commandModule("first"));
	return commandPath;
}

describe("custom command hot reload", () => {
	it("reloads an edited command, keeps the last good version of a malformed one and warns once", async () => {
		using tempDir = TempDir.createSync("@pi-cmd-reload-");
		const commandPath = await createProbeCommandFile(tempDir);
		const { session, authStorage } = await createReloadSession(tempDir);
		try {
			expect(descriptionOf(session)).toBe("first");

			const edited = waitForCommandState(
				session,
				() => descriptionOf(session) === "second",
				"the edited command description",
			);
			await fs.writeFile(commandPath, commandModule("second"));
			await edited;

			const warnings: string[] = [];
			const { promise: warned, resolve: resolveWarned } = Promise.withResolvers<void>();
			const unsubscribe = session.subscribe(event => {
				if (event.type !== "notice" || event.source !== "commands") return;
				warnings.push(event.message);
				resolveWarned();
			});
			await fs.writeFile(commandPath, MALFORMED_SOURCE);
			await withTimeout(warned, 15_000, "Timed out waiting for the malformed-command warning");
			unsubscribe();

			expect(warnings[0]).toContain(commandPath);
			expect(descriptionOf(session)).toBe("second");
			expect(session.isDisposed).toBeFalse();

			const recovered = waitForCommandState(
				session,
				() => descriptionOf(session) === "third",
				"the repaired command description",
			);
			await fs.writeFile(commandPath, commandModule("third"));
			await recovered;
			expect(descriptionOf(session)).toBe("third");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});

	it("drops a deleted command file from the live set", async () => {
		using tempDir = TempDir.createSync("@pi-cmd-reload-delete-");
		const commandPath = await createProbeCommandFile(tempDir);
		const { session, authStorage } = await createReloadSession(tempDir);
		try {
			expect(descriptionOf(session)).toBe("first");

			const removed = waitForCommandState(
				session,
				() => descriptionOf(session) === undefined,
				"the deleted command to leave the live set",
			);
			await fs.rm(commandPath);
			await removed;
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});
});
