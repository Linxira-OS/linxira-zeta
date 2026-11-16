/**
 * Studio IDA producer: version-fenced reads and single-use prepared writes.
 *
 * The worker owns one database instance (`identity`) and a monotonic `version`.
 * Every mutating request carries the pair captured at review time, so a review
 * made against an older database state is rejected by the native worker instead
 * of being applied to whatever is open now. A prepared write is one-shot: the
 * token is removed before the native call and also expires on its own.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { acquireIdaDatabase, listIdaDatabases, resolveIdaRuntime } from "../../../ida";
import type { ToolSession } from "../../../tools";
import { invalid, unavailable } from "../errors";
import type { IdaEdit, IdaOperation, IdaRow } from "../protocol/contracts/ida.js";

/** One database as exposed to the IDA producer. */
export interface StudioIdaDb {
	id: string;
	label: string;
	state: "opening" | "open";
	dirty: boolean;
	busy: boolean;
	request(params: object, signal?: AbortSignal): Promise<{ identity: string; version: number; result: unknown }>;
}

/** Native operations the producer needs; tests substitute a fake database. */
export interface StudioIdaPort {
	available(): Promise<void>;
	list(): Promise<StudioIdaDb[]>;
	open(file: string, signal: AbortSignal): Promise<void>;
}

/** The session facts this producer reads; `sessionId` stays live so a switch fails the request. */
export interface StudioIdaSession {
	readonly sessionId: string;
	readonly sessionManager: { getCwd(): string };
	getEvalToolSession(): ToolSession | undefined;
}

interface StudioIdaReply {
	identity: string;
	version: number;
	result: unknown;
}

/** Narrow the worker's `{ identity, version, result }` envelope without trusting fields. */
function studioReply(value: unknown): StudioIdaReply {
	if (value === null || typeof value !== "object") throw unavailable("IDA worker returned an invalid answer");
	const row = value as Record<string, unknown>;
	if (
		typeof row.identity !== "string" ||
		typeof row.version !== "number" ||
		!Number.isSafeInteger(row.version) ||
		row.version < 0
	)
		throw unavailable("IDA worker returned an invalid answer");
	return { identity: row.identity, version: row.version, result: row.result };
}

function nativePort(session: StudioIdaSession): StudioIdaPort {
	const tool = () => {
		const toolSession = session.getEvalToolSession();
		if (!toolSession) throw unavailable("Native IDA context is unavailable in this Runtime");
		return toolSession;
	};
	return {
		available: async () => {
			await resolveIdaRuntime(tool());
		},
		list: async () =>
			Promise.all(
				(await listIdaDatabases(tool())).map(async db => {
					await db.refresh();
					return {
						id: db.id,
						label: db.info.module || db.id,
						state: db.status.state,
						dirty: db.status.dirty,
						busy: db.status.busy,
						request: async (params: object, signal?: AbortSignal) =>
							studioReply(await db.request("studio", params, { signal, timeoutMs: 120_000 })),
					};
				}),
			),
		open: async (file, signal) => {
			await acquireIdaDatabase(tool(), file, { signal });
		},
	};
}

/**
 * Resolve one user-supplied IDA input inside `cwd`.
 *
 * The final path is canonicalized and must stay below the workspace. The entry
 * itself must be a regular file and not a symlink: accepting a link would let a
 * workspace path select a database the user never placed there.
 */
export async function resolveIdaWorkspaceFile(
	cwd: string,
	input: string,
	message = "IDA input must stay in the current workspace",
): Promise<{ file: string; fingerprint: string }> {
	const root = await fs.realpath(cwd);
	const candidate = path.resolve(root, input);
	const entry = await fs.lstat(candidate);
	if (entry.isSymbolicLink() || !entry.isFile()) throw invalid("Choose an IDA database or binary file");
	const file = await fs.realpath(candidate);
	const relative = path.relative(root, file);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw invalid(message);
	const stat = await fs.stat(file);
	return { file, fingerprint: JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs]) };
}

interface StudioIdaReview {
	edit: IdaEdit;
	sessionId: string;
	ownerId?: string;
	expiresAt: number;
	identity?: string;
	version?: number;
	file?: string;
	fingerprint?: string;
}

/** Parameters one committed edit sends to the native worker (no host-only fields). */
function editParams(edit: IdaEdit): object {
	switch (edit.action) {
		case "save":
			return {};
		case "close":
			return { save: edit.save };
		case "rename":
			return { target: edit.target, name: edit.name };
		case "comment":
			return { target: edit.target, text: edit.text, repeatable: edit.repeatable };
		case "set_type":
			return { target: edit.target, decl: edit.decl };
		case "make_function":
			return { target: edit.target };
		case "exec":
			return { code: edit.code };
		case "open":
			return {};
	}
}

export class StudioIdaService {
	#reviews = new Map<string, StudioIdaReview>();
	#active: AbortController | undefined;
	#activeOwner: string | undefined;

	constructor(
		readonly session: StudioIdaSession,
		readonly port: StudioIdaPort = nativePort(session),
	) {}

	get running(): boolean {
		return !!this.#active;
	}

	dispose(): void {
		this.#active?.abort();
		this.#active = undefined;
		this.#activeOwner = undefined;
		this.#reviews.clear();
	}

	#assert(sessionId: string): void {
		if (sessionId !== this.session.sessionId) throw unavailable("Session changed; reopen IDA");
	}

	async #db(id: string): Promise<StudioIdaDb> {
		const db = (await this.port.list()).find(candidate => candidate.id === id);
		if (!db || db.state !== "open") throw unavailable("IDA database is no longer open");
		return db;
	}

	async execute(op: IdaOperation, ownerId?: string): Promise<unknown> {
		this.#assert(op.sessionId);
		const result = await this.#execute(op, ownerId);
		this.#assert(op.sessionId);
		return result;
	}

	async #execute(op: IdaOperation, ownerId?: string): Promise<unknown> {
		if (op.kind === "ida.cancel") {
			const active = this.#active;
			if (active !== undefined && ownerId !== this.#activeOwner) return { cancelled: false };
			const cancelled = !!active;
			active?.abort();
			return { cancelled };
		}
		if (op.kind === "ida.status") {
			try {
				await this.port.available();
				const databases: IdaRow[] = await Promise.all(
					(await this.port.list()).map(async db => {
						let meta: { identity?: string; version?: number } = {};
						if (db.state === "open") {
							try {
								meta = await db.request({ method: "status" });
							} catch {
								// Status is best effort; the database stays listed without fences.
							}
						}
						return {
							id: db.id,
							label: db.label,
							state: db.state,
							dirty: db.dirty,
							busy: db.busy,
							...(meta.identity ? { identity: meta.identity, version: meta.version } : {}),
						};
					}),
				);
				return { available: true, databases };
			} catch (error) {
				return {
					available: false,
					reason: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
					databases: [],
				};
			}
		}
		await this.port.available();
		if (op.kind === "ida.view") {
			if (this.#active) throw unavailable("An IDA operation is still running");
			const controller = new AbortController();
			this.#active = controller;
			this.#activeOwner = ownerId;
			try {
				const db = await this.#db(op.dbId);
				controller.signal.throwIfAborted();
				this.#assert(op.sessionId);
				const value = await db.request(
					{
						method: "view",
						identity: op.identity,
						version: op.version,
						params: { kind: op.view, ...(op.target ? { target: op.target } : {}) },
						offset: op.offset ?? 0,
						limit: 100,
					},
					controller.signal,
				);
				return value.result;
			} finally {
				if (this.#active === controller) {
					this.#active = undefined;
					this.#activeOwner = undefined;
				}
			}
		}
		if (op.kind === "ida.prepare") {
			// Expired reviews can never be committed; drop them before the bound is checked.
			for (const [token, review] of this.#reviews) if (review.expiresAt < Date.now()) this.#reviews.delete(token);
			const expiresAt = Date.now() + 300_000;
			const token = randomUUID();
			let meta: { identity?: string; version?: number; file?: string; fingerprint?: string } = {};
			if (op.edit.action === "open")
				meta = await resolveIdaWorkspaceFile(this.session.sessionManager.getCwd(), op.edit.path);
			else {
				const db = await this.#db(op.edit.dbId);
				const current = await db.request({ method: "status" });
				if (!current.identity || !Number.isSafeInteger(current.version))
					throw unavailable("This IDA host does not support version-fenced changes");
				meta = { identity: current.identity, version: current.version };
			}
			if (this.#reviews.size >= 16) this.#reviews.clear();
			this.#reviews.set(token, {
				edit: structuredClone(op.edit),
				sessionId: op.sessionId,
				ownerId,
				expiresAt,
				...meta,
			});
			return {
				token,
				edit: op.edit,
				expiresAt,
				...(meta.identity ? { identity: meta.identity, version: meta.version } : {}),
			};
		}
		const quote = this.#reviews.get(op.token);
		this.#reviews.delete(op.token);
		if (!quote || quote.sessionId !== op.sessionId || quote.ownerId !== ownerId || quote.expiresAt < Date.now())
			throw invalid("IDA review expired; review again");
		if (this.#active) throw unavailable("An IDA operation is still running");
		const controller = new AbortController();
		this.#active = controller;
		this.#activeOwner = ownerId;
		try {
			const edit = quote.edit;
			if (edit.action === "open") {
				const file = await resolveIdaWorkspaceFile(this.session.sessionManager.getCwd(), edit.path);
				if (file.file !== quote.file || file.fingerprint !== quote.fingerprint)
					throw invalid("IDA input changed since review");
				this.#assert(op.sessionId);
				await this.port.open(file.file, controller.signal);
				return { text: "Opened / 已打开" };
			}
			const db = await this.#db(edit.dbId);
			this.#assert(op.sessionId);
			const response = await db.request(
				{
					method: edit.action,
					identity: quote.identity,
					version: quote.version,
					params: editParams(edit),
				},
				controller.signal,
			);
			const text = JSON.stringify(response.result, null, 2) ?? "";
			return { text: text.length > 262144 ? `${text.slice(0, 262100)}\n[Output truncated]` : text };
		} finally {
			if (this.#active === controller) {
				this.#active = undefined;
				this.#activeOwner = undefined;
			}
		}
	}
}
