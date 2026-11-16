/**
 * Studio session worktrees — the native-backed owner of `worktrees.session.*`.
 *
 * One service is bound to one live `AgentSession`, mirroring the official
 * Studio bridge: the caller's session is the only authority for cwd, settings
 * and ownership, and no second resident manager is created. The service does
 * not switch sessions itself; `create`/`open`/`resume.prepare` return a cwd
 * (the host adds the opaque workspace id) and the renderer drives the existing
 * `workspace.open` + `session.create|resume` gateway routes.
 *
 * Managed worktrees live in a per-repository registry under the agent
 * directory. Only rows recorded there are listed or removable: this is not
 * `git worktrees.list`, which has no session ownership. Removal is two-step:
 * `remove.prepare` inspects the worktree, leases every session file in it and
 * plans the native exit (which snapshots a fingerprint); `remove.apply`
 * accepts that exact token once, re-checks the registry row, and hands the
 * plan to the native remover, which refuses a worktree that changed since the
 * preview. A token that expired, was already consumed, was issued by another
 * service instance, or names another session is rejected.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as vcs from "@linxiraos/pi-natives/vcs";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";
import type { AgentSession } from "../../../session/agent-session";
import { cfgSessionWorktreeScope } from "../../../session/settings";
import { resolveResumeTarget, sessionDisplayName } from "../../../session/session-listing";
import { SessionManager } from "../../../session/session-manager";
import { FileSessionStorage } from "../../../session/session-storage";
import {
	canAutoCreateWorktree,
	createSessionWorktree,
	defaultSessionWorktreeBranch,
	inspectSessionWorktree,
	planWorktreeExit,
	removeExitWorktrees,
	type SessionWorktree,
	type WorktreeExitPlan,
} from "../../../session/session-worktree";
import { cfgWorktreeOnExit, cfgWorktreeOnStart } from "../../../task/settings";
import { AgentRegistry } from "../../../registry/agent-registry";
import type {
	SessionResumeRow,
	SessionWorktreeOperation,
	SessionWorktreeRow,
	WorktreeRemovalPreview,
} from "../protocol/contracts/session-worktrees";
import { invalid, unavailable } from "../errors";

interface OwnedWorktree {
	id: string;
	sessionId: string;
	worktree: SessionWorktree;
}

const clean = (cause: unknown) =>
	String(cause instanceof Error ? cause.message : cause)
		.replace(/[\u0000-\u001f]/gu, " ")
		.slice(0, 1024) || "Worktree operation failed";

const equalPath = async (a: string, b: string): Promise<boolean> => {
	try {
		const [left, right] = await Promise.all([fs.realpath(a), fs.realpath(b)]);
		return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
	} catch {
		// Missing or inaccessible directories cannot prove ownership.
		return false;
	}
};

/** Whether `child` is `parent` or sits below it (no filesystem access). */
function inside(parent: string, child: string): boolean {
	const normalizedParent = process.platform === "win32" ? parent.toLowerCase() : parent;
	const normalizedChild = process.platform === "win32" ? child.toLowerCase() : child;
	const relative = path.relative(normalizedParent, normalizedChild);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** One live AgentSession's worktree authority. */
export class StudioSessionWorktreesService {
	/** Fences removal tokens issued by this service instance. */
	readonly #instance = crypto.randomUUID();
	#pending:
		| {
				owner: string;
				instance: string;
				preview: WorktreeRemovalPreview;
				plan: WorktreeExitPlan[];
				owned: OwnedWorktree;
		  }
		| undefined;
	#busy = false;
	#disposed = false;
	#startDecisionSession: string | undefined;

	constructor(
		readonly session: AgentSession,
		readonly isLive: () => boolean,
	) {}

	dispose(): void {
		this.#disposed = true;
		this.#pending = undefined;
	}

	/** The official first-turn gate; throws until a fresh checkout has decided. */
	async ensureStartResolved(): Promise<void> {
		if (
			this.#startDecisionSession === this.session.sessionId ||
			this.session.messages.length ||
			cfgWorktreeOnStart.get(this.session.settings) === "off"
		) {
			return;
		}
		if (await canAutoCreateWorktree(this.session.sessionManager.getCwd())) {
			throw invalid("Choose the session worktree before sending the first prompt");
		}
	}

	#check(id: string): void {
		if (this.#disposed || !this.isLive() || this.session.isDisposed || id !== this.session.sessionId) {
			throw unavailable("Worktree session changed");
		}
	}

	async #registry(): Promise<string> {
		const cwd = this.session.sessionManager.getCwd();
		const repository = vcs.git(cwd);
		let root: string;
		try {
			root = await fs.realpath(repository ? repository.primaryRoot() : cwd);
		} catch {
			throw unavailable("Worktree session directory is unavailable");
		}
		return path.join(
			getAgentDir(),
			"studio",
			"worktrees",
			createHash("sha256")
				.update(process.platform === "win32" ? root.toLowerCase() : root)
				.digest("hex") + ".json",
		);
	}

	async #load(file: string): Promise<OwnedWorktree[]> {
		try {
			const stat = await fs.lstat(file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw Error("Invalid worktree registry");
			const rows: unknown = JSON.parse(await fs.readFile(file, "utf8"));
			if (!Array.isArray(rows) || rows.length > 1000) throw Error("Invalid worktree registry");
			const ids = new Set<string>();
			for (const candidate of rows) {
				if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
					throw Error("Invalid managed worktree");
				}
				const row: Record<string, unknown> = candidate;
				const id = row.id;
				const sessionId = row.sessionId;
				if (
					typeof id !== "string" ||
					!/^[a-f0-9-]{36}$/u.test(id) ||
					ids.has(id) ||
					typeof sessionId !== "string" ||
					!sessionId ||
					sessionId.length > 512 ||
					!row.worktree ||
					typeof row.worktree !== "object" ||
					Array.isArray(row.worktree)
				) {
					throw Error("Invalid managed worktree");
				}
				const worktree = row.worktree as Record<string, unknown>;
				const worktreePath = worktree.path;
				const sourceCwd = worktree.sourceCwd;
				const branch = worktree.branch;
				const baseCommit = worktree.baseCommit;
				if (
					typeof worktreePath !== "string" ||
					!worktreePath ||
					typeof sourceCwd !== "string" ||
					!sourceCwd ||
					typeof branch !== "string" ||
					!branch ||
					typeof baseCommit !== "string" ||
					!baseCommit
				) {
					throw Error("Invalid managed worktree path");
				}
				if (typeof worktree.keptChanges !== "boolean") throw Error("Invalid managed worktree state");
				for (const key of ["clonedWith", "cloneError"]) {
					if (worktree[key] !== undefined && typeof worktree[key] !== "string") {
						throw Error("Invalid managed worktree state");
					}
				}
				if (!path.isAbsolute(worktreePath) || !path.isAbsolute(sourceCwd)) {
					throw Error("Invalid worktree registry path");
				}
				ids.add(id);
			}
			return rows as OwnedWorktree[];
		} catch (cause) {
			if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return [];
			throw cause;
		}
	}

	async #save(file: string, rows: OwnedWorktree[]): Promise<void> {
		const temporary = file + "." + crypto.randomUUID() + ".partial";
		try {
			await fs.writeFile(temporary, JSON.stringify(rows), { flag: "wx", mode: 0o600 });
			await fs.rename(temporary, file);
		} finally {
			await fs.unlink(temporary).catch(() => {});
		}
	}

	async #row(owned: OwnedWorktree): Promise<SessionWorktreeRow> {
		const base = {
			id: owned.id,
			branch: owned.worktree.branch,
			directory: owned.worktree.path,
			sessionId: owned.sessionId,
			current: await equalPath(owned.worktree.path, this.session.sessionManager.getCwd()),
		};
		try {
			const stat = await fs.lstat(owned.worktree.path);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Worktree directory is unavailable");
			const state = await inspectSessionWorktree(owned.worktree);
			return { ...base, dirty: state.dirty, hasCommits: state.moved, detached: state.offBranch, missing: false };
		} catch (cause) {
			return { ...base, dirty: false, hasCommits: true, detached: false, missing: true, reason: clean(cause) };
		}
	}

	/**
	 * Whether any live session in this process already runs inside `directory`.
	 * `claimSession` is reentrant for this process's own leases, so it alone
	 * cannot prove the worktree is idle. Sessions in `ignoring` are the ones
	 * being torn down by the shutdown pass itself, not other owners.
	 */
	#liveSessionInside(directory: string, ignoring?: ReadonlySet<AgentSession>): boolean {
		for (const ref of AgentRegistry.global().list()) {
			const candidate = ref.session;
			if (!candidate || Reflect.get(candidate, "isDisposed") === true) continue;
			const cwd = candidate.sessionManager?.getCwd?.();
			if (typeof cwd !== "string" || cwd === "" || !inside(directory, cwd)) continue;
			const exiting = [...(ignoring ?? [])].some(
				entry => entry === candidate || (!!entry.instanceKey && entry.instanceKey === candidate.instanceKey),
			);
			if (!exiting) return true;
		}
		return false;
	}

	async #leases(owned: OwnedWorktree, ignoring?: ReadonlySet<AgentSession>): Promise<() => void> {
		const repository = vcs.git(owned.worktree.sourceCwd);
		if (
			!repository ||
			!(await Promise.all((await repository.worktrees()).map(row => equalPath(row.path, owned.worktree.path)))).some(
				Boolean,
			)
		) {
			throw unavailable("Worktree is no longer registered in its source repository");
		}
		if (this.#liveSessionInside(owned.worktree.path, ignoring)) {
			throw invalid("A live session still owns this worktree");
		}
		const sessions = await SessionManager.list(owned.worktree.path);
		const releases: Array<() => void> = [];
		try {
			for (const session of sessions) {
				const release = new FileSessionStorage().claimSession(session.id, session.path);
				if (!release) throw invalid("A live session still owns this worktree");
				releases.push(release);
			}
			return () => {
				for (const release of releases) release();
			};
		} catch (cause) {
			for (const release of releases) release();
			throw cause;
		}
	}

	async execute(operation: SessionWorktreeOperation, assertCurrent?: () => void): Promise<unknown> {
		const check = () => {
			this.#check(operation.sessionId);
			assertCurrent?.();
		};
		check();
		if (operation.kind === "worktrees.session.resume.list" || operation.kind === "worktrees.session.resume.prepare") {
			const cwd = this.session.sessionManager.getCwd();
			const scope = operation.scope ?? cfgSessionWorktreeScope.get(this.session.settings);
			const listing = await SessionManager.listForPicker(cwd, undefined, new FileSessionStorage(), scope);
			const sessions = await listing.complete;
			this.#check(operation.sessionId);
			if (operation.kind === "worktrees.session.resume.list") {
				const result = {
					scope,
					sessions: sessions.slice(0, 200).map((info): SessionResumeRow => ({
						sessionId: info.id,
						title: sessionDisplayName(info),
						modifiedAt: info.modified.toISOString(),
						currentDirectory: path.resolve(info.cwd) === path.resolve(cwd),
						...(info.continuationOf ? { continuationOf: info.continuationOf } : {}),
					})),
					truncated: sessions.length > 200,
				};
				return result;
			}
			const selected = sessions.find(info => info.id === operation.targetSessionId);
			if (!selected) throw invalid("Session is outside the selected resume scope");
			const target = await resolveResumeTarget(selected.id, selected.cwd);
			this.#check(operation.sessionId);
			if (!target) throw invalid("Resume session is unavailable");
			const result = {
				targetSessionId: target.session.id,
				requestedSessionId: selected.id,
				cwd: target.session.cwd,
			};
			return result;
		}
		if (operation.kind === "worktrees.session.continueHere") {
			this.#startDecisionSession = operation.sessionId;
			return { continued: true };
		}
		const file = await this.#registry();
		await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		check();
		if (operation.kind === "worktrees.session.startPolicy") {
			const eligible =
				this.#startDecisionSession !== operation.sessionId &&
				!this.session.messages.length &&
				!this.session.isStreaming &&
				!this.session.isCompacting &&
				(await canAutoCreateWorktree(this.session.sessionManager.getCwd()));
			const result = {
				eligible,
				policy: cfgWorktreeOnStart.get(this.session.settings),
				...(!eligible ? { reason: "Only a fresh session in a primary Git checkout can start a worktree" } : {}),
			};
			return result;
		}
		if (operation.kind === "worktrees.session.list") {
			const rows = await this.#load(file);
			const result = {
				worktrees: await Promise.all(rows.slice(0, 100).map(row => this.#row(row))),
				truncated: rows.length > 100,
			};
			return result;
		}
		if (this.#busy) throw invalid("A worktree operation is already running");
		this.#busy = true;
		try {
			return await withFileLock(file + ".lock", async () => {
				const rows = await this.#load(file);
				check();
				if (operation.kind === "worktrees.session.create") {
					if (
						operation.freshOnly &&
						(this.session.messages.length || !(await canAutoCreateWorktree(this.session.sessionManager.getCwd())))
					) {
						throw invalid("The session is no longer eligible for an automatic worktree");
					}
					if (this.session.isStreaming || this.session.isCompacting) {
						throw invalid("Wait until the current session is idle");
					}
					if (rows.length >= 1000) throw invalid("Managed worktree limit reached");
					check();
					const worktree = await createSessionWorktree(
						this.session.sessionManager.getCwd(),
						this.session.settings,
						operation.branch ?? defaultSessionWorktreeBranch(),
						{ keepChanges: operation.keepChanges ?? false },
					);
					const owned = { id: crypto.randomUUID(), sessionId: operation.sessionId, worktree };
					rows.unshift(owned);
					await this.#save(file, rows);
					if (operation.freshOnly) this.#startDecisionSession = operation.sessionId;
					return { worktree: await this.#row(owned), cwd: worktree.path };
				}
				if (operation.kind === "worktrees.session.remove.apply") {
					const pending = this.#pending;
					this.#pending = undefined;
					if (
						!pending ||
						pending.instance !== this.#instance ||
						pending.owner !== operation.sessionId ||
						pending.preview.token !== operation.token ||
						pending.preview.expiresAt < Date.now()
					) {
						throw invalid("Worktree removal preview expired");
					}
					const registered = rows.find(row => row.id === pending.owned.id);
					if (
						!registered ||
						registered.sessionId !== pending.owned.sessionId ||
						registered.worktree.path !== pending.owned.worktree.path ||
						registered.worktree.sourceCwd !== pending.owned.worktree.sourceCwd ||
						registered.worktree.branch !== pending.owned.worktree.branch ||
						registered.worktree.baseCommit !== pending.owned.worktree.baseCommit ||
						registered.worktree.keptChanges !== pending.owned.worktree.keptChanges
					) {
						throw invalid("Managed worktree changed; prepare removal again");
					}
					if (await equalPath(pending.owned.worktree.path, this.session.sessionManager.getCwd())) {
						throw invalid("Switch away and save all worktree changes before removing it");
					}
					const release = await this.#leases(pending.owned);
					try {
						check();
						const messages = await removeExitWorktrees(pending.plan);
						const removed = !(await fs.lstat(pending.owned.worktree.path).catch(() => undefined));
						if (removed) {
							await this.#save(
								file,
								rows.filter(row => row.id !== pending.owned.id),
							);
						}
						return { removed, messages: messages.slice(0, 20).map(clean) };
					} finally {
						release();
					}
				}
				const owned = rows.find(row => row.id === operation.id);
				if (!owned) throw invalid("Unknown managed worktree");
				const row = await this.#row(owned);
				if (row.missing) throw invalid(row.reason ?? "Worktree unavailable");
				if (operation.kind === "worktrees.session.open") {
					return { cwd: owned.worktree.path };
				}
				if (row.current || row.dirty || row.detached) {
					throw invalid("Switch away and save all worktree changes before removing it");
				}
				const release = await this.#leases(owned);
				try {
					check();
					const messages: string[] = [];
					const plan = await planWorktreeExit(
						[owned.worktree],
						"ask",
						async () => true,
						message => messages.push(message),
					);
					if (plan.length !== 1) throw invalid(messages.join("; ") || "Worktree cannot be removed");
					const fresh = await this.#row(owned);
					check();
					if (fresh.missing || fresh.current || fresh.dirty || fresh.detached) {
						throw invalid("Switch away and save all worktree changes before removing it");
					}
					const preview: WorktreeRemovalPreview = {
						token: crypto.randomUUID(),
						expiresAt: Date.now() + 300000,
						worktree: fresh,
						keepBranch: fresh.hasCommits,
					};
					this.#pending = { owner: operation.sessionId, instance: this.#instance, preview, plan, owned };
					return preview;
				} finally {
					release();
				}
			});
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * Official `worktree.onExit` cleanup for the worktree this session occupies.
	 *
	 * Only rows in this Host's managed registry whose directory is the
	 * session's current cwd are considered; worktrees the CLI launch owns
	 * (`interactive-mode` `#ownedWorktrees`) are never in this registry, so
	 * both owners never remove the same tree. Policy and native planning are
	 * exactly `cfgWorktreeOnExit` + `planWorktreeExit`/`removeExitWorktrees`;
	 * without a confirmation channel the official default is "decline", which
	 * keeps dirty/moved worktrees on `ask` and still removes safe ones on
	 * `remove`. Returns the native/kept messages instead of emitting notices
	 * during teardown. `ignoring` names the sessions this shutdown is already
	 * tearing down, so their own residency does not block the lease check.
	 */
	async cleanupOnShutdown(
		options: {
			confirm?: (title: string, message: string) => Promise<boolean>;
			ignoring?: ReadonlySet<AgentSession>;
		} = {},
	): Promise<string[]> {
		const policy = cfgWorktreeOnExit.get(this.session.settings);
		if (policy === "keep") return [];
		const file = await this.#registry();
		await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const messages: string[] = [];
		await withFileLock(file + ".lock", async () => {
			const rows = await this.#load(file);
			for (const owned of [...rows]) {
				if (!(await equalPath(owned.worktree.path, this.session.sessionManager.getCwd()))) continue;
				try {
					const release = await this.#leases(owned, options.ignoring);
					try {
						const plan = await planWorktreeExit(
							[owned.worktree],
							policy,
							options.confirm ?? (async () => false),
							message => messages.push(message),
						);
						messages.push(...(await removeExitWorktrees(plan)));
						if (!(await fs.lstat(owned.worktree.path).catch(() => undefined))) {
							const index = rows.indexOf(owned);
							if (index >= 0) rows.splice(index, 1);
						}
					} finally {
						release();
					}
				} catch (cause) {
					messages.push(`Kept worktree ${owned.worktree.path}: ${clean(cause)}`);
				}
			}
			await this.#save(file, rows);
		});
		return messages.map(clean);
	}
}
