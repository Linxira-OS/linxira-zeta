import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export interface MemoryCredentialEntry { url: string; token: string }
interface StoredMemoryCredential extends MemoryCredentialEntry { target: string }
export interface SecretCodec { available(): boolean | Promise<boolean>; encrypt(value: string): Buffer | Promise<Buffer>; decrypt(value: Buffer): string | Promise<string> }
export function memoryCredentialUrl(value: string): string {
	if (value.length > 4096) throw new Error("Invalid Hindsight service URL");
	const url = new URL(value.trim());
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid Hindsight service URL");
	return url.toString().replace(/\/+$/u, "");
}
/** Main-only encrypted storage. Plaintext leaves only through the selected Host connection. */
export class MemoryCredentialStore {
	#queue: Promise<unknown> = Promise.resolve();
	constructor(readonly file: string, readonly codec: SecretCodec) {}
	async #read(): Promise<StoredMemoryCredential[]> {
		if (!await this.codec.available()) throw new Error("Secure storage is unavailable");
		let data: Buffer;
		try { data = await readFile(this.file); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
		const rows: unknown = JSON.parse(await this.codec.decrypt(data));
		if (!Array.isArray(rows) || rows.some(row => !row || typeof row.target !== "string" || !row.target || row.target.length > 512 || typeof row.url !== "string" || memoryCredentialUrl(row.url) !== row.url || typeof row.token !== "string" || !row.token || row.token.length > 16384 || /[\r\n\0]/u.test(row.token))) throw new Error("Invalid secure storage");
		return rows as StoredMemoryCredential[];
	}
	async list(target: string): Promise<MemoryCredentialEntry[]> {
		await this.#queue.catch(() => {});
		return (await this.#read()).filter(row => row.target === target).map(({ url, token }) => ({ url, token }));
	}
	async has(target: string, url: string): Promise<boolean> {
		const normalized = memoryCredentialUrl(url);
		return (await this.list(target)).some(row => row.url === normalized);
	}
	set(target: string, url: string, token: string | undefined): Promise<void> {
		const normalized = memoryCredentialUrl(url);
		if (!target || target.length > 512 || token !== undefined && (!token || token.length > 16384 || /[\r\n\0]/u.test(token))) throw new Error("Invalid memory credential");
		const next = this.#queue.catch(() => {}).then(async () => {
			const rows = (await this.#read()).filter(row => row.target !== target || row.url !== normalized);
			if (token !== undefined) rows.push({ target, url: normalized, token });
			if (rows.filter(row => row.target === target).length > 64) throw new Error("Too many memory credentials");
			const encrypted = await this.codec.encrypt(JSON.stringify(rows));
			await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
			const temporary = this.file + ".tmp";
			await writeFile(temporary, encrypted, { mode: 0o600 });
			await rename(temporary, this.file);
		});
		this.#queue = next;
		return next;
	}
}
