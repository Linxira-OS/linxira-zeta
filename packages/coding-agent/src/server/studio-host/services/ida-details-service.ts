/**
 * Studio IDA details producer: native status, configuration, open files, and
 * Python execution on an open database.
 *
 * A mutation never trusts a cached database handle: the id is resolved again
 * against this project's live hosts, the database must still be open and idle,
 * and a recovery copy is written inside the workspace before IDA may change the
 * shared database. Cancellation aborts only the request that owns the signal.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	acquireDatabase,
	cfgDisassembler,
	findOpenDatabase,
	listDatabases,
	type AcquireDatabaseOptions,
	type WorkerRuntime,
} from "../../../disasm";
import type { HostCallMethod, HostStatus } from "../../../disasm/protocol";
import type { DatabaseInfo, WorkerRequestOptions } from "../../../disasm/supervisor";
import { cfgIdaInstall } from "../../../ida/install";
import { resolveIdaRuntime } from "../../../ida/runtime";
import { cfgIdaInstallDir, cfgIdaPython } from "../../../ida/settings";
import type { Settings } from "../../../config/settings";
import type { ToolSession } from "../../../tools";
import { invalid, unavailable } from "../errors";
import type { StudioIdaDatabase, StudioIdaOperation, StudioIdaStatus } from "../protocol/contracts/ida-details.js";
import { resolveIdaWorkspaceFile } from "./ida-service";

/** The session facts this producer reads; `sessionId` stays live so a switch fails the request. */
export interface StudioIdaDetailsSession {
	readonly sessionId: string;
	readonly settings: Settings;
	getEvalToolSession(): ToolSession | undefined;
}

/** The open IDA database operations Studio needs; `DisasmDatabase` satisfies this structurally. */
export interface StudioIdaHandle {
	readonly id: string;
	readonly ref: string;
	readonly name: string;
	readonly idbPath: string;
	readonly info: DatabaseInfo;
	readonly status: HostStatus;
	request(method: HostCallMethod, params: object, options?: WorkerRequestOptions): Promise<unknown>;
	close(options: { save: boolean }): Promise<void>;
}

/** Native calls behind the producer; tests substitute them without starting IDA. */
export interface StudioIdaDetailsDeps {
	resolve(toolSession: ToolSession): Promise<WorkerRuntime>;
	list(toolSession: ToolSession): Promise<StudioIdaHandle[]>;
	acquire(toolSession: ToolSession, source: string, options?: AcquireDatabaseOptions): Promise<StudioIdaHandle>;
	findOpen(toolSession: ToolSession, ref: string): Promise<StudioIdaHandle | undefined>;
}

const nativeIdaDetailsDeps: StudioIdaDetailsDeps = {
	resolve: resolveIdaRuntime,
	list: toolSession => listDatabases("ida"),
	acquire: (toolSession, source, options) => acquireDatabase(toolSession, "ida", source, options),
	findOpen: (toolSession, ref) => findOpenDatabase(toolSession, "ida", ref),
};

/** Public facts of one open database; no host path or connection details. */
export function projectStudioIdaDatabase(db: StudioIdaHandle): StudioIdaDatabase {
	const status = db.status;
	return {
		id: db.id,
		ref: db.ref,
		name: db.name,
		path: db.idbPath,
		state: status.state,
		module: db.info.module,
		format: db.info.format,
		arch: db.info.arch,
		bitness: db.info.bitness,
		busy: status.busy,
		dirty: status.dirty,
		...(status.current ? { current: { ...status.current } } : {}),
	};
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** A recovery directory for Studio changes; it can never escape the workspace. */
export async function prepareStudioIdaBackup(cwd: string, db: StudioIdaHandle): Promise<string> {
	const workspace = await fs.realpath(cwd);
	const root = path.join(workspace, "backup");
	await fs.mkdir(root, { recursive: true });
	const realRoot = await fs.realpath(root);
	if (!isWithin(workspace, realRoot)) throw invalid("IDA backup directory must stay in the current workspace");
	const created = new Date();
	const directory = path.join(realRoot, created.toISOString().slice(0, 10), `ida-${randomUUID()}`);
	await fs.mkdir(directory, { recursive: true });
	const realDirectory = await fs.realpath(directory);
	if (!isWithin(workspace, realDirectory)) throw invalid("IDA backup directory must stay in the current workspace");
	const destination = path.join(realDirectory, path.basename(db.idbPath));
	await fs.writeFile(
		path.join(realDirectory, "README.md"),
		[
			"# IDA recovery copy",
			"",
			`Source: ${db.idbPath}`,
			`Database: ${db.id}`,
			`Created: ${created.toISOString()}`,
			"",
			"Close the database in IDA before restoring this copy to its source path. Preserve any newer changes first.",
			"",
		].join("\n"),
		{ flag: "wx" },
	);
	return destination;
}

interface IdaExecResult {
	output: string;
	value: string | null;
	error: string | null;
}

function execResult(value: unknown): IdaExecResult {
	if (value === null || typeof value !== "object")
		throw unavailable("IDA worker returned an invalid execution result");
	const row = value as Record<string, unknown>;
	const output = row.output;
	const result = row.value;
	const error = row.error;
	if (
		typeof output !== "string" ||
		(result !== null && typeof result !== "string") ||
		(error !== null && typeof error !== "string")
	)
		throw unavailable("IDA worker returned an invalid execution result");
	return { output, value: result, error };
}

/** Cap one returned stream at the contract's 64 KiB per field. */
function trimIdaText(value: string | null): string | null {
	return value === null ? null : value.slice(0, 65536);
}

interface RunningIdaRequest {
	controller: AbortController;
	ownerId?: string;
}

export class StudioIdaDetailsService {
	readonly #running = new Map<string, RunningIdaRequest>();
	#disposed = false;

	constructor(
		readonly session: StudioIdaDetailsSession,
		readonly deps: StudioIdaDetailsDeps = nativeIdaDetailsDeps,
	) {}

	#assert(sessionId: string): void {
		if (this.#disposed || sessionId !== this.session.sessionId)
			throw unavailable("The session changed; reload IDA state");
	}

	#toolSession(): ToolSession {
		const toolSession = this.session.getEvalToolSession();
		if (!toolSession) throw unavailable("Native IDA context is unavailable in this Runtime");
		const backend = cfgDisassembler.get(toolSession.settings);
		if (backend !== "auto" && backend !== "ida") throw unavailable("The selected disassembler backend is not IDA");
		return toolSession;
	}

	async status(): Promise<StudioIdaStatus> {
		const settings = this.session.settings;
		const result: StudioIdaStatus = {
			backend: cfgDisassembler.get(settings),
			installDir: cfgIdaInstallDir.get(settings),
			python: cfgIdaPython.get(settings),
			available: false,
			databases: [],
		};
		if (result.backend === "none" || result.backend === "ghidra")
			return {
				...result,
				reason:
					result.backend === "none"
						? "Disassembler analysis is disabled."
						: "The selected disassembler backend is Ghidra; this page requires IDA.",
			};
		const detectedInstall = cfgIdaInstall.get(settings);
		if (!detectedInstall)
			return {
				...result,
				reason:
					"No IDA installation with idalib was found. Configure the install directory and Python interpreter.",
			};
		result.detectedInstall = detectedInstall;
		try {
			const toolSession = this.#toolSession();
			const runtime = await this.deps.resolve(toolSession);
			result.detectedPython = runtime.pythonPath;
			const databases = await this.deps.list(toolSession);
			result.databases = databases.slice(0, 128).map(projectStudioIdaDatabase);
			result.available = true;
		} catch (error) {
			result.reason = error instanceof Error ? error.message : String(error);
		}
		return result;
	}

	async execute(operation: StudioIdaOperation, ownerId?: string): Promise<unknown> {
		this.#assert(operation.sessionId);
		const result = await this.#execute(operation, ownerId);
		this.#assert(operation.sessionId);
		return result;
	}

	async #execute(operation: StudioIdaOperation, ownerId?: string): Promise<unknown> {
		if (operation.kind === "ida.status.details") return this.status();
		if (operation.kind === "ida.configure") {
			if (this.#running.size) throw unavailable("Stop the current IDA request before changing its configuration");
			cfgDisassembler.set(this.session.settings, operation.backend);
			cfgIdaInstallDir.set(this.session.settings, operation.installDir);
			cfgIdaPython.set(this.session.settings, operation.python);
			await this.session.settings.flush();
			return this.status();
		}
		if (operation.kind === "ida.database.cancel") {
			const active = this.#running.get(operation.id);
			if (active !== undefined && ownerId !== active.ownerId) return { cancelled: false };
			active?.controller.abort();
			return { cancelled: active !== undefined };
		}
		const toolSession = this.#toolSession();
		if (operation.kind === "ida.open") {
			const source = await resolveIdaWorkspaceFile(toolSession.cwd, operation.path);
			const database = await this.deps.acquire(toolSession, source.file);
			return { database: projectStudioIdaDatabase(database) };
		}
		if (this.#running.has(operation.id)) throw unavailable("A Studio request is already running on this database");
		const controller = new AbortController();
		this.#running.set(operation.id, { controller, ...(ownerId === undefined ? {} : { ownerId }) });
		try {
			const database = await this.deps.findOpen(toolSession, operation.id);
			if (!database) throw unavailable("The database is no longer open; refresh the list");
			if (database.status.busy)
				throw unavailable("The database is busy. Wait for its current native operation to finish");
			const backup = await prepareStudioIdaBackup(toolSession.cwd, database);
			controller.signal.throwIfAborted();
			this.#assert(operation.sessionId);
			if (operation.kind === "ida.close") {
				await database.request("save", { studioBackup: backup }, { signal: controller.signal, timeoutMs: 120_000 });
				await database.close({ save: true });
				return { closed: true as const, backup };
			}
			if (operation.kind === "ida.save") {
				await database.request("save", { studioBackup: backup }, { signal: controller.signal, timeoutMs: 120_000 });
				return { saved: true as const, backup };
			}
			const result = execResult(
				await database.request(
					"exec",
					{ code: operation.code, studioBackup: backup },
					{
						signal: controller.signal,
						timeoutMs: operation.timeoutMs,
					},
				),
			);
			const resultFile = path.join(path.dirname(backup), "execution-result.json");
			await fs.writeFile(resultFile, JSON.stringify(result));
			return {
				output: trimIdaText(result.output),
				value: trimIdaText(result.value),
				error: trimIdaText(result.error),
				truncated: [result.output, result.value, result.error].some(
					value => value !== null && value.length > 65536,
				),
				backup,
				resultFile,
			};
		} finally {
			const active = this.#running.get(operation.id);
			if (active?.controller === controller) this.#running.delete(operation.id);
		}
	}

	dispose(): void {
		this.#disposed = true;
		for (const active of this.#running.values()) active.controller.abort();
		this.#running.clear();
	}
}
