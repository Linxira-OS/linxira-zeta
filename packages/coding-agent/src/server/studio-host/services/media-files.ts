/**
 * Private media job records and the session artifact boundary.
 *
 * Image/video bytes never live here: outputs are written through the native
 * session artifact owner and inputs are read back from it. This module keeps
 * only the bounded job metadata, partitioned per session under the private
 * agent profile, plus the port the runtime binds to the exact session.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { MediaOutput } from "../protocol/contracts/media.js";

/** The native artifact contract's current limit, not upstream Studio's 64 MiB. */
export const STUDIO_MEDIA_ARTIFACT_MAX_BYTES = 28 * 1024 * 1024;

const MAX_JOB_BYTES = 800_000;
const MAX_STORED_JOBS = 1000;
const JOB_ID = /^[a-f0-9-]{36}$/u;

/**
 * Session-bound artifact port. The runtime implementation reasserts the exact
 * live session before every call and delegates to the native artifact owner,
 * which enforces same-session ownership, extension/mime/kind and the 28 MiB
 * bound. The service itself never sees a path, transfer grant or provider URL.
 */
export interface SessionMediaArtifactPort {
	read(artifactId: string, kind?: "image" | "video" | "audio"): Promise<{ bytes: Uint8Array; meta: MediaOutput }>;
	write(meta: Pick<MediaOutput, "name" | "kind" | "mimeType">, bytes: Uint8Array): Promise<MediaOutput>;
	remove(artifactId: string): Promise<void>;
}

function sessionKey(sessionId: string): string {
	if (sessionId === "" || sessionId.length > 512 || sessionId.includes("\u0000")) {
		throw new Error("Invalid media session");
	}
	return createHash("sha256").update(sessionId).digest("hex");
}

function checkedJobId(id: string): string {
	if (!JOB_ID.test(id)) throw new Error("Invalid media job");
	return id;
}

/** Bounded job metadata in the private agent profile, partitioned by session. */
export class StudioMediaJobStore {
	constructor(readonly directory: string) {
		if (!isAbsolute(directory)) throw new Error("Private media job directory must be absolute");
	}

	#directory(sessionId: string): string {
		return join(this.directory, "jobs", sessionKey(sessionId));
	}

	async readJobs(sessionId: string): Promise<unknown[]> {
		const directory = this.#directory(sessionId);
		const names = await readdir(directory).catch(error => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		});
		const jobs: unknown[] = [];
		for (const name of names
			.filter(name => JOB_ID.test(name.slice(0, -".json".length)) && name.endsWith(".json"))
			.slice(-MAX_STORED_JOBS)) {
			try {
				const file = join(directory, name);
				const stat = await lstat(file);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOB_BYTES) continue;
				jobs.push(JSON.parse(await readFile(file, "utf8")));
			} catch {
				/* Corrupt or incomplete metadata is not a resumable job. */
			}
		}
		return jobs;
	}

	async saveJob(sessionId: string, id: string, value: unknown): Promise<void> {
		const directory = this.#directory(sessionId);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const target = join(directory, `${checkedJobId(id)}.json`);
		const temporary = `${target}.${randomUUID()}.partial`;
		const bytes = Buffer.from(JSON.stringify(value));
		if (bytes.length > MAX_JOB_BYTES) throw new Error("Media job metadata exceeds budget");
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(bytes);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			await rename(temporary, target);
		} finally {
			await unlink(temporary).catch(() => {});
		}
	}

	async removeJob(sessionId: string, id: string): Promise<void> {
		await unlink(join(this.#directory(sessionId), `${checkedJobId(id)}.json`)).catch(error => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		});
	}
}
