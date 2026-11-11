/**
 * Studio host operations added for the host-parity cutover.
 *
 * Four failure modes are pinned per operation:
 * - the capability manifest advertises exactly what has a handler;
 * - a name without a handler answers `unsupported` instead of guessing;
 * - invalid input is refused before any gateway call;
 * - the mapping returns the contract shape from real Zeta state (the bridge
 *   calls `webGatewayFetch` in-process, so these run against the real routes).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
import { handleProjectsPut } from "../src/server/web-gateway/projects.js";
import type {
	CommandInput,
	CommandName,
	CommandRequestId,
	IdempotencyKey,
	QueryInput,
	QueryName,
	QueryResult,
	ThreadId,
	WorkspaceId,
} from "../src/server/studio-host/contract/index.js";
import { countText } from "../src/server/studio-host/ops/text-count.js";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id.js";
import { StudioOperations, type StudioHostContext } from "../src/server/studio-host/registry.js";

const operations = new StudioOperations();

function context(): StudioHostContext {
	return { capabilities: operations.capabilities().manifest };
}

/** Run one command through the registry, exactly as the transport does. */
function runCommand<TName extends CommandName>(commandName: TName, input: CommandInput<TName>) {
	return operations.command(
		{
			commandName,
			input,
			idempotencyKey: `test-${commandName}` as IdempotencyKey,
			requestId: `test-${commandName}` as CommandRequestId,
		},
		context(),
	);
}

/** Run one query through the registry. */
function runQuery<TName extends QueryName>(queryName: TName, input: QueryInput<TName>) {
	return operations.query({ queryName, input }, context());
}

/** The narrow view of a successful query's result. */
async function queryResult<TName extends QueryName>(
	queryName: TName,
	input: QueryInput<TName>,
): Promise<QueryResult<TName>> {
	const response = await runQuery(queryName, input);
	if (!response.ok) throw new Error(`${queryName} failed: ${response.error.code} ${response.error.message}`);
	return response.result;
}

describe("capability manifest", () => {
	test("advertises every operation that has a handler", () => {
		for (const id of [
			"operator.invoke",
			"tokens.count",
			"runtime.ensure",
			"session.resume",
			"workspace.open",
			"workspace.file.create",
			"artifacts.saveText",
		] as const) {
			expect(operations.commands).toContain(id);
		}
		for (const id of ["diagnostics.get", "agents.definitions.get", "models.get"] as const) {
			expect(operations.queries).toContain(id);
		}
	});

	test("does not advertise an operation the host cannot answer", () => {
		for (const id of ["commands.getManifest", "session.telemetry.read"] as const) {
			expect(operations.queries).not.toContain(id);
		}
		expect(operations.commands).not.toContain("workspace.pick");
	});

	test("keeps the manifest hash stable for the same handler set", () => {
		const first = operations.capabilities().manifest;
		const second = new StudioOperations().capabilities().manifest;
		expect(first.hash).toBe(second.hash);
		expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
		expect(first.capabilities.map(entry => entry.id)).toEqual([...operations.queries, ...operations.commands]);
	});
});

describe("unsupported fallback", () => {
	test("a query with no handler answers unsupported", async () => {
		const response = await runQuery("commands.getManifest", {});
		expect(response.ok).toBe(false);
		if (!response.ok) expect(response.error.code as string).toBe("unsupported");
	});

	test("models.get returns the model-config read model", async () => {
		const result = await queryResult("models.get", {});
		expect(Array.isArray(result.providers)).toBe(true);
		expect(Array.isArray(result.roles)).toBe(true);
		expect(Array.isArray(result.availableModels)).toBe(true);
		expect(Array.isArray(result.hiddenModels)).toBe(true);
		expect(result.roles.some(role => role.id === "default")).toBe(true);
		expect(typeof result.webSearch.enabled).toBe("boolean");
	});

	test("a command with no handler throws unsupported", async () => {
		await expect(runCommand("workspace.pick", {})).rejects.toMatchObject({ code: "unsupported" });
	});
});

describe("operator.invoke", () => {
	test("refuses ids that are not builtin commands", async () => {
		await expect(runCommand("operator.invoke", { commandId: "not-builtin" })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		await expect(runCommand("operator.invoke", { commandId: "builtin." })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("refuses an unknown builtin name", async () => {
		await expect(runCommand("operator.invoke", { commandId: "builtin.not-a-real-command" })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("refuses a TUI-only builtin that has no text-mode handler", async () => {
		// `/quit` is registered with `handleTui` only; forwarding it to the model
		// as prose would be worse than refusing it.
		await expect(runCommand("operator.invoke", { commandId: "builtin.quit" })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("accepts only the command's argument text", async () => {
		await expect(
			runCommand("operator.invoke", { commandId: "builtin.compact", arguments: { mode: "soft" } }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("refuses to run without a live session", async () => {
		await expect(runCommand("operator.invoke", { commandId: "builtin.compact" })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});

describe("tokens.count", () => {
	test("counts with every embedded tokenizer", () => {
		const counted = countText("hello world");
		expect(counted.bytes).toBe(11);
		expect(counted.chars).toBe(11);
		expect(counted.lines).toBe(1);
		const o200k = counted.encodings.find(row => row.encoding === "o200k_base");
		expect(o200k?.tokens).toBe(2);
		expect(counted.encodings.length).toBeGreaterThanOrEqual(10);
		expect(counted.encodings.every(row => row.tokens > 0)).toBe(true);
	});

	test("counts lines the way an editor does", () => {
		expect(countText("").lines).toBe(0);
		expect(countText("a\nb").lines).toBe(2);
		expect(countText("a\nb\n").lines).toBe(2);
	});

	test("refuses non-string and oversized input", async () => {
		await expect(runCommand("tokens.count", { text: 5 as never })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		await expect(runCommand("tokens.count", { text: "x".repeat(262_145) })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});
});

describe("session.resume", () => {
	test("requires a thread id", async () => {
		await expect(runCommand("session.resume", { threadId: "" as ThreadId })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("an unknown thread is unavailable, not a fabricated snapshot", async () => {
		await expect(
			runCommand("session.resume", { threadId: "thread-that-does-not-exist" as ThreadId }),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});

describe("workspace.file.create", () => {
	test("refuses paths that can escape the workspace", async () => {
		await expect(
			runCommand("workspace.file.create", { workspaceId: "ws-unknown" as WorkspaceId, path: "/etc/passwd" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			runCommand("workspace.file.create", { workspaceId: "ws-unknown" as WorkspaceId, path: "../escape.txt" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			runCommand("workspace.file.create", { workspaceId: "ws-unknown" as WorkspaceId, path: "" }),
		).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});
});

describe("artifacts.saveText", () => {
	test("refuses a name that is not a text artifact", async () => {
		await expect(
			runCommand("artifacts.saveText", { kind: "export", name: "blob.exe", text: "x" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			runCommand("artifacts.saveText", { kind: "export", name: "../escape.txt", text: "x" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("refuses binary text and oversized text", async () => {
		await expect(
			runCommand("artifacts.saveText", { kind: "export", name: "notes.txt", text: "a\u0000b" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			runCommand("artifacts.saveText", { kind: "export", name: "notes.txt", text: "x".repeat(800_001) }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("refuses a kind the contract does not accept", async () => {
		await expect(
			runCommand("artifacts.saveText", { kind: "image" as never, name: "notes.txt", text: "x" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});

describe("runtime.ensure", () => {
	test("reports the in-process runtime as connected", async () => {
		const { result } = await runCommand("runtime.ensure", {});
		expect(result).toMatchObject({
			status: "connected",
			classification: "compatible-system",
			backend: "studio-host",
		});
		expect(typeof result?.runtimeVersion).toBe("string");
		expect(result?.runtimeVersion?.length).toBeGreaterThan(0);
	});

	test("refuses force instead of claiming a restart", async () => {
		await expect(runCommand("runtime.ensure", { force: true })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});
});

describe("diagnostics.get", () => {
	test(
		"returns the redacted read model with the host authority",
		async () => {
			const model = await queryResult("diagnostics.get", {});
			expect(model.redacted).toBe(true);
			expect(model.authority.authorityId).toMatch(/^authority-/u);
			expect(Array.isArray(model.entries)).toBe(true);
			for (const entry of model.entries) {
				expect(["host", "runtime", "bridge", "installer"]).toContain(entry.scope);
				expect(["info", "warning", "error"]).toContain(entry.level);
				// Path-free by construction: a drive letter or POSIX root would leak
				// an install location into a copyable page.
				expect(entry.message).not.toMatch(/[A-Za-z]:[\\/]/u);
			}
		},
		{ timeout: 30_000 },
	);
});

describe("agents.definitions.get", () => {
	test(
		"scans the configured roster and reports the picker catalogs",
		async () => {
			const model = await queryResult("agents.definitions.get", {});
			expect(model.agents.length).toBeGreaterThan(0);
			expect(model.agents.some(agent => agent.source === "bundled")).toBe(true);
			expect(model.builtinToolNames).toContain("read");
			expect(model.roleAliases).toContain("default");
			expect(typeof model.projectScopeAvailable).toBe("boolean");
			// No `agents.definition.*` handler is advertised, so no row may claim to
			// be editable through this host.
			expect(model.agents.every(agent => !agent.editable && !agent.canDelete && !agent.canFork)).toBe(true);
			for (const agent of model.agents) {
				expect(agent.name.length).toBeGreaterThan(0);
				expect(["project", "user", "bundled", "plugin"]).toContain(agent.source);
			}
		},
		{ timeout: 30_000 },
	);
});

describe("workspace commands", () => {
	let agentDir: TempDir;
	let workspaceDir: string;
	let previousAgentDir: string | undefined;
	let previousDefaultWorkspace: string | undefined;

	beforeEach(() => {
		agentDir = TempDir.createSync("@zeta-studio-host-ops-");
		previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
		previousDefaultWorkspace = process.env.ZETA_DEFAULT_WORKSPACE;
		workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-studio-ws-"));
		process.env.ZETA_CODING_AGENT_DIR = agentDir.path();
		// The gateway always lists its one default workspace; pointing it at the
		// temp tree keeps the inventory row inside the test (Zeta lists a
		// registered project that has no conversations only through that row).
		process.env.ZETA_DEFAULT_WORKSPACE = workspaceDir;
		refreshDirsFromEnv();
		resetSettingsForTest();
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
		if (previousDefaultWorkspace === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
		else process.env.ZETA_DEFAULT_WORKSPACE = previousDefaultWorkspace;
		refreshDirsFromEnv();
		resetSettingsForTest();
		fs.rmSync(workspaceDir, { recursive: true, force: true });
	});

	async function registerWorkspace(): Promise<{ workspaceId: WorkspaceId }> {
		const reply = await handleProjectsPut(
			new Request("http://127.0.0.1/api/projects", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: workspaceDir }),
			}),
		);
		expect(reply.status).toBe(200);
		const list = await queryResult("projects.list", {});
		const row = list.workspaces.find(workspace => workspace.name === path.basename(workspaceDir));
		if (row === undefined) throw new Error(`projects.list did not list ${path.basename(workspaceDir)}`);
		return { workspaceId: row.workspaceId };
	}

	test("an empty default workspace is listed without a fabricated open date", async () => {
		const list = await queryResult("projects.list", {});
		const row = list.workspaces.find(workspace => workspace.name === path.basename(workspaceDir));
		expect(row).toBeDefined();
		expect(row?.workspaceId).toBe(workspaceIdFor(workspaceDir));
		expect(row?.lastOpenedAt).toBeNull();
		expect(row?.active).toBe(true);
		expect(list.defaultWorkspaceId).toBe(row?.workspaceId);
	});

	test("a hidden workspace stays resolvable by id for file operations", async () => {
		const { workspaceId } = await registerWorkspace();
		const hidden = await handleProjectsPut(
			new Request("http://127.0.0.1/api/projects", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: workspaceDir, hidden: true }),
			}),
		);
		expect(hidden.status).toBe(200);
		const visible = await queryResult("projects.list", {});
		expect(visible.workspaces.some(workspace => workspace.workspaceId === workspaceId)).toBe(false);
		expect(visible.defaultWorkspaceId).toBeDefined();

		const created = await runCommand("workspace.file.create", { workspaceId, path: "hidden.txt" });
		expect(created.result).toEqual({ applied: true, kind: "file", path: "hidden.txt" });
		expect(fs.existsSync(path.join(workspaceDir, "hidden.txt"))).toBe(true);
	});

	test("session.create requires a registered workspace id", async () => {
		await expect(runCommand("session.create", {} as never)).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		await expect(
			runCommand("session.create", { workspaceId: "ws-0000000000000000" as WorkspaceId }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("workspace.open stamps the registry preference and reports the real inventory", async () => {
		const { workspaceId } = await registerWorkspace();
		const { result } = await runCommand("workspace.open", { workspaceId });
		expect(result).toBeDefined();
		const opened = result!.workspaces[0];
		expect(opened?.workspaceId).toBe(workspaceId);
		expect(Number.isFinite(Date.parse(opened!.lastOpenedAt!))).toBe(true);
		// `active` names the gateway's own always-open workspace (the default one
		// the test points at this tree) — the host must never relabel it.
		expect(result!.activeWorkspaceId).toBe(workspaceId);
	});

	test("workspace.open refuses a workspace the registry does not know", async () => {
		await registerWorkspace();
		await expect(
			runCommand("workspace.open", { workspaceId: "ws-0000000000000000" as WorkspaceId }),
		).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("workspace.file.create uploads an empty file and never overwrites", async () => {
		const { workspaceId } = await registerWorkspace();
		const { result } = await runCommand("workspace.file.create", { workspaceId, path: "notes.txt" });
		expect(result).toEqual({ applied: true, kind: "file", path: "notes.txt" });
		expect(fs.statSync(path.join(workspaceDir, "notes.txt")).size).toBe(0);

		await expect(runCommand("workspace.file.create", { workspaceId, path: "notes.txt" })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		await expect(
			runCommand("workspace.file.create", { workspaceId, path: "missing/notes.txt" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});

describe("model visibility settings", () => {
	let agentDir: TempDir;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		agentDir = TempDir.createSync("@zeta-model-visibility-");
		previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = agentDir.path();
		refreshDirsFromEnv();
		resetSettingsForTest();
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
		refreshDirsFromEnv();
		resetSettingsForTest();
	});

	test("models.hidden.set persists into models.get", async () => {
		await runCommand("models.hidden.set", { selectors: ["openai/*", "anthropic/claude-sonnet-4-5"] });
		const result = await queryResult("models.get", {});
		expect(result.hiddenModels).toEqual(["openai/*", "anthropic/claude-sonnet-4-5"]);
	});

	test("rejects empty selectors", async () => {
		await expect(runCommand("models.hidden.set", { selectors: [""] })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("creates and deletes a custom role through models.get", async () => {
		await runCommand("models.roles.create", { id: "reviewer", name: "Reviewer", selector: "openai/*" });
		let result = await queryResult("models.get", {});
		const created = result.roles.find(role => role.id === "reviewer");
		expect(created?.builtin).toBe(false);
		expect(created?.primary).toBe("openai/*");

		await runCommand("models.roleStorage.set", { storage: "project" });
		result = await queryResult("models.get", {});
		expect(result.modelRoleStorage).toBe("project");

		await runCommand("models.roles.delete", { roleId: "reviewer" });
		result = await queryResult("models.get", {});
		expect(result.roles.some(role => role.id === "reviewer")).toBe(false);
	});

	test("refuses to delete a built-in role", async () => {
		await expect(runCommand("models.roles.delete", { roleId: "default" })).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("advertises per-agent configure but not definition-file CRUD", () => {
		expect(operations.commands).toContain("agents.definition.configure");
		expect(operations.commands).not.toContain("agents.definition.upsert");
		expect(operations.commands).not.toContain("agents.definition.delete");
	});

	test("configure persists the per-agent model override and clears it", async () => {
		await runCommand("agents.definition.configure", { name: "scout", overrideModel: "@research" });
		let definitions = await queryResult("agents.definitions.get", {});
		const scout = definitions.agents.find(agent => agent.name === "scout");
		expect(scout?.overrideModel).toBe("@research");

		await runCommand("agents.definition.configure", { name: "scout", overrideModel: null });
		definitions = await queryResult("agents.definitions.get", {});
		expect(definitions.agents.find(agent => agent.name === "scout")?.overrideModel).toBeUndefined();
	});

	test("configure refuses an unknown agent before writing", async () => {
		await expect(
			runCommand("agents.definition.configure", { name: "not-a-real-agent", overrideModel: "@task" }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});
