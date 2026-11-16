interface CredentialOwner {
	expiresAt: number;
	entries: Map<string, string>;
	timer: ReturnType<typeof setTimeout>;
}
const owners = new Map<string, CredentialOwner>();

/** Exact service identity; no credentials or bearer-bearing URL components. */
export function memoryCredentialUrl(value: string): string {
	const url = new URL(value.trim());
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
		throw new Error("Invalid Hindsight service URL");
	return url.toString().replace(/\/+$/u, "");
}
export function releaseMemoryCredentials(owner: string): void {
	const current = owners.get(owner);
	if (current) {
		clearTimeout(current.timer);
		owners.delete(owner);
	}
}
export function replaceMemoryCredentials(owner: string, expiresAt: number, input: unknown): void {
	if (!owner || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
		throw new Error("Memory credential owner expired");
	if (!Array.isArray(input) || input.length > 64) throw new Error("Invalid memory credential set");
	const entries = new Map<string, string>();
	for (const row of input) {
		if (
			!row ||
			typeof row !== "object" ||
			Array.isArray(row) ||
			Object.keys(row).some(key => !["url", "token"].includes(key)) ||
			typeof row.url !== "string" ||
			row.url.length > 4096 ||
			typeof row.token !== "string" ||
			!row.token ||
			row.token.length > 16384 ||
			/[\r\n\0]/u.test(row.token)
		)
			throw new Error("Invalid memory credential entry");
		const url = memoryCredentialUrl(row.url);
		if (entries.has(url)) throw new Error("Duplicate memory credential URL");
		entries.set(url, row.token);
	}
	for (const [id, current] of owners) {
		if (current.expiresAt <= Date.now()) {
			releaseMemoryCredentials(id);
			continue;
		}
		if (id !== owner && [...entries.keys()].some(url => current.entries.has(url)))
			throw new Error("Hindsight credentials belong to another live owner");
	}
	releaseMemoryCredentials(owner);
	if (entries.size === 0) return;
	const timer = setTimeout(() => releaseMemoryCredentials(owner), Math.min(expiresAt - Date.now(), 2_147_483_647));
	timer.unref();
	owners.set(owner, { expiresAt, entries, timer });
}
/** Used only by the native Hindsight request client, never an HTTP response. */
export function privateMemoryCredential(value: string): string | undefined {
	let url: string;
	try {
		url = memoryCredentialUrl(value);
	} catch {
		return undefined;
	}
	for (const [id, current] of owners) {
		if (current.expiresAt <= Date.now()) {
			releaseMemoryCredentials(id);
			continue;
		}
		const token = current.entries.get(url);
		if (token) return token;
	}
	return undefined;
}
