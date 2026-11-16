import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, lstat } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@linxiraos/pi-utils";
import { EVALUATION_LIMITS } from "./evaluation-limits.js";

interface ExportRecord { artifactId: string; name: string; mimeType: string; bytes: number; runId: string }
const ID = /^[a-f0-9-]{36}$/u;
/** Private files owned by this session's evaluation history; ids never resolve outside it. */
export class EvaluationExportStore {
	readonly #records = new Map<string, ExportRecord>();
	readonly #ready: Promise<void>;
	#reservations = 0;
	constructor(readonly directory: string) { this.#ready = this.#load(); }
	async #load(): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		for (const name of await readdir(this.directory)) {
			if (!name.endsWith(".json") || !ID.test(name.slice(0, -5))) continue;
			if (this.#records.size >= EVALUATION_LIMITS.exports) throw new Error("Saved evaluation export limit exceeded");
			const file = join(this.directory, name);
			const info = await lstat(file);
			if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error("Invalid saved evaluation export");
			const record: unknown = JSON.parse(await readFile(file, "utf8"));
			if (!isRecord(record) || record.artifactId !== name.slice(0, -5) || typeof record.name !== "string" || typeof record.mimeType !== "string" || typeof record.runId !== "string" || typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > EVALUATION_LIMITS.reportBytes)
				throw new Error("Invalid saved evaluation export metadata");
			this.#records.set(String(record.artifactId), { artifactId: String(record.artifactId), name: record.name, mimeType: record.mimeType, runId: record.runId, bytes: record.bytes });
		}
	}
	async registerBytes(input: { name: string; mimeType: string; runId: string; workspaceId: string; kind: "export" }, bytes: Uint8Array): Promise<ExportRecord> {
		await this.#ready;
		if (bytes.byteLength > EVALUATION_LIMITS.reportBytes) throw new Error("Evaluation export exceeds 64 MiB");
		if (this.#records.size + this.#reservations >= EVALUATION_LIMITS.exports) throw new Error("Evaluation export limit reached");
		this.#reservations++;
		try {
			const artifactId = randomUUID();
			const record = { artifactId, name: input.name, mimeType: input.mimeType, bytes: bytes.byteLength, runId: input.runId };
			const handle = await open(join(this.directory, `${artifactId}.data`), "wx", 0o600);
			try { await handle.writeFile(bytes); } finally { await handle.close(); }
			const temporary = join(this.directory, `${artifactId}.tmp`);
			const metadata = await open(temporary, "wx", 0o600);
			try { await metadata.writeFile(JSON.stringify(record)); } finally { await metadata.close(); }
			await rename(temporary, join(this.directory, `${artifactId}.json`));
			this.#records.set(artifactId, record);
			return record;
		} finally { this.#reservations--; }
	}
	async resolve(id: string): Promise<{ path: string; record: ExportRecord }> {
		await this.#ready;
		const record = ID.test(id) ? this.#records.get(id) : undefined;
		if (!record) throw new Error("Evaluation export not found");
		const path = join(this.directory, `${id}.data`);
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) throw new Error("Evaluation export is unavailable");
		return { path, record };
	}
}
