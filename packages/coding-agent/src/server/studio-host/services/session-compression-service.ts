/**
 * `maintenance.compression.*` — reviewed transparent filesystem compression.
 *
 * Scanning runs the native collector itself and records the exact candidate
 * identities the native engine selected. Applying reruns that engine, but the
 * `compressionCandidates` boundary returns only candidates whose path, byte
 * count, mtime and inode still match the reviewed set; the native idle/lease
 * checks still decide what may be touched. A token expires after five minutes
 * and is cleared on use or failure, so one review authorizes one run.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, sanitizeText } from "@linxiraos/pi-utils";
import { GC_AUTO_COMPRESS_LOG } from "../../../cli/gc-auto-compress.js";
import { collectGc, type CompressGcResult } from "../../../cli/gc-cli.js";
import { cfgGcAutoCompress, cfgGcCompressAfterDays } from "../../../cli/gc-settings.js";
import type { CompressCandidate } from "../../../cli/gc-compress.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { StudioOpError } from "../errors.js";
import type { AutoCompressionStatus } from "../protocol/contracts/maintenance.js";
import type {
	CompressionFile,
	CompressionState,
	CompressionSummary,
	SessionCompressionOperation,
} from "../protocol/contracts/session-compression.js";

const PREVIEW_TTL_MS = 300_000;
const MAX_REVIEWED_FILES = 200;

const clean = (error: unknown) =>
	sanitizeText(error instanceof Error ? error.message : String(error))
		.replaceAll("\0", "")
		.replaceAll(getAgentDir(), "<session storage>")
		.replaceAll(os.homedir(), "~")
		.replaceAll(os.tmpdir(), "<temp>")
		.slice(0, 1024) || "Compression failed";

function summary(result: CompressGcResult, files: CompressionFile[], truncated: boolean): CompressionSummary {
	return {
		supported: result.supported,
		...(result.method ? { method: result.method } : {}),
		scanned: result.scanned,
		skippedLive: result.skippedLive,
		sessions: result.sessions,
		candidates: result.wouldCompress,
		compressed: result.compressed,
		bytes: result.bytes,
		allocatedBefore: result.allocatedBefore,
		allocatedAfter: result.allocatedAfter,
		files,
		truncated,
		errors: result.errors.slice(0, 20).map(clean),
	};
}

export class StudioSessionCompressionService {
	#state: CompressionState = { phase: "idle" };
	#owner = "";
	get running(): boolean {
		return this.#state.phase === "scanning" || this.#state.phase === "applying";
	}
	#candidates = new Map<string, CompressCandidate>();
	#disposed = false;

	constructor(readonly session: AgentSession) {}

	dispose(): void {
		this.#disposed = true;
		this.#candidates.clear();
	}

	/** Latest detached maintenance run, read from its bounded output log. */
	async autoStatus(): Promise<AutoCompressionStatus> {
		const enabled = cfgGcAutoCompress.get(this.session.settings);
		const file = path.join(this.session.settings.getAgentDir(), GC_AUTO_COMPRESS_LOG);
		const redact = (text: string) =>
			sanitizeText(text)
				.replaceAll("\0", "")
				.replaceAll(this.session.settings.getAgentDir(), "<session storage>")
				.slice(0, 16_384);
		try {
			const stat = await fs.stat(file);
			const handle = await fs.open(file, "r");
			try {
				const length = Math.min(16_384, stat.size);
				const buffer = Buffer.alloc(length);
				const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
				return { enabled, ranAt: stat.mtimeMs, log: redact(buffer.subarray(0, bytesRead).toString("utf8")) };
			} finally {
				await handle.close();
			}
		} catch {
			return { enabled, log: "No completed automatic compression log" };
		}
	}

	async execute(operation: SessionCompressionOperation): Promise<CompressionState> {
		if (this.#disposed || operation.sessionId !== this.session.sessionId)
			throw new StudioOpError("UNAVAILABLE", "Compression session changed");
		if (operation.kind === "maintenance.compression.status")
			return this.#owner === operation.sessionId ? structuredClone(this.#state) : { phase: "idle" };
		if (["scanning", "applying"].includes(this.#state.phase))
			throw new StudioOpError("UNAVAILABLE", "Compression is already in progress");
		const days = cfgGcCompressAfterDays.get(this.session.settings),
			applying = operation.kind === "maintenance.compression.apply";
		if (
			applying &&
			(this.#owner !== operation.sessionId ||
				this.#state.phase !== "ready" ||
				this.#state.token !== operation.token ||
				(this.#state.expiresAt ?? 0) < Date.now() ||
				this.#state.days !== days)
		)
			throw new StudioOpError("UNAVAILABLE", "Compression preview expired or settings changed; scan again");
		this.#owner = operation.sessionId;
		if (!applying) this.#candidates.clear();
		this.#state = { phase: applying ? "applying" : "scanning", days };
		const files: CompressionFile[] = [];
		let truncated = false;
		try {
			const result = await collectGc({
				flags: {
					agentDir: getAgentDir(),
					apply: applying,
					blobs: false,
					archive: false,
					wal: false,
					stale: false,
					compress: true,
					compressAfterDays: days,
				},
				compressionCandidates: (sessionId, candidates) => {
					if (this.#disposed || operation.sessionId !== this.session.sessionId) return [];
					const selected: CompressCandidate[] = [];
					for (const candidate of candidates) {
						if (applying) {
							const approved = this.#candidates.get(candidate.path);
							if (
								!approved ||
								approved.bytes !== candidate.bytes ||
								approved.mtimeNs !== candidate.mtimeNs ||
								approved.ino !== candidate.ino
							)
								continue;
						} else if (this.#candidates.size >= MAX_REVIEWED_FILES) {
							truncated = true;
							continue;
						} else this.#candidates.set(candidate.path, candidate);
						selected.push(candidate);
						files.push({
							sessionId,
							name: path.relative(getAgentDir(), candidate.path).slice(0, 512),
							bytes: candidate.bytes,
							allocated: candidate.allocated,
						});
					}
					return selected;
				},
			});
			if (!result.compress) throw new Error("Native compression result unavailable");
			const projected = summary(result.compress, files, truncated);
			this.#state =
				applying || !projected.supported || projected.errors.length > 0
					? { phase: "complete", days, summary: projected }
					: {
							phase: "ready",
							days,
							summary: projected,
							token: crypto.randomUUID(),
							expiresAt: Date.now() + PREVIEW_TTL_MS,
						};
			if (applying) this.#candidates.clear();
			return structuredClone(this.#state);
		} catch (cause) {
			this.#candidates.clear();
			this.#state = { phase: "failed", error: clean(cause) };
			throw cause;
		}
	}
}
