import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import type { HostStatus } from "../src/disasm/protocol";
import { StudioOperations } from "../src/server/studio-host/registry";
import type { StudioHostContext } from "../src/server/studio-host/registry";
import { idaOps } from "../src/server/studio-host/ops/ida";
import type {
	CommandInput,
	CommandName,
	CommandRequestId,
	IdempotencyKey,
} from "../src/server/studio-host/contract/index.js";
import type { StudioIdaDb, StudioIdaPort, StudioIdaSession } from "../src/server/studio-host/services/ida-service";
import { StudioIdaService, resolveIdaWorkspaceFile } from "../src/server/studio-host/services/ida-service";
import type {
	StudioIdaDetailsDeps,
	StudioIdaDetailsSession,
	StudioIdaHandle,
} from "../src/server/studio-host/services/ida-details-service";
import {
	prepareStudioIdaBackup,
	StudioIdaDetailsService,
} from "../src/server/studio-host/services/ida-details-service";
import type { StudioIdaStatus } from "../src/server/studio-host/protocol/contracts/ida-details.js";
import type { ToolSession } from "../src/tools";

let directory: string;
let workspace: string;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-ida-host-"));
	workspace = path.join(directory, "workspace");
	await fs.mkdir(workspace);
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

function legacySession(): StudioIdaSession {
	return {
		sessionId: "s",
		sessionManager: { getCwd: () => workspace },
		getEvalToolSession: () => undefined,
	};
}

function legacyDb(
	request: StudioIdaDb["request"],
	options: { busy?: boolean; state?: StudioIdaDb["state"]; label?: string } = {},
): StudioIdaDb {
	return {
		id: "db",
		label: options.label ?? "sample.exe",
		state: options.state ?? "open",
		dirty: false,
		busy: options.busy ?? false,
		request,
	};
}

function rawMethod(params: object): string {
	if ("method" in params && typeof params.method === "string") return params.method;
	throw new Error("missing method");
}

describe("legacy IDA review/commit producer", () => {
	test("reviews and commits are single-use and fenced to the native identity/version", async () => {
		let version = 1;
		const calls: string[] = [];
		const db = legacyDb(async raw => {
			const method = rawMethod(raw);
			calls.push(method);
			if (method === "status") return { identity: "instance", version, result: {} };
			if (!("identity" in raw) || raw.identity !== "instance" || !("version" in raw) || raw.version !== version)
				throw new Error("stale");
			version++;
			return { identity: "instance", version, result: { ok: true } };
		});
		const port: StudioIdaPort = {
			available: async () => {},
			list: async () => [db],
			open: async () => {
				throw new Error("unexpected open");
			},
		};
		const service = new StudioIdaService(legacySession(), port);
		const quote = (await service.execute({
			kind: "ida.prepare",
			sessionId: "s",
			edit: { action: "rename", dbId: "db", target: "main", name: "entry" },
		})) as { token: string };
		expect(calls).toEqual(["status"]);
		version++;
		await expect(service.execute({ kind: "ida.commit", sessionId: "s", token: quote.token })).rejects.toThrow(
			"stale",
		);
		await expect(service.execute({ kind: "ida.commit", sessionId: "s", token: quote.token })).rejects.toThrow(
			"expired",
		);
		const fresh = (await service.execute({
			kind: "ida.prepare",
			sessionId: "s",
			edit: { action: "save", dbId: "db" },
		})) as { token: string };
		await service.execute({ kind: "ida.commit", sessionId: "s", token: fresh.token });
		expect(calls.at(-1)).toBe("save");
		await expect(service.execute({ kind: "ida.status", sessionId: "wrong" })).rejects.toThrow("Session changed");
		service.dispose();
	});

	test("absent IDA is explicit and never lists or opens a database", async () => {
		let touched = false;
		const service = new StudioIdaService(legacySession(), {
			available: async () => {
				throw new Error("IDA not installed");
			},
			list: async () => {
				touched = true;
				return [];
			},
			open: async () => {
				touched = true;
			},
		});
		expect(await service.execute({ kind: "ida.status", sessionId: "s" })).toEqual({
			available: false,
			reason: "IDA not installed",
			databases: [],
		});
		expect(touched).toBe(false);
	});

	test("cancel aborts only the owner's running view", async () => {
		let aborted = 0;
		const started = Promise.withResolvers<void>();
		const db = legacyDb(async (_raw, signal) => {
			const pending = Promise.withResolvers<{ identity: string; version: number; result: unknown }>();
			signal?.addEventListener(
				"abort",
				() => {
					aborted++;
					pending.reject(new Error("interrupted"));
				},
				{ once: true },
			);
			started.resolve();
			return pending.promise;
		});
		const port: StudioIdaPort = { available: async () => {}, list: async () => [db], open: async () => {} };
		const service = new StudioIdaService(legacySession(), port);
		const running = service.execute(
			{ kind: "ida.view", sessionId: "s", dbId: "db", identity: "instance", version: 1, view: "overview" },
			"owner",
		);
		await started.promise;
		expect(await service.execute({ kind: "ida.cancel", sessionId: "s" }, "intruder")).toEqual({ cancelled: false });
		expect(aborted).toBe(0);
		expect(await service.execute({ kind: "ida.cancel", sessionId: "s" }, "owner")).toEqual({ cancelled: true });
		await expect(running).rejects.toThrow("interrupted");
		service.dispose();
	});
});

function fakeHandle(
	request: StudioIdaHandle["request"] = async () => ({ idb: path.join(workspace, "sample.i64") }),
	close: StudioIdaHandle["close"] = async () => {},
	options: { busy?: boolean; id?: string; idbPath?: string } = {},
): StudioIdaHandle {
	const id = options.id ?? "db";
	const info = { module: "sample.exe", format: "pe", arch: "metapc", bitness: 64 };
	const idbPath = options.idbPath ?? path.join(workspace, "sample.i64");
	const status: HostStatus = {
		id,
		ref: id,
		idbPath,
		handle: `dsm:ida:${id}`,
		references: 0,
		info,
		state: "open",
		busy: options.busy ?? false,
		lastUsed: 0,
		current: null,
		dirty: false,
	};
	return { id, ref: id, name: id, idbPath, info, status, request, close };
}

function detailsSession(settings: Settings, tool = true): StudioIdaDetailsSession {
	const toolSession = { cwd: workspace, hasUI: false, settings } as unknown as ToolSession;
	return {
		sessionId: "s",
		settings,
		getEvalToolSession: () => (tool ? toolSession : undefined),
	};
}

function detailsDeps(
	handles: StudioIdaHandle[],
	acquire: StudioIdaDetailsDeps["acquire"] = async () => {
		throw new Error("unexpected acquire");
	},
): StudioIdaDetailsDeps {
	return {
		resolve: async () => ({ pythonPath: "/missing/python", env: {} }),
		list: async () => handles,
		acquire,
		findOpen: async (_tool, ref) => handles.find(handle => handle.id === ref),
	};
}

describe("IDA details producer", () => {
	test("disabled IDA reports configuration status without probing Python", async () => {
		const settings = Settings.isolated({ "disassembler.backend": "none" });
		const service = new StudioIdaDetailsService(detailsSession(settings), detailsDeps([]));
		expect(await service.execute({ kind: "ida.status.details", sessionId: "s" })).toMatchObject({
			backend: "none",
			available: false,
			databases: [],
			reason: "Disassembler analysis is disabled.",
		});
		await expect(
			service.execute({ kind: "ida.run", sessionId: "old", id: "db", code: "print(1)", timeoutMs: 1000 }),
		).rejects.toThrow("session changed");
	});

	test("configuration is written before the fresh detection result", async () => {
		const settings = Settings.isolated();
		const service = new StudioIdaDetailsService(detailsSession(settings), detailsDeps([]));
		const status = (await service.execute({
			kind: "ida.configure",
			sessionId: "s",
			backend: "none",
			installDir: path.join(directory, "missing-ida"),
			python: "/missing/python",
		})) as StudioIdaStatus;
		expect(status).toMatchObject({
			backend: "none",
			installDir: path.join(directory, "missing-ida"),
			python: "/missing/python",
			available: false,
			databases: [],
			reason: "Disassembler analysis is disabled.",
		});
	});

	test("workspace files are realpath-confined and symlinks are refused", async () => {
		const outside = path.join(directory, "foreign.bin");
		await fs.writeFile(outside, "not a database");
		await expect(resolveIdaWorkspaceFile(workspace, "../foreign.bin")).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		const link = path.join(workspace, "linked.bin");
		try {
			await fs.symlink(outside, link);
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : undefined;
			if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return;
			throw error;
		}
		await expect(resolveIdaWorkspaceFile(workspace, "linked.bin")).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
	});

	test("a foreign database id is refused before a backup is written", async () => {
		const service = new StudioIdaDetailsService(detailsSession(Settings.isolated()), detailsDeps([]));
		await expect(service.execute({ kind: "ida.save", sessionId: "s", id: "foreign" })).rejects.toThrow(
			"no longer open",
		);
		await expect(fs.stat(path.join(workspace, "backup"))).rejects.toThrow();
	});

	test("a busy database is refused before a backup is written", async () => {
		const service = new StudioIdaDetailsService(
			detailsSession(Settings.isolated()),
			detailsDeps([fakeHandle(undefined, undefined, { busy: true })]),
		);
		await expect(service.execute({ kind: "ida.save", sessionId: "s", id: "db" })).rejects.toThrow("busy");
		await expect(fs.stat(path.join(workspace, "backup"))).rejects.toThrow();
	});

	test("save writes a workspace-confined recovery copy before the native save", async () => {
		const calls: object[] = [];
		const handle = fakeHandle(async (_method, params) => {
			calls.push(params);
			return { idb: path.join(workspace, "sample.i64") };
		});
		const service = new StudioIdaDetailsService(detailsSession(Settings.isolated()), detailsDeps([handle]));
		const result = (await service.execute({ kind: "ida.save", sessionId: "s", id: "db" })) as {
			saved: true;
			backup: string;
		};
		expect(result.saved).toBe(true);
		expect(result.backup.startsWith(path.join(await fs.realpath(workspace), "backup"))).toBe(true);
		expect(await fs.readdir(path.dirname(result.backup))).toContain("README.md");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ studioBackup: result.backup });
	});

	test("run returns capped output, writes the result file, and reports the checkpoint", async () => {
		const handle = fakeHandle(async () => ({ output: "x".repeat(70_000), value: "42", error: null }));
		const service = new StudioIdaDetailsService(detailsSession(Settings.isolated()), detailsDeps([handle]));
		const result = (await service.execute({
			kind: "ida.run",
			sessionId: "s",
			id: "db",
			code: "6 * 7",
			timeoutMs: 1000,
		})) as {
			output: string;
			value: string | null;
			error: string | null;
			truncated: boolean;
			backup: string;
			resultFile: string;
		};
		expect(result.output).toHaveLength(65536);
		expect(result.value).toBe("42");
		expect(result.error).toBeNull();
		expect(result.truncated).toBe(true);
		const written = JSON.parse(await fs.readFile(result.resultFile, "utf8")) as { output: string };
		expect(written.output).toHaveLength(70_000);
	});

	test("backup destinations stay under the workspace even for an external database path", async () => {
		const handle = fakeHandle(undefined, undefined, { idbPath: path.join(directory, "outside", "shared.i64") });
		const destination = await prepareStudioIdaBackup(workspace, handle);
		expect(destination.startsWith(path.join(await fs.realpath(workspace), "backup"))).toBe(true);
		expect(path.basename(destination)).toBe("shared.i64");
	});
});

describe("IDA host ownership and validation", () => {
	const operations = new StudioOperations([idaOps]);
	const context: StudioHostContext = { capabilities: operations.capabilities().manifest };

	function request<TName extends CommandName>(commandName: TName, input: CommandInput<TName>) {
		return operations.command(
			{
				commandName,
				input,
				requestId: `test-${commandName}` as CommandRequestId,
				idempotencyKey: `test-${commandName}` as IdempotencyKey,
			},
			context,
		);
	}

	test("advertises every IDA operation", () => {
		expect(operations.commands).toEqual(
			expect.arrayContaining([
				"ida.status",
				"ida.view",
				"ida.prepare",
				"ida.commit",
				"ida.cancel",
				"ida.status.details",
				"ida.configure",
				"ida.open",
				"ida.save",
				"ida.close",
				"ida.run",
				"ida.database.cancel",
			]),
		);
	});

	test("refuses a live-view request without an authenticated private owner", async () => {
		await expect(request("ida.status", { sessionId: "s" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	test("refuses invalid details input before resolving a session", async () => {
		await expect(
			request("ida.run", { sessionId: "s", id: "db", code: "print(1)", timeoutMs: 400_000 }),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});
