/**
 * `session.portability.*` — native session pack/anonymize, reviewed import and
 * an explicit move marker.
 *
 * Bytes stay in the native session-artifact store: an import reads the exact
 * `export` artifact the desktop library placed there and an export writes a new
 * one through `writeSessionArtifact`. The Host never accepts a filesystem path,
 * transfer grant, library or second artifact store. The only disk staging is a
 * private per-review temp directory removed when the five-minute review ends.
 *
 * A review is one-shot: the token, owner and SHA-256 of the staged tar are
 * checked once, then consumed before native unpacking starts. Native
 * `preserveExisting` makes any colliding local transcript a fork, never a
 * replacement. Pack/anonymize only read the source; `moved` is the sole
 * operation that writes a transfer marker, and only after an explicit request.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { getAgentDir, sanitizeText } from "@linxiraos/pi-utils";
import { writeArchive } from "@linxiraos/pi-utils/ar";
import type { AgentSession } from "../../../session/agent-session.js";
import { loadEntriesFromFile } from "../../../session/session-loader.js";
import { anonymizeSessionTranscripts } from "../../../session/session-anonymizer.js";
import { SessionManager } from "../../../session/session-manager.js";
import { FileSessionStorage } from "../../../session/session-storage.js";
import {
	inspectSessionArchive,
	markSessionMoved,
	packSession,
	unpackSession,
} from "../../../session/session-transfer.js";
import { StudioOpError } from "../errors.js";
import {
	artifactSessionIdFor,
	readArtifactFile,
	SESSION_ARTIFACT_MAX_BYTES,
	writeSessionArtifact,
} from "../ops/files.js";
import type {
	PortableExport,
	SessionImportPreview,
	SessionPortabilityOperation,
	SessionPortabilityStatus,
} from "../protocol/contracts/session-portability.js";

const EXPIRES = 5 * 60_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,4096}$/;

function clean(cause: unknown, roots: readonly string[]): string {
	let message = sanitizeText(cause instanceof Error ? cause.message : String(cause)).replaceAll("\0", "");
	for (const root of roots) if (root) message = message.replaceAll(root, "<session storage>");
	return message.slice(0, 1024) || "Session transfer failed";
}

function contains(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/**
 * One invocation's authority. Built from the exact captured view, never reused
 * across calls, so an in-flight transfer keeps its initiating view's fence even
 * while another live context reads status or reuses the cached service.
 */
export interface SessionPortabilityHost {
	/** Stable identity of the browsing context that authorized this call. */
	readonly ownerId: string;
	/** Reassert the exact live owner, selection and native session object. */
	assertCurrent(): void;
	/** Resolve a registered workspace to its canonical import directory. */
	resolveTargetWorkspace(workspaceId: string | undefined): Promise<{ workspaceId: string; cwd: string }>;
}

interface PendingImport {
	preview: SessionImportPreview;
	file: string;
	directory: string;
	hash: string;
	workspaceId: string;
	cwd: string;
	owner: string;
	timer: NodeJS.Timeout;
}

export class StudioSessionPortabilityService {
	#owner: string | undefined;
	#status: SessionPortabilityStatus = { phase: "idle" };
	#pending: PendingImport | undefined;
	#disposed = false;

	/** The cached service owns session state only; authority arrives per call. */
	constructor(readonly session: AgentSession) {}

	get running(): boolean {
		return ["preparing", "exporting", "importing"].includes(this.#status.phase);
	}

	#check(id: string, host: SessionPortabilityHost): void {
		if (this.#disposed || id !== this.session.sessionId)
			throw new StudioOpError("UNAVAILABLE", "Session changed during transfer");
		host.assertCurrent();
	}

	#clean(cause: unknown): string {
		return clean(cause, [getAgentDir(), tmpdir(), this.session.sessionManager.getCwd()]);
	}

	async #clearPending(): Promise<void> {
		const pending = this.#pending;
		this.#pending = undefined;
		if (!pending) return;
		clearTimeout(pending.timer);
		await fs.unlink(pending.file).catch(() => {});
		await fs.rm(pending.directory, { recursive: true, force: true }).catch(() => {});
	}

	async #source(id: string, host: SessionPortabilityHost): Promise<string> {
		if (!SESSION_ID.test(id)) throw new StudioOpError("INVALID_ARGUMENT", "Invalid session identity");
		if (id === this.session.sessionId) {
			if (this.session.isStreaming || this.session.isCompacting)
				throw new StudioOpError("UNAVAILABLE", "Wait until the session is idle");
			await this.session.sessionManager.flush();
			this.#check(id, host);
			const file = this.session.sessionManager.getSessionFile();
			if (!file) throw new StudioOpError("UNAVAILABLE", "This session has no saved transcript");
			return file;
		}
		const manager = this.session.sessionManager;
		const rows = await SessionManager.list(manager.getCwd(), manager.getSessionDir());
		this.#check(this.session.sessionId, host);
		const row = rows.find(candidate => candidate.id === id);
		if (!row) throw new StudioOpError("INVALID_ARGUMENT", "Session is not in this workspace");
		let resolved: string;
		let root: string;
		try {
			[resolved, root] = await Promise.all([fs.realpath(row.path), fs.realpath(manager.getSessionDir())]);
		} catch {
			throw new StudioOpError("UNAVAILABLE", "Session transcript storage is unavailable");
		}
		this.#check(this.session.sessionId, host);
		if (!contains(root, resolved))
			throw new StudioOpError("UNAVAILABLE", "Session transcript is outside this workspace");
		const stat = await fs.lstat(resolved);
		this.#check(this.session.sessionId, host);
		if (!stat.isFile() || stat.isSymbolicLink())
			throw new StudioOpError("UNAVAILABLE", "Session transcript is not a regular file");
		return resolved;
	}

	async execute(operation: SessionPortabilityOperation, host: SessionPortabilityHost): Promise<unknown> {
		this.#check(operation.sessionId, host);
		if (operation.kind === "session.portability.status")
			return this.#owner === operation.sessionId ? structuredClone(this.#status) : { phase: "idle" };
		if (this.running) throw new StudioOpError("UNAVAILABLE", "A session transfer is already running");
		if (operation.kind === "session.portability.cancel") {
			if (!this.#pending || this.#pending.owner !== host.ownerId || this.#pending.preview.token !== operation.token)
				throw new StudioOpError("UNAVAILABLE", "Import preview expired");
			await this.#clearPending();
			this.#check(operation.sessionId, host);
			this.#status = { phase: "idle" };
			return { cancelled: true };
		}
		if (
			operation.kind === "session.portability.import" &&
			(!this.#pending ||
				this.#pending.owner !== host.ownerId ||
				this.#pending.preview.token !== operation.token ||
				this.#pending.preview.expiresAt < Date.now())
		)
			throw new StudioOpError("UNAVAILABLE", "Import preview expired; inspect the archive again");
		this.#owner = operation.sessionId;
		if (operation.kind === "session.portability.moved") {
			if (operation.targetSessionId === this.session.sessionId)
				throw new StudioOpError("UNAVAILABLE", "Switch away from the source session before marking it moved");
			const source = await this.#source(operation.targetSessionId, host);
			this.#check(operation.sessionId, host);
			try {
				await markSessionMoved(source, operation.label);
			} catch (cause) {
				throw new StudioOpError("UNAVAILABLE", this.#clean(cause));
			}
			this.#check(operation.sessionId, host);
			return { marked: true };
		}
		try {
			if (operation.kind === "session.portability.prepare") {
				this.#status = { phase: "preparing" };
				await this.#clearPending();
				this.#check(operation.sessionId, host);
				return await this.#prepare(operation, host);
			}
			if (operation.kind === "session.portability.import") return await this.#import(operation, host);
			return await this.#export(operation, host);
		} catch (cause) {
			if (operation.kind === "session.portability.import") await this.#clearPending();
			this.#status = { phase: "failed", error: this.#clean(cause) };
			throw cause;
		}
	}

	async #prepare(
		operation: Extract<SessionPortabilityOperation, { kind: "session.portability.prepare" }>,
		host: SessionPortabilityHost,
	): Promise<SessionImportPreview> {
		if (!ARTIFACT_ID.test(operation.artifactId))
			throw new StudioOpError("INVALID_ARGUMENT", "Invalid session archive artifact");
		if (artifactSessionIdFor(operation.artifactId) !== this.session.sessionId)
			throw new StudioOpError("INVALID_ARGUMENT", "Session archive belongs to another conversation");
		const { artifact, response } = await readArtifactFile(operation.artifactId);
		this.#check(operation.sessionId, host);
		if (artifact.kind !== "export" || artifact.mimeType !== "application/x-tar" || !/\.tar$/iu.test(artifact.name))
			throw new StudioOpError("INVALID_ARGUMENT", "Choose a legacy .tar session archive");
		if (artifact.bytes < 1 || artifact.bytes > SESSION_ARTIFACT_MAX_BYTES)
			throw new StudioOpError("INVALID_ARGUMENT", "Session archive exceeds the 28 MiB transfer limit");
		const bytes = new Uint8Array(await response.arrayBuffer());
		this.#check(operation.sessionId, host);
		if (bytes.byteLength !== artifact.bytes || bytes.byteLength > SESSION_ARTIFACT_MAX_BYTES)
			throw new StudioOpError("INVALID_ARGUMENT", "Session archive changed while reading");
		const target = await host.resolveTargetWorkspace(operation.targetWorkspaceId);
		this.#check(operation.sessionId, host);
		const token = randomUUID(),
			directory = await fs.mkdtemp(path.join(tmpdir(), "zeta-studio-transfer-")),
			file = path.join(directory, `${token}.tar`),
			hash = createHash("sha256").update(bytes).digest("hex");
		try {
			await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
			const info = await inspectSessionArchive(file, target.cwd);
			this.#check(operation.sessionId, host);
			if (!SESSION_ID.test(info.id))
				throw new StudioOpError("INVALID_ARGUMENT", "Session archive has an invalid session identity");
			const preview: SessionImportPreview = {
				token,
				expiresAt: Date.now() + EXPIRES,
				sourceSessionId: info.id,
				title:
					sanitizeText(info.title)
						.replace(/[\x00-\x1f]/g, " ")
						.slice(0, 1024) || info.id,
				sourceDirectory: sanitizeText(info.cwd).replaceAll("\0", "").slice(0, 1024) || "—",
				destinationDirectory: target.cwd,
				upstreamVersion: sanitizeText(info.omp)
					.replace(/[\x00-\x1f]/g, " ")
					.slice(0, 256),
				messages: info.messages,
				artifacts: info.artifacts,
				blobs: info.blobs,
				conflicts: info.conflicts,
			};
			const timer = setTimeout(() => {
				if (this.#pending?.preview.token === token) {
					void this.#clearPending();
					this.#status = { phase: "idle" };
				}
			}, EXPIRES);
			timer.unref();
			this.#pending = {
				preview,
				file,
				directory,
				hash,
				workspaceId: target.workspaceId,
				cwd: target.cwd,
				owner: host.ownerId,
				timer,
			};
			this.#status = { phase: "complete", preview };
			return preview;
		} catch (cause) {
			await fs.unlink(file).catch(() => {});
			await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
			throw cause;
		}
	}

	async #import(
		operation: Extract<SessionPortabilityOperation, { kind: "session.portability.import" }>,
		host: SessionPortabilityHost,
	): Promise<{ sessionId: string; mode: "created" | "forked"; workspaceId: string; cwd: string }> {
		const pending = this.#pending;
		if (
			!pending ||
			pending.owner !== host.ownerId ||
			pending.preview.token !== operation.token ||
			pending.preview.expiresAt < Date.now()
		)
			throw new StudioOpError("UNAVAILABLE", "Import preview expired; inspect the archive again");
		this.#status = { phase: "importing", preview: pending.preview };
		// Consume the review before doing any work: one token authorizes one attempt.
		this.#pending = undefined;
		clearTimeout(pending.timer);
		try {
			const bytes = await fs.readFile(pending.file);
			if (createHash("sha256").update(bytes).digest("hex") !== pending.hash)
				throw new StudioOpError("UNAVAILABLE", "Archive changed after inspection");
			const target = await host.resolveTargetWorkspace(pending.workspaceId);
			this.#check(operation.sessionId, host);
			if (target.workspaceId !== pending.workspaceId || target.cwd !== pending.cwd)
				throw new StudioOpError("UNAVAILABLE", "Destination workspace changed after inspection");
			await fs.access(pending.file);
			this.#check(operation.sessionId, host);
			const result = await unpackSession(pending.file, { cwd: pending.cwd, preserveExisting: true });
			this.#check(operation.sessionId, host);
			if (result.mode === "replaced")
				throw new StudioOpError("UNAVAILABLE", "Native import replaced a local session");
			this.#status = {
				phase: "complete",
				imported: { sessionId: result.id, mode: result.mode, workspaceId: pending.workspaceId, cwd: pending.cwd },
			};
			return { sessionId: result.id, mode: result.mode, workspaceId: pending.workspaceId, cwd: pending.cwd };
		} finally {
			await fs.unlink(pending.file).catch(() => {});
			await fs.rm(pending.directory, { recursive: true, force: true }).catch(() => {});
		}
	}

	async #export(
		operation: Extract<
			SessionPortabilityOperation,
			{ kind: "session.portability.pack" | "session.portability.anonymize" }
		>,
		host: SessionPortabilityHost,
	): Promise<PortableExport> {
		this.#status = { phase: "exporting" };
		const id = randomUUID(),
			directory = await fs.mkdtemp(path.join(tmpdir(), "zeta-studio-export-")),
			format = operation.kind === "session.portability.pack" ? "pack" : "anonymous",
			file = path.join(directory, id + (format === "pack" ? ".tar" : ".zip"));
		try {
			const source = await this.#source(operation.targetSessionId, host);
			this.#check(operation.sessionId, host);
			let members = 0;
			const warnings: string[] = [];
			if (format === "pack") {
				const result = await packSession(source, file);
				if (result.missingBlobs.length)
					warnings.push(`${result.missingBlobs.length} referenced blobs were unavailable`);
				const info = await inspectSessionArchive(file, this.session.sessionManager.getCwd());
				this.#check(operation.sessionId, host);
				members = 2 + info.artifacts + info.blobs;
			} else {
				const release = new FileSessionStorage().claimSession(operation.targetSessionId, source);
				if (!release)
					throw new StudioOpError("UNAVAILABLE", "The source session is being written by another process");
				try {
					const entries = await loadEntriesFromFile(source),
						header = entries[0];
					if (!header || header.type !== "session" || header.id !== operation.targetSessionId)
						throw new StudioOpError("UNAVAILABLE", "Source session identity changed");
					const result = await anonymizeSessionTranscripts({
						header,
						entries: entries.filter(entry => entry.type !== "session"),
						sessionFile: source,
					});
					await writeArchive(file, "zip", result.files);
					members = result.files.length;
					if (result.subagentError) warnings.push("Some subagent transcripts were skipped");
				} finally {
					release();
				}
			}
			this.#check(operation.sessionId, host);
			const info = await fs.lstat(file);
			this.#check(operation.sessionId, host);
			if (!info.isFile() || info.isSymbolicLink() || info.size > SESSION_ARTIFACT_MAX_BYTES)
				throw new StudioOpError("UNAVAILABLE", "Export exceeds the 28 MiB transfer limit");
			const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
			this.#check(operation.sessionId, host);
			const asset = await writeSessionArtifact(
				operation.sessionId,
				{
					kind: "export",
					name: `zeta-${format}-${operation.targetSessionId}.${format === "pack" ? "tar" : "zip"}`,
					mimeType: format === "pack" ? "application/x-tar" : "application/zip",
				},
				bytes,
				() => this.#check(operation.sessionId, host),
			);
			this.#check(operation.sessionId, host);
			const result: PortableExport = {
				id,
				format,
				members,
				warnings,
				asset: {
					artifactId: asset.artifactId,
					kind: "export",
					name: asset.name,
					mimeType: asset.mimeType,
					bytes: asset.bytes,
					sha256: asset.sha256,
				},
			};
			this.#status = { phase: "complete", exported: result };
			return result;
		} finally {
			await fs.unlink(file).catch(() => {});
			await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
		}
	}

	dispose(): void {
		this.#disposed = true;
		const pending = this.#pending;
		this.#pending = undefined;
		if (pending) {
			clearTimeout(pending.timer);
			void fs.unlink(pending.file).catch(() => {});
			void fs.rm(pending.directory, { recursive: true, force: true }).catch(() => {});
		}
	}
}
